//! Projection, epoch, and delivery integration scenarios.
use super::*;
use nook_core::EventPublicationDestination;

#[test]
fn concurrent_replace_creates_conflict() -> VaultResult<()> {
    let mut device = EventLogDevice::genesis("main")?;
    device = device.append_secret("secret_original1", "base")?.device;
    let head = device
        .session
        .heads
        .first()
        .cloned()
        .unwrap_or_else(|| panic!("event head must exist"));

    device.session.heads = vec![head.clone()];
    device = device
        .append_signed(vec![VaultOperation::SecretReplaced {
            old_id: SecretId::from_vault_record("secret_original1"),
            new_secret: EncryptedSecretPayload {
                id: SecretId::from_vault_record("secret_newaaaaaaa"),
                secret_type: SecretType::ApiKey,
                ciphertext: OpaqueCiphertext::from_trusted("cipher-secret_newaaaaaaa".to_owned()),
                identity_fingerprint: test_fingerprint("replace-a-identity"),
                fingerprint: test_fingerprint("replace-a-version"),
            },
        }])?
        .device;
    device.session.heads = vec![head];
    device = device
        .append_signed(vec![VaultOperation::SecretReplaced {
            old_id: SecretId::from_vault_record("secret_original1"),
            new_secret: EncryptedSecretPayload {
                id: SecretId::from_vault_record("secret_newbbbbbbb"),
                secret_type: SecretType::ApiKey,
                ciphertext: OpaqueCiphertext::from_trusted("cipher-secret_newbbbbbbb".to_owned()),
                identity_fingerprint: test_fingerprint("replace-b-identity"),
                fingerprint: test_fingerprint("replace-b-version"),
            },
        }])?
        .device;

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
    let genesis_head = device
        .session
        .heads
        .first()
        .cloned()
        .unwrap_or_else(|| panic!("genesis head must exist"));

    device.session.heads = vec![genesis_head.clone()];
    let outcome = device.append_secret("secret_branchaaaa", "a")?;
    device = outcome.device;
    let branch_a = outcome.event_id;
    device.session.heads = vec![genesis_head];
    let outcome = device.append_secret("secret_branchbbbb", "b")?;
    device = outcome.device;
    let branch_b = outcome.event_id;

    let graph = device.session.store.load_graph(device.store_id())?;
    assert!(graph.are_concurrent(&branch_a, &branch_b));
    assert_eq!(graph.heads().len(), 2);

    device.session.heads = vec![branch_a.as_str().to_owned(), branch_b.as_str().to_owned()];
    let outcome = device.append_secret("secret_joinvector", "joined")?;
    device = outcome.device;
    let join = outcome.event_id;

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

    joiner.session = joiner
        .session
        .union_remote(&github_events)
        .map_err(|rejected| rejected.cause)?;
    let graph = joiner.session.store.load_graph(joiner.store_id())?;
    assert_eq!(graph.pending_events().len(), 1);
    assert!(live_secret_ids(&joiner)?.is_empty());

    joiner.session = joiner
        .session
        .union_remote(&drive_events)
        .map_err(|rejected| rejected.cause)?;
    let graph = joiner.session.store.load_graph(joiner.store_id())?;
    assert!(graph.pending_events().is_empty());
    assert!(live_secret_ids(&joiner)?.contains("secret_splitparent"));
    Ok(())
}

#[test]
fn duplicate_union_is_idempotent() -> VaultResult<()> {
    let mut a = EventLogDevice::genesis("a")?;
    a = a.append_secret("secret_duplicate1", "v")?.device;
    let events = a.remote_events();

    let mut b = EventLogDevice::replica_of(&a)?;
    b.session = b
        .session
        .union_remote(&events)
        .map_err(|rejected| rejected.cause)?;
    b.session = b
        .session
        .union_remote(&events)
        .map_err(|rejected| rejected.cause)?;

    assert_eq!(
        b.session.store.event_ids().len(),
        a.session.store.event_ids().len()
    );
    Ok(())
}

#[test]
fn join_merge_single_head() -> VaultResult<()> {
    let mut device = EventLogDevice::genesis("main")?;
    let genesis_head = device
        .session
        .heads
        .first()
        .cloned()
        .unwrap_or_else(|| panic!("genesis head must exist"));

    device.session.heads = vec![genesis_head.clone()];
    let outcome = device.append_secret("secret_concurrenta", "a")?;
    device = outcome.device;
    let a_id = outcome.event_id;
    device.session.heads = vec![genesis_head.clone()];
    let outcome = device.append_secret("secret_concurrentb", "b")?;
    device = outcome.device;
    let b_id = outcome.event_id;

    device.session.heads = vec![a_id.as_str().to_owned(), b_id.as_str().to_owned()];
    device = device
        .append_signed(vec![VaultOperation::SecretCreated {
            secret: EncryptedSecretPayload {
                id: SecretId::from_vault_record("secret_joinmerge1"),
                secret_type: SecretType::ApiKey,
                ciphertext: OpaqueCiphertext::from_trusted("cipher-join".to_owned()),
                identity_fingerprint: test_fingerprint("join-identity"),
                fingerprint: test_fingerprint("join-version"),
            },
        }])?
        .device;

    let graph = device.session.store.load_graph(device.store_id())?;
    assert_eq!(graph.heads().len(), 1);
    Ok(())
}

#[test]
fn epoch_rotation_decrypts_under_new_key() -> VaultResult<()> {
    let mut device = EventLogDevice::genesis("main")?;
    device = device
        .append_secret(
            "secret_epochrot1",
            "websiteUrl: https://example.com\nkey: rotate-me\nexpiresAt: ''\n",
        )?
        .device;
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
                vault_name: &nook_core::ProjectedVaultName::Unnamed,
                trigger: trigger.clone(),
                new_keys: &new_keys,
                user_records: &user_records,
                old_secrets_key: &wrong_old_keys.secrets_key,
                members_records: &[],
                rotated_meta_records: Vec::new(),
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
            vault_name: &nook_core::ProjectedVaultName::Unnamed,
            trigger,
            new_keys: &new_keys,
            user_records: &user_records,
            old_secrets_key: &old_secrets,
            members_records: &[],
            rotated_meta_records: Vec::new(),
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

    providers = write_all_device_events_to_provider(&a, providers, "github")?;

    let mut b = EventLogDevice::replica_of(&a)?;
    b = union_device_from_providers(b, &providers)?;

    a = a.append_secret("secret_outbox0001", "synced")?.device;
    {
        let outcome = push_device_outbox(a, providers);
        providers = outcome.providers;
        Ok::<(), nook_core::VaultError>(())
    }?;
    b = union_device_from_providers(b, &providers)?;

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

    providers = write_all_device_events_to_provider(&root, providers, "github")?;
    local = union_device_from_providers(local, &providers)?;
    remote_device = union_device_from_providers(remote_device, &providers)?;

    let shared_head = root
        .session
        .heads
        .first()
        .cloned()
        .unwrap_or_else(|| panic!("genesis head must exist"));
    local.session.heads = vec![shared_head.clone()];
    local = local
        .append_secret("secret_localflush1", "local draft")?
        .device;

    remote_device.session.heads = vec![shared_head];
    remote_device = remote_device
        .append_secret("secret_remotewrite", "remote draft")?
        .device;
    {
        let outcome = push_device_outbox(remote_device, providers);
        providers = outcome.providers;
        Ok::<(), nook_core::VaultError>(())
    }?;

    // This is the event-log equivalent of saving after the provider changed:
    // flushing a new immutable event must not overwrite the remote event.
    {
        let outcome = push_device_outbox(local, providers);
        providers = outcome.providers;
        Ok::<(), nook_core::VaultError>(())
    }?;

    let mut reloaded = EventLogDevice::replica_of(&root)?;
    reloaded = union_device_from_providers(reloaded, &providers)?;
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
    b = b.union_from(&a)?;
    c = c.union_from(&a)?;

    // Each device appends concurrently from the shared genesis head.
    let shared_head = a
        .session
        .heads
        .first()
        .cloned()
        .unwrap_or_else(|| panic!("genesis head must exist"));
    a.session.heads = vec![shared_head.clone()];
    a = a.append_secret("secret_deviceaaaa", "from-a")?.device;
    b.session.heads = vec![shared_head.clone()];
    b = b.append_secret("secret_devicebbbb", "from-b")?.device;
    c.session.heads = vec![shared_head];
    c = c.append_secret("secret_devicecccc", "from-c")?.device;

    // Pairwise decentralized sync (no central coordinator).
    a = a.union_from(&b)?;
    a = a.union_from(&c)?;
    b = b.union_from(&a)?;
    b = b.union_from(&c)?;
    c = c.union_from(&a)?;
    c = c.union_from(&b)?;

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
    b = b.union_from(&a)?;

    let head = a
        .session
        .heads
        .first()
        .cloned()
        .unwrap_or_else(|| panic!("event head must exist"));
    a.session.heads = vec![head.clone()];
    a = a.append_secret("secret_partial0001", "first")?.device;
    b = b.union_from(&a)?;

    a.session.heads = vec![head];
    a = a.append_secret("secret_partial0002", "second")?.device;
    // B has not synced the second append yet.
    let graph_a = a.session.store.load_graph(a.store_id())?;
    let graph_b = b.session.store.load_graph(b.store_id())?;
    assert_eq!(a.project()?.live_secrets(&graph_a).len(), 2);
    assert_eq!(b.project()?.live_secrets(&graph_b).len(), 1);

    b = b.union_from(&a)?;
    let graph_b = b.session.store.load_graph(b.store_id())?;
    assert_eq!(b.project()?.live_secrets(&graph_b).len(), 2);
    Ok(())
}

#[test]
fn union_order_does_not_change_projection() -> VaultResult<()> {
    let mut a = EventLogDevice::genesis("a")?;
    let head = a
        .session
        .heads
        .first()
        .cloned()
        .unwrap_or_else(|| panic!("event head must exist"));
    a.session.heads = vec![head.clone()];
    a = a.append_secret("secret_order00001", "x")?.device;
    a.session.heads = vec![head];
    a = a.append_secret("secret_order00002", "y")?.device;

    let events = a.remote_events();
    let mut forward = EventLogDevice::replica_of(&a)?;
    let mut reverse = EventLogDevice::replica_of(&a)?;

    forward.session = forward
        .session
        .union_remote(&events)
        .map_err(|rejected| rejected.cause)?;
    for event in events.iter().rev() {
        reverse.session = reverse
            .session
            .union_remote(slice::from_ref(event))
            .map_err(|rejected| rejected.cause)?;
    }

    let graph_f = forward.session.store.load_graph(forward.store_id())?;
    let graph_r = reverse.session.store.load_graph(reverse.store_id())?;
    assert_eq!(
        forward.project()?.live_secrets(&graph_f),
        reverse.project()?.live_secrets(&graph_r)
    );
    Ok(())
}
