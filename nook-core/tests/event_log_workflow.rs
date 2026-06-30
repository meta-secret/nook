//! Event-sourcing integration scenarios using the in-memory harness.

#[path = "event_log_harness.rs"]
mod harness;

use harness::{
    EventLogDevice, ProviderBuckets, push_device_outbox, sample_legacy_yaml,
    union_device_from_providers,
};
use nook_core::{
    AppendEventInput, EncryptedSecretPayload, EventError, SecretType, VaultOperation, VaultResult,
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
        old_id: "secret_original1".to_owned(),
        new_secret: EncryptedSecretPayload {
            id: "secret_newaaaaaaa".to_owned(),
            secret_type: SecretType::ApiKey,
            ciphertext: "cipher-secret_newaaaaaaa".to_owned(),
        },
    }])?;
    device.session.heads = vec![head];
    device.append_signed(vec![VaultOperation::SecretReplaced {
        old_id: "secret_original1".to_owned(),
        new_secret: EncryptedSecretPayload {
            id: "secret_newbbbbbbb".to_owned(),
            secret_type: SecretType::ApiKey,
            ciphertext: "cipher-secret_newbbbbbbb".to_owned(),
        },
    }])?;

    let graph = device.session.store.load_graph(device.store_id())?;
    let projection = device.project()?;
    assert!(
        projection
            .replacement_conflicts
            .contains_key("secret_original1")
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
            id: "secret_outoforder1".to_owned(),
            secret_type: SecretType::ApiKey,
            ciphertext: "cipher-child".to_owned(),
        },
    }];
    let (event, child_bytes) = build_signed_event(AppendEventInput {
        store_id: device.store_id(),
        actor_id: &device.actor_id()?,
        signing_identity: &device.session.signing,
        parents: vec![genesis_head.as_str().to_owned()],
        key_epoch: &device.session.key_epoch,
        created_at: TS,
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
            id: "secret_joinmerge1".to_owned(),
            secret_type: SecretType::ApiKey,
            ciphertext: "cipher-join".to_owned(),
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
        device_id: "device_revoked01".to_owned(),
    };
    let (new_secrets, _new_members) = device.session.rotate_security_epoch(
        trigger,
        &user_records,
        &device.secrets_key,
        &[],
        TS,
        Some("github"),
    )?;
    assert_ne!(new_secrets, device.secrets_key);
    device.secrets_key = new_secrets.clone();
    device.crypto = nook_core::VaultCrypto::new(&new_secrets)?;
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
