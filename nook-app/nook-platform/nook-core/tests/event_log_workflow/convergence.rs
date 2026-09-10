//! Projection, epoch, and delivery integration scenarios.
use super::*;
use nook_core::EventPublicationDestination;

#[test]
fn concurrent_replace_creates_conflict() -> VaultResult<()> {
    let mut device = EventLogDevice::genesis("main")?;
    match device.append_secret("secret_original1", "base") {
        Ok(outcome) => {
            device = outcome.device;
            Ok(outcome.event_id)
        }
        Err(rejected) => {
            device = rejected.device;
            Err(rejected.cause)
        }
    }?;
    let head = device.session.heads[0].clone();

    device.session.heads = vec![head.clone()];
    match device.append_signed(vec![VaultOperation::SecretReplaced {
        old_id: SecretId::from_vault_record("secret_original1"),
        new_secret: EncryptedSecretPayload {
            id: SecretId::from_vault_record("secret_newaaaaaaa"),
            secret_type: SecretType::ApiKey,
            ciphertext: OpaqueCiphertext::from_trusted("cipher-secret_newaaaaaaa".to_owned()),
            identity_fingerprint: test_fingerprint("replace-a-identity"),
            fingerprint: test_fingerprint("replace-a-version"),
        },
    }]) {
        Ok(outcome) => {
            device = outcome.device;
            Ok(outcome.event_id)
        }
        Err(rejected) => {
            device = rejected.device;
            Err(rejected.cause)
        }
    }?;
    device.session.heads = vec![head];
    match device.append_signed(vec![VaultOperation::SecretReplaced {
        old_id: SecretId::from_vault_record("secret_original1"),
        new_secret: EncryptedSecretPayload {
            id: SecretId::from_vault_record("secret_newbbbbbbb"),
            secret_type: SecretType::ApiKey,
            ciphertext: OpaqueCiphertext::from_trusted("cipher-secret_newbbbbbbb".to_owned()),
            identity_fingerprint: test_fingerprint("replace-b-identity"),
            fingerprint: test_fingerprint("replace-b-version"),
        },
    }]) {
        Ok(outcome) => {
            device = outcome.device;
            Ok(outcome.event_id)
        }
        Err(rejected) => {
            device = rejected.device;
            Err(rejected.cause)
        }
    }?;

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
fn causal_join_observes_all_heads_and_collapses_branch_vector() -> VaultResult<()> {
    let mut device = EventLogDevice::genesis("main")?;
    let genesis_head = device.session.heads[0].clone();

    device.session.heads = vec![genesis_head.clone()];
    let branch_a = match device.append_secret("secret_branchaaaa", "a") {
        Ok(outcome) => {
            device = outcome.device;
            Ok(outcome.event_id)
        }
        Err(rejected) => {
            device = rejected.device;
            Err(rejected.cause)
        }
    }?;
    device.session.heads = vec![genesis_head];
    let branch_b = match device.append_secret("secret_branchbbbb", "b") {
        Ok(outcome) => {
            device = outcome.device;
            Ok(outcome.event_id)
        }
        Err(rejected) => {
            device = rejected.device;
            Err(rejected.cause)
        }
    }?;

    let graph = device.session.store.load_graph(device.store_id())?;
    assert!(graph.are_concurrent(&branch_a, &branch_b));
    assert_eq!(graph.heads().len(), 2);

    device.session.heads = vec![branch_a.as_str().to_owned(), branch_b.as_str().to_owned()];
    let join = match device.append_secret("secret_joinvector", "joined") {
        Ok(outcome) => {
            device = outcome.device;
            Ok(outcome.event_id)
        }
        Err(rejected) => {
            device = rejected.device;
            Err(rejected.cause)
        }
    }?;

    let graph = device.session.store.load_graph(device.store_id())?;
    assert!(graph.is_ancestor(&branch_a, &join));
    assert!(graph.is_ancestor(&branch_b, &join));
    assert!(!graph.are_concurrent(&branch_a, &join));
    assert!(!graph.are_concurrent(&branch_b, &join));
    assert_eq!(graph.heads(), vec![join]);
    assert_eq!(live_secret_ids(&device)?.len(), 3);
    Ok(())
}

#[test]
fn out_of_order_delivery_becomes_applicable() -> VaultResult<()> {
    let device = EventLogDevice::genesis("main")?;
    let (genesis_head, genesis_bytes, child_id, child_bytes) =
        child_event_with_genesis(&device, "secret_outoforder1", "cipher-child")?;

    let mut store = LocalEventStore::new();
    store = store.put_event(nook_core::LocalEventWrite {
        event_id: child_id.clone(),
        bytes: child_bytes.into(),
    });
    let graph = store.load_graph(device.store_id())?;
    assert!(!graph.pending_events().is_empty());

    store = store.put_event(nook_core::LocalEventWrite {
        event_id: genesis_head.clone(),
        bytes: genesis_bytes.into(),
    });
    let graph = store.load_graph(device.store_id())?;
    assert!(graph.pending_events().is_empty());
    assert_eq!(graph.applicable_events().len(), 2);
    Ok(())
}

#[test]
fn pending_child_from_one_provider_applies_after_parent_arrives_from_another() -> VaultResult<()> {
    let device = EventLogDevice::genesis("main")?;
    let (genesis_head, genesis_bytes, child_id, child_bytes) =
        child_event_with_genesis(&device, "secret_splitparent", "cipher-split")?;

    let github_events = vec![(child_id, child_bytes)];
    let drive_events = vec![(genesis_head, genesis_bytes)];
    let mut joiner = EventLogDevice::replica_of(&device)?;

    match joiner.session.union_remote(&github_events) {
        Ok(outcome) => {
            joiner.session = outcome;
            Ok(())
        }
        Err(rejected) => {
            joiner.session = rejected.session;
            Err(rejected.cause)
        }
    }?;
    let graph = joiner.session.store.load_graph(joiner.store_id())?;
    assert_eq!(graph.pending_events().len(), 1);
    assert!(live_secret_ids(&joiner)?.is_empty());

    match joiner.session.union_remote(&drive_events) {
        Ok(outcome) => {
            joiner.session = outcome;
            Ok(())
        }
        Err(rejected) => {
            joiner.session = rejected.session;
            Err(rejected.cause)
        }
    }?;
    let graph = joiner.session.store.load_graph(joiner.store_id())?;
    assert!(graph.pending_events().is_empty());
    assert!(live_secret_ids(&joiner)?.contains("secret_splitparent"));
    Ok(())
}

#[test]
fn duplicate_union_is_idempotent() -> VaultResult<()> {
    let mut a = EventLogDevice::genesis("a")?;
    match a.append_secret("secret_duplicate1", "v") {
        Ok(outcome) => {
            a = outcome.device;
            Ok(outcome.event_id)
        }
        Err(rejected) => {
            a = rejected.device;
            Err(rejected.cause)
        }
    }?;
    let events = a.remote_events();

    let mut b = EventLogDevice::replica_of(&a)?;
    match b.session.union_remote(&events) {
        Ok(outcome) => {
            b.session = outcome;
            Ok(())
        }
        Err(rejected) => {
            b.session = rejected.session;
            Err(rejected.cause)
        }
    }?;
    match b.session.union_remote(&events) {
        Ok(outcome) => {
            b.session = outcome;
            Ok(())
        }
        Err(rejected) => {
            b.session = rejected.session;
            Err(rejected.cause)
        }
    }?;

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
    let a_id = match device.append_secret("secret_concurrenta", "a") {
        Ok(outcome) => {
            device = outcome.device;
            Ok(outcome.event_id)
        }
        Err(rejected) => {
            device = rejected.device;
            Err(rejected.cause)
        }
    }?;
    device.session.heads = vec![genesis_head.clone()];
    let b_id = match device.append_secret("secret_concurrentb", "b") {
        Ok(outcome) => {
            device = outcome.device;
            Ok(outcome.event_id)
        }
        Err(rejected) => {
            device = rejected.device;
            Err(rejected.cause)
        }
    }?;

    device.session.heads = vec![a_id.as_str().to_owned(), b_id.as_str().to_owned()];
    match device.append_signed(vec![VaultOperation::SecretCreated {
        secret: EncryptedSecretPayload {
            id: SecretId::from_vault_record("secret_joinmerge1"),
            secret_type: SecretType::ApiKey,
            ciphertext: OpaqueCiphertext::from_trusted("cipher-join".to_owned()),
            identity_fingerprint: test_fingerprint("join-identity"),
            fingerprint: test_fingerprint("join-version"),
        },
    }]) {
        Ok(outcome) => {
            device = outcome.device;
            Ok(outcome.event_id)
        }
        Err(rejected) => {
            device = rejected.device;
            Err(rejected.cause)
        }
    }?;

    let graph = device.session.store.load_graph(device.store_id())?;
    assert_eq!(graph.heads().len(), 1);
    Ok(())
}

#[test]
fn epoch_rotation_decrypts_under_new_key() -> VaultResult<()> {
    let mut device = EventLogDevice::genesis("main")?;
    match device.append_secret(
        "secret_epochrot1",
        "websiteUrl: https://example.com\nkey: rotate-me\nexpiresAt: ''\n",
    ) {
        Ok(outcome) => {
            device = outcome.device;
            Ok(outcome.event_id)
        }
        Err(rejected) => {
            device = rejected.device;
            Err(rejected.cause)
        }
    }?;
    let graph = device.session.store.load_graph(device.store_id())?;
    let user_records: Vec<_> = device
        .project()?
        .live_secrets(&graph)
        .into_values()
        .collect();

    let trigger = VaultOperation::DeviceRevoked {
        device_id: DeviceId::parse("abcd1234ef567890")?,
    };
    let old_secrets = SymmetricKey::parse(&device.secrets_key)?;
    let new_keys = nook_core::VaultKeys::generate()?;
    let before_events = device.session.store.event_ids();
    let before_outbox = device.session.store.pending_outbox("github");
    let wrong_old_keys = nook_core::VaultKeys::generate()?;
    assert!(
        match device
            .session
            .rotate_security_epoch(VaultSecurityEpochRotationInput {
                trigger: trigger.clone(),
                new_keys: &new_keys,
                user_records: &user_records,
                old_secrets_key: &wrong_old_keys.secrets_key,
                members_records: &[],
                rotated_meta_records: Vec::new(),
                rewrapped_password_entries: Vec::new(),
                created_at: TS,
                destination: EventPublicationDestination::Provider("github"),
            }) {
            Ok(outcome) => {
                device.session = outcome.session;
                Ok(outcome.keys)
            }
            Err(rejected) => {
                device.session = rejected.session;
                Err(rejected.cause)
            }
        }
        .is_err()
    );
    assert_eq!(device.session.store.event_ids(), before_events);
    assert_eq!(device.session.store.pending_outbox("github"), before_outbox);
    let rotated_keys = match device
        .session
        .rotate_security_epoch(VaultSecurityEpochRotationInput {
            trigger,
            new_keys: &new_keys,
            user_records: &user_records,
            old_secrets_key: &old_secrets,
            members_records: &[],
            rotated_meta_records: Vec::new(),
            rewrapped_password_entries: Vec::new(),
            created_at: TS,
            destination: EventPublicationDestination::Provider("github"),
        }) {
        Ok(outcome) => {
            device.session = outcome.session;
            Ok(outcome.keys)
        }
        Err(rejected) => {
            device.session = rejected.session;
            Err(rejected.cause)
        }
    }?;
    assert_ne!(rotated_keys.secrets_key.as_str(), device.secrets_key);
    device.secrets_key = rotated_keys.secrets_key.as_str().to_owned();
    device.crypto = VaultCrypto::new(&rotated_keys.secrets_key)?;
    device.crypto.encrypt_value("post-epoch")?;
    Ok(())
}

#[test]
fn provider_switch_outbox_flush_and_union() -> VaultResult<()> {
    let mut a = EventLogDevice::genesis("a")?;
    let mut providers: ProviderBuckets =
        HashMap::from([("github".to_owned(), LocalEventStore::new())]);

    providers = write_all_device_events_to_provider(&a, providers, "github")
        .map_err(|rejected| rejected.cause)?;

    let mut b = EventLogDevice::replica_of(&a)?;
    match union_device_from_providers(b, &providers) {
        Ok(outcome) => {
            b = outcome;
            Ok(())
        }
        Err(rejected) => {
            b = rejected.device;
            Err(rejected.cause)
        }
    }?;

    match a.append_secret("secret_outbox0001", "synced") {
        Ok(outcome) => {
            a = outcome.device;
            Ok(outcome.event_id)
        }
        Err(rejected) => {
            a = rejected.device;
            Err(rejected.cause)
        }
    }?;
    {
        let outcome = push_device_outbox(a, providers);
        a = outcome.device;
        providers = outcome.providers;
        Ok::<(), nook_core::VaultError>(())
    }?;
    match union_device_from_providers(b, &providers) {
        Ok(outcome) => {
            b = outcome;
            Ok(())
        }
        Err(rejected) => {
            b = rejected.device;
            Err(rejected.cause)
        }
    }?;

    let graph = b.session.store.load_graph(b.store_id())?;
    assert!(!b.project()?.live_secrets(&graph).is_empty());
    Ok(())
}

#[test]
fn provider_advanced_before_local_flush_keeps_both_event_log_writes() -> VaultResult<()> {
    let root = EventLogDevice::genesis("root")?;
    let mut local = EventLogDevice::replica_of(&root)?;
    let mut remote_device = EventLogDevice::replica_of(&root)?;
    let mut providers: ProviderBuckets =
        HashMap::from([("github".to_owned(), LocalEventStore::new())]);

    providers = write_all_device_events_to_provider(&root, providers, "github")
        .map_err(|rejected| rejected.cause)?;
    match union_device_from_providers(local, &providers) {
        Ok(outcome) => {
            local = outcome;
            Ok(())
        }
        Err(rejected) => {
            local = rejected.device;
            Err(rejected.cause)
        }
    }?;
    match union_device_from_providers(remote_device, &providers) {
        Ok(outcome) => {
            remote_device = outcome;
            Ok(())
        }
        Err(rejected) => {
            remote_device = rejected.device;
            Err(rejected.cause)
        }
    }?;

    let shared_head = root.session.heads[0].clone();
    local.session.heads = vec![shared_head.clone()];
    match local.append_secret("secret_localflush1", "local draft") {
        Ok(outcome) => {
            local = outcome.device;
            Ok(outcome.event_id)
        }
        Err(rejected) => {
            local = rejected.device;
            Err(rejected.cause)
        }
    }?;

    remote_device.session.heads = vec![shared_head];
    match remote_device.append_secret("secret_remotewrite", "remote draft") {
        Ok(outcome) => {
            remote_device = outcome.device;
            Ok(outcome.event_id)
        }
        Err(rejected) => {
            remote_device = rejected.device;
            Err(rejected.cause)
        }
    }?;
    {
        let outcome = push_device_outbox(remote_device, providers);
        remote_device = outcome.device;
        providers = outcome.providers;
        Ok::<(), nook_core::VaultError>(())
    }?;

    // This is the event-log equivalent of saving after the provider changed:
    // flushing a new immutable event must not overwrite the remote event.
    {
        let outcome = push_device_outbox(local, providers);
        local = outcome.device;
        providers = outcome.providers;
        Ok::<(), nook_core::VaultError>(())
    }?;

    let mut reloaded = EventLogDevice::replica_of(&root)?;
    match union_device_from_providers(reloaded, &providers) {
        Ok(outcome) => {
            reloaded = outcome;
            Ok(())
        }
        Err(rejected) => {
            reloaded = rejected.device;
            Err(rejected.cause)
        }
    }?;
    let graph = reloaded.session.store.load_graph(reloaded.store_id())?;
    let live = reloaded.project()?.live_secrets(&graph);

    assert!(live.contains_key("secret_localflush1"));
    assert!(live.contains_key("secret_remotewrite"));
    assert_eq!(live.len(), 2);
    assert_eq!(graph.heads().len(), 2);
    Ok(())
}

#[test]
fn three_device_decentralized_convergence() -> VaultResult<()> {
    let mut a = EventLogDevice::genesis("a")?;
    let mut b = EventLogDevice::replica_of(&a)?;
    let mut c = EventLogDevice::replica_of(&a)?;

    // All devices start from the same genesis.
    match b.union_from(&a) {
        Ok(outcome) => {
            b = outcome;
            Ok(())
        }
        Err(rejected) => {
            b = rejected.device;
            Err(rejected.cause)
        }
    }?;
    match c.union_from(&a) {
        Ok(outcome) => {
            c = outcome;
            Ok(())
        }
        Err(rejected) => {
            c = rejected.device;
            Err(rejected.cause)
        }
    }?;

    // Each device appends concurrently from the shared genesis head.
    let shared_head = a.session.heads[0].clone();
    a.session.heads = vec![shared_head.clone()];
    match a.append_secret("secret_deviceaaaa", "from-a") {
        Ok(outcome) => {
            a = outcome.device;
            Ok(outcome.event_id)
        }
        Err(rejected) => {
            a = rejected.device;
            Err(rejected.cause)
        }
    }?;
    b.session.heads = vec![shared_head.clone()];
    match b.append_secret("secret_devicebbbb", "from-b") {
        Ok(outcome) => {
            b = outcome.device;
            Ok(outcome.event_id)
        }
        Err(rejected) => {
            b = rejected.device;
            Err(rejected.cause)
        }
    }?;
    c.session.heads = vec![shared_head];
    match c.append_secret("secret_devicecccc", "from-c") {
        Ok(outcome) => {
            c = outcome.device;
            Ok(outcome.event_id)
        }
        Err(rejected) => {
            c = rejected.device;
            Err(rejected.cause)
        }
    }?;

    // Pairwise decentralized sync (no central coordinator).
    match a.union_from(&b) {
        Ok(outcome) => {
            a = outcome;
            Ok(())
        }
        Err(rejected) => {
            a = rejected.device;
            Err(rejected.cause)
        }
    }?;
    match a.union_from(&c) {
        Ok(outcome) => {
            a = outcome;
            Ok(())
        }
        Err(rejected) => {
            a = rejected.device;
            Err(rejected.cause)
        }
    }?;
    match b.union_from(&a) {
        Ok(outcome) => {
            b = outcome;
            Ok(())
        }
        Err(rejected) => {
            b = rejected.device;
            Err(rejected.cause)
        }
    }?;
    match b.union_from(&c) {
        Ok(outcome) => {
            b = outcome;
            Ok(())
        }
        Err(rejected) => {
            b = rejected.device;
            Err(rejected.cause)
        }
    }?;
    match c.union_from(&a) {
        Ok(outcome) => {
            c = outcome;
            Ok(())
        }
        Err(rejected) => {
            c = rejected.device;
            Err(rejected.cause)
        }
    }?;
    match c.union_from(&b) {
        Ok(outcome) => {
            c = outcome;
            Ok(())
        }
        Err(rejected) => {
            c = rejected.device;
            Err(rejected.cause)
        }
    }?;

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
    match b.union_from(&a) {
        Ok(outcome) => {
            b = outcome;
            Ok(())
        }
        Err(rejected) => {
            b = rejected.device;
            Err(rejected.cause)
        }
    }?;

    let head = a.session.heads[0].clone();
    a.session.heads = vec![head.clone()];
    match a.append_secret("secret_partial0001", "first") {
        Ok(outcome) => {
            a = outcome.device;
            Ok(outcome.event_id)
        }
        Err(rejected) => {
            a = rejected.device;
            Err(rejected.cause)
        }
    }?;
    match b.union_from(&a) {
        Ok(outcome) => {
            b = outcome;
            Ok(())
        }
        Err(rejected) => {
            b = rejected.device;
            Err(rejected.cause)
        }
    }?;

    a.session.heads = vec![head];
    match a.append_secret("secret_partial0002", "second") {
        Ok(outcome) => {
            a = outcome.device;
            Ok(outcome.event_id)
        }
        Err(rejected) => {
            a = rejected.device;
            Err(rejected.cause)
        }
    }?;
    // B has not synced the second append yet.
    let graph_a = a.session.store.load_graph(a.store_id())?;
    let graph_b = b.session.store.load_graph(b.store_id())?;
    assert_eq!(a.project()?.live_secrets(&graph_a).len(), 2);
    assert_eq!(b.project()?.live_secrets(&graph_b).len(), 1);

    match b.union_from(&a) {
        Ok(outcome) => {
            b = outcome;
            Ok(())
        }
        Err(rejected) => {
            b = rejected.device;
            Err(rejected.cause)
        }
    }?;
    let graph_b = b.session.store.load_graph(b.store_id())?;
    assert_eq!(b.project()?.live_secrets(&graph_b).len(), 2);
    Ok(())
}

#[test]
fn union_order_does_not_change_projection() -> VaultResult<()> {
    let mut a = EventLogDevice::genesis("a")?;
    let head = a.session.heads[0].clone();
    a.session.heads = vec![head.clone()];
    match a.append_secret("secret_order00001", "x") {
        Ok(outcome) => {
            a = outcome.device;
            Ok(outcome.event_id)
        }
        Err(rejected) => {
            a = rejected.device;
            Err(rejected.cause)
        }
    }?;
    a.session.heads = vec![head];
    match a.append_secret("secret_order00002", "y") {
        Ok(outcome) => {
            a = outcome.device;
            Ok(outcome.event_id)
        }
        Err(rejected) => {
            a = rejected.device;
            Err(rejected.cause)
        }
    }?;

    let events = a.remote_events();
    let mut forward = EventLogDevice::replica_of(&a)?;
    let mut reverse = EventLogDevice::replica_of(&a)?;

    match forward.session.union_remote(&events) {
        Ok(outcome) => {
            forward.session = outcome;
            Ok(())
        }
        Err(rejected) => {
            forward.session = rejected.session;
            Err(rejected.cause)
        }
    }?;
    for event in events.iter().rev() {
        match reverse.session.union_remote(slice::from_ref(event)) {
            Ok(outcome) => {
                reverse.session = outcome;
                Ok(())
            }
            Err(rejected) => {
                reverse.session = rejected.session;
                Err(rejected.cause)
            }
        }?;
    }

    let graph_f = forward.session.store.load_graph(forward.store_id())?;
    let graph_r = reverse.session.store.load_graph(reverse.store_id())?;
    assert_eq!(
        forward.project()?.live_secrets(&graph_f),
        reverse.project()?.live_secrets(&graph_r)
    );
    Ok(())
}
