//! Event-sourcing integration scenarios using the in-memory harness.

#[path = "event_log_harness.rs"]
mod harness;

use harness::{
    EventLogDevice, ProviderBuckets, push_device_outbox, sample_legacy_yaml,
    union_device_from_providers,
};
use nook_core::{
    AppendEventInput, AuthKeyId, EncryptedSecretPayload, EventError, EventId, IsoTimestamp,
    OpaqueCiphertext, SecretId, SecretType, StoreId, VaultOperation, VaultResult,
    build_signed_event,
};
use std::collections::HashMap;

const TS: &str = "2026-06-28T00:00:00Z";

#[test]
fn two_device_genesis_append_and_union() -> VaultResult<()> {
    let mut a = EventLogDevice::genesis("a")?;
    let mut b = EventLogDevice::replica_of(&a)?;
    a.append_secret("secret_deviceaaaa", "value-a")?;
    b.union_from(&a)?;

    let graph_a = a.session.store.load_graph(a.store_id())?;
    let graph_b = b.session.store.load_graph(b.store_id())?;
    assert_eq!(a.project()?.live_secrets(&graph_a).len(), 1);
    assert_eq!(b.project()?.live_secrets(&graph_b).len(), 1);
    Ok(())
}

#[test]
fn concurrent_adds_both_survive_after_union() -> VaultResult<()> {
    let mut a = EventLogDevice::genesis("a")?;
    let mut b = EventLogDevice::replica_of(&a)?;
    b.union_from(&a)?;

    a.append_secret("secret_concurrenta", "a")?;
    b.append_secret("secret_concurrentb", "b")?;

    a.union_from(&b)?;
    b.union_from(&a)?;

    let graph = a.session.store.load_graph(a.store_id())?;
    let projection = a.project()?;
    assert_eq!(projection.live_secrets(&graph).len(), 2);
    assert_eq!(graph.heads().len(), 2);
    Ok(())
}

#[test]
fn concurrent_replace_creates_conflict() -> VaultResult<()> {
    let mut device = EventLogDevice::genesis("main")?;
    device.append_secret("secret_original1", "base")?;
    let head = device.session.heads[0].clone();

    device.session.heads = vec![head.clone()];
    device.append_signed(vec![VaultOperation::SecretReplaced {
        old_id: SecretId::from_vault_record("secret_original1"),
        new_secret: EncryptedSecretPayload {
            id: SecretId::from_vault_record("secret_newaaaaaaa"),
            secret_type: SecretType::ApiKey,
            ciphertext: OpaqueCiphertext::from_trusted("cipher-secret_newaaaaaaa".to_owned()),
        },
    }])?;
    device.session.heads = vec![head];
    device.append_signed(vec![VaultOperation::SecretReplaced {
        old_id: SecretId::from_vault_record("secret_original1"),
        new_secret: EncryptedSecretPayload {
            id: SecretId::from_vault_record("secret_newbbbbbbb"),
            secret_type: SecretType::ApiKey,
            ciphertext: OpaqueCiphertext::from_trusted("cipher-secret_newbbbbbbb".to_owned()),
        },
    }])?;

    let graph = device.session.store.load_graph(device.store_id())?;
    let projection = device.project()?;
    assert!(
        projection
            .replacement_conflicts
            .contains_key(&SecretId::from_vault_record("secret_original1"))
    );
    assert_eq!(projection.live_secrets(&graph).len(), 2);
    Ok(())
}

#[test]
fn out_of_order_delivery_becomes_applicable() -> VaultResult<()> {
    let device = EventLogDevice::genesis("main")?;
    let genesis_head = nook_core::EventId::parse(&device.session.heads[0])?;
    let genesis_bytes = device
        .session
        .store
        .get_bytes(&genesis_head)
        .ok_or(EventError::MissingGenesisBytes)?
        .to_vec();

    let child_ops = vec![VaultOperation::SecretCreated {
        secret: EncryptedSecretPayload {
            id: SecretId::from_vault_record("secret_outoforder1"),
            secret_type: SecretType::ApiKey,
            ciphertext: OpaqueCiphertext::from_trusted("cipher-child".to_owned()),
        },
    }];
    let store_id = StoreId::parse(device.store_id())?;
    let actor_id = AuthKeyId::parse(&device.actor_id()?)?;
    let key_epoch = EventId::parse(&device.session.key_epoch)?;
    let created_at = IsoTimestamp::from_trusted(TS.to_owned());
    let (event, child_bytes) = build_signed_event(AppendEventInput {
        store_id: &store_id,
        actor_id: &actor_id,
        signing_identity: &device.session.signing,
        parents: vec![genesis_head.clone()],
        key_epoch: &key_epoch,
        created_at: &created_at,
        operations: child_ops,
    })?;
    let child_id = event.id()?;

    let mut store = nook_core::LocalEventStore::new();
    store.put_event(child_id.clone(), child_bytes);
    let graph = store.load_graph(device.store_id())?;
    assert!(!graph.pending_events().is_empty());

    store.put_event(genesis_head.clone(), genesis_bytes);
    let graph = store.load_graph(device.store_id())?;
    assert!(graph.pending_events().is_empty());
    assert_eq!(graph.applicable_events().len(), 2);
    Ok(())
}

#[test]
fn duplicate_union_is_idempotent() -> VaultResult<()> {
    let mut a = EventLogDevice::genesis("a")?;
    a.append_secret("secret_duplicate1", "v")?;
    let events = a.remote_events();

    let mut b = EventLogDevice::replica_of(&a)?;
    b.session.union_remote(&events)?;
    b.session.union_remote(&events)?;

    assert_eq!(
        b.session.store.event_ids().len(),
        a.session.store.event_ids().len()
    );
    Ok(())
}

#[test]
fn join_merge_single_head() -> VaultResult<()> {
    let mut device = EventLogDevice::genesis("main")?;
    let genesis_head = device.session.heads[0].clone();

    device.session.heads = vec![genesis_head.clone()];
    let a_id = device.append_secret("secret_concurrenta", "a")?;
    device.session.heads = vec![genesis_head.clone()];
    let b_id = device.append_secret("secret_concurrentb", "b")?;

    device.session.heads = vec![a_id.as_str().to_owned(), b_id.as_str().to_owned()];
    device.append_signed(vec![VaultOperation::SecretCreated {
        secret: EncryptedSecretPayload {
            id: SecretId::from_vault_record("secret_joinmerge1"),
            secret_type: SecretType::ApiKey,
            ciphertext: OpaqueCiphertext::from_trusted("cipher-join".to_owned()),
        },
    }])?;

    let graph = device.session.store.load_graph(device.store_id())?;
    assert_eq!(graph.heads().len(), 1);
    Ok(())
}

#[test]
fn legacy_import_then_decrypt() -> VaultResult<()> {
    let mut device = EventLogDevice::genesis("main")?;
    let yaml = sample_legacy_yaml(&device.crypto)?;
    device.import_legacy_yaml(&yaml)?;

    let graph = device.session.store.load_graph(device.store_id())?;
    let live = device.project()?.live_secrets(&graph);
    assert!(live.contains_key("legacy-secret"));
    Ok(())
}

#[test]
fn epoch_rotation_decrypts_under_new_key() -> VaultResult<()> {
    let mut device = EventLogDevice::genesis("main")?;
    device.append_secret("secret_epochrot1", "rotate-me")?;
    let graph = device.session.store.load_graph(device.store_id())?;
    let user_records: Vec<_> = device
        .project()?
        .live_secrets(&graph)
        .into_values()
        .collect();

    let trigger = VaultOperation::DeviceRevoked {
        device_id: nook_core::DeviceId::parse("abcd1234ef567890")?,
    };
    let old_secrets = nook_core::SymmetricKey::parse(&device.secrets_key)?;
    let (new_secrets, _new_members) = device.session.rotate_security_epoch(
        trigger,
        &user_records,
        &old_secrets,
        &[],
        TS,
        Some("github"),
    )?;
    assert_ne!(new_secrets, device.secrets_key);
    device.secrets_key = new_secrets.clone();
    device.crypto = nook_core::VaultCrypto::new(&nook_core::SymmetricKey::parse(&new_secrets)?)?;
    device.crypto.encrypt_value("post-epoch")?;
    Ok(())
}

#[test]
fn provider_switch_outbox_flush_and_union() -> VaultResult<()> {
    let mut a = EventLogDevice::genesis("a")?;
    let mut providers: ProviderBuckets =
        HashMap::from([("github".to_owned(), nook_core::LocalEventStore::new())]);

    for (id, bytes) in a.remote_events() {
        providers
            .get_mut("github")
            .ok_or(EventError::MissingProviderBucket)?
            .put_event(id, bytes);
    }

    let mut b = EventLogDevice::replica_of(&a)?;
    union_device_from_providers(&mut b, &providers)?;

    a.append_secret("secret_outbox0001", "synced")?;
    push_device_outbox(&mut a, &mut providers)?;
    union_device_from_providers(&mut b, &providers)?;

    let graph = b.session.store.load_graph(b.store_id())?;
    assert!(!b.project()?.live_secrets(&graph).is_empty());
    Ok(())
}

#[test]
fn three_device_decentralized_convergence() -> VaultResult<()> {
    let mut a = EventLogDevice::genesis("a")?;
    let mut b = EventLogDevice::replica_of(&a)?;
    let mut c = EventLogDevice::replica_of(&a)?;

    // All devices start from the same genesis.
    b.union_from(&a)?;
    c.union_from(&a)?;

    // Each device appends concurrently from the shared genesis head.
    let shared_head = a.session.heads[0].clone();
    a.session.heads = vec![shared_head.clone()];
    a.append_secret("secret_deviceaaaa", "from-a")?;
    b.session.heads = vec![shared_head.clone()];
    b.append_secret("secret_devicebbbb", "from-b")?;
    c.session.heads = vec![shared_head];
    c.append_secret("secret_devicecccc", "from-c")?;

    // Pairwise decentralized sync (no central coordinator).
    a.union_from(&b)?;
    a.union_from(&c)?;
    b.union_from(&a)?;
    b.union_from(&c)?;
    c.union_from(&a)?;
    c.union_from(&b)?;

    let graph_a = a.session.store.load_graph(a.store_id())?;
    let graph_b = b.session.store.load_graph(b.store_id())?;
    let graph_c = c.session.store.load_graph(c.store_id())?;

    assert_eq!(a.session.store.event_ids().len(), 4); // genesis + 3 concurrent
    assert_eq!(b.session.store.event_ids().len(), 4);
    assert_eq!(c.session.store.event_ids().len(), 4);
    assert_eq!(a.project()?.live_secrets(&graph_a).len(), 3);
    assert_eq!(b.project()?.live_secrets(&graph_b).len(), 3);
    assert_eq!(c.project()?.live_secrets(&graph_c).len(), 3);
    assert_eq!(graph_a.heads().len(), 3);
    Ok(())
}

#[test]
fn partial_sync_then_completion() -> VaultResult<()> {
    let mut a = EventLogDevice::genesis("a")?;
    let mut b = EventLogDevice::replica_of(&a)?;
    b.union_from(&a)?;

    let head = a.session.heads[0].clone();
    a.session.heads = vec![head.clone()];
    a.append_secret("secret_partial0001", "first")?;
    b.union_from(&a)?;

    a.session.heads = vec![head];
    a.append_secret("secret_partial0002", "second")?;
    // B has not synced the second append yet.
    let graph_a = a.session.store.load_graph(a.store_id())?;
    let graph_b = b.session.store.load_graph(b.store_id())?;
    assert_eq!(a.project()?.live_secrets(&graph_a).len(), 2);
    assert_eq!(b.project()?.live_secrets(&graph_b).len(), 1);

    b.union_from(&a)?;
    let graph_b = b.session.store.load_graph(b.store_id())?;
    assert_eq!(b.project()?.live_secrets(&graph_b).len(), 2);
    Ok(())
}

#[test]
fn union_order_does_not_change_projection() -> VaultResult<()> {
    let mut a = EventLogDevice::genesis("a")?;
    let head = a.session.heads[0].clone();
    a.session.heads = vec![head.clone()];
    a.append_secret("secret_order00001", "x")?;
    a.session.heads = vec![head];
    a.append_secret("secret_order00002", "y")?;

    let events = a.remote_events();
    let mut forward = EventLogDevice::replica_of(&a)?;
    let mut reverse = EventLogDevice::replica_of(&a)?;

    forward.session.union_remote(&events)?;
    for event in events.iter().rev() {
        reverse.session.union_remote(std::slice::from_ref(event))?;
    }

    let graph_f = forward.session.store.load_graph(forward.store_id())?;
    let graph_r = reverse.session.store.load_graph(reverse.store_id())?;
    assert_eq!(
        forward.project()?.live_secrets(&graph_f),
        reverse.project()?.live_secrets(&graph_r)
    );
    Ok(())
}
