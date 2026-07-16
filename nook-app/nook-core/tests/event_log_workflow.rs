//! Event-sourcing integration scenarios using the in-memory harness.

#[path = "event_log_harness.rs"]
mod harness;

use harness::{EventLogDevice, ProviderBuckets, push_device_outbox, union_device_from_providers};
use nook_core::{
    AppendEventInput, DeviceIdentity, DeviceSigningPublicKey, EncryptedSecretPayload, EventError,
    EventId, IsoTimestamp, JoinRequest, MemberLabel, OpaqueCiphertext, SecretId, SecretType,
    SecretValue, SecureNoteSecret, StoreId, VaultOperation, VaultResult, build_signed_event,
    encrypted_secret_from_armored,
};
use std::collections::{BTreeSet, HashMap};

const TS: &str = "2026-06-28T00:00:00Z";

fn event_id_set(device: &EventLogDevice) -> BTreeSet<String> {
    device
        .session
        .store
        .event_ids()
        .into_iter()
        .map(|id| id.as_str().to_owned())
        .collect()
}

fn live_secret_ids(device: &EventLogDevice) -> VaultResult<BTreeSet<String>> {
    let graph = device.session.store.load_graph(device.store_id())?;
    Ok(device
        .project()?
        .live_secrets(&graph)
        .keys()
        .cloned()
        .collect())
}

fn provider_event_id_set(provider: &nook_core::LocalEventStore) -> BTreeSet<String> {
    provider
        .event_ids()
        .into_iter()
        .map(|id| id.as_str().to_owned())
        .collect()
}

fn write_all_device_events_to_provider(
    device: &EventLogDevice,
    providers: &mut ProviderBuckets,
    provider: &str,
) -> VaultResult<()> {
    let bucket = providers
        .get_mut(provider)
        .ok_or(EventError::MissingProviderBucket)?;
    for (id, bytes) in device.remote_events() {
        if bucket.get_bytes(&id).is_none() {
            bucket.put_event(id, bytes);
        }
    }
    Ok(())
}

fn pull_provider_into_device(
    device: &mut EventLogDevice,
    providers: &ProviderBuckets,
    provider: &str,
) -> VaultResult<()> {
    let bucket = providers
        .get(provider)
        .ok_or(EventError::MissingProviderBucket)?;
    let events = bucket
        .event_ids()
        .into_iter()
        .filter_map(|id| bucket.get_bytes(&id).map(|bytes| (id, bytes.to_vec())))
        .collect::<Vec<_>>();
    device.session.union_remote(&events)
}

fn expect_provider_event_sets_equal(
    providers: &ProviderBuckets,
    names: &[&str],
) -> VaultResult<()> {
    let mut iter = names.iter();
    let first_name = iter.next().ok_or(EventError::MissingProviderBucket)?;
    let first = provider_event_id_set(
        providers
            .get(*first_name)
            .ok_or(EventError::MissingProviderBucket)?,
    );
    for name in iter {
        let current = provider_event_id_set(
            providers
                .get(*name)
                .ok_or(EventError::MissingProviderBucket)?,
        );
        assert_eq!(current, first, "{name} did not contain the same event set");
    }
    Ok(())
}

fn append_secure_note(
    device: &mut EventLogDevice,
    secret_id: &str,
    title: &str,
    note: &str,
) -> VaultResult<EventId> {
    let value = SecretValue::SecureNote(SecureNoteSecret {
        title: title.to_owned(),
        note: note.to_owned(),
    });
    let yaml = value.to_yaml()?;
    let ciphertext = device.crypto.encrypt_value(yaml.as_str())?;
    device.append_signed(vec![VaultOperation::SecretCreated {
        secret: encrypted_secret_from_armored(
            &SecretId::from_vault_record(secret_id),
            SecretType::SecureNote,
            ciphertext.as_str(),
            None,
        ),
    }])
}

fn request_join(device: &mut EventLogDevice, joiner: &DeviceIdentity) -> VaultResult<JoinRequest> {
    let join = JoinRequest {
        device_id: joiner.device_id().clone(),
        public_key: joiner.public_key(),
        signing_public_key: DeviceSigningPublicKey::from_trusted(String::new()),
        requested_at: TS.to_owned(),
    };
    device.append_signed(vec![VaultOperation::JoinRequested {
        device_id: joiner.device_id().clone(),
        encryption_public_key: joiner.public_key(),
        signing_public_key: DeviceSigningPublicKey::from_trusted(String::new()),
        label: MemberLabel::from_trusted("device 2".to_owned()),
    }])?;
    Ok(join)
}

fn approve_join(device: &mut EventLogDevice, join: &JoinRequest) -> VaultResult<()> {
    let secrets_key_ciphertext = device.crypto.encrypt_value(&device.secrets_key)?;
    let members_key_ciphertext = device.crypto.encrypt_value(&device.members_key)?;
    device.append_signed(vec![VaultOperation::JoinApproved {
        device_id: join.device_id.clone(),
        encryption_public_key: join.public_key.clone(),
        signing_public_key: join.signing_public_key.clone(),
        label: MemberLabel::from_trusted("device 2".to_owned()),
        secrets_key_ciphertext,
        members_key_ciphertext,
    }])?;
    Ok(())
}

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
fn file_provider_style_backups_replicate_secure_note_events() -> VaultResult<()> {
    let mut device1 = EventLogDevice::genesis("device 1")?;
    let mut providers: ProviderBuckets = HashMap::from([
        ("common-vault".to_owned(), nook_core::LocalEventStore::new()),
        (
            "common-vault-backup".to_owned(),
            nook_core::LocalEventStore::new(),
        ),
        (
            "vault2-backup".to_owned(),
            nook_core::LocalEventStore::new(),
        ),
    ]);

    // Device 1 creates the primary file-sync target and its local-file backup.
    write_all_device_events_to_provider(&device1, &mut providers, "common-vault")?;
    write_all_device_events_to_provider(&device1, &mut providers, "common-vault-backup")?;
    expect_provider_event_sets_equal(&providers, &["common-vault", "common-vault-backup"])?;

    // Device 2 onboards through the shared vault, then device 1 approves that request.
    let mut device2 = EventLogDevice::replica_of(&device1)?;
    pull_provider_into_device(&mut device2, &providers, "common-vault")?;
    let device2_identity = device2.identity.clone();
    let join = request_join(&mut device2, &device2_identity)?;
    write_all_device_events_to_provider(&device2, &mut providers, "common-vault")?;
    pull_provider_into_device(&mut device1, &providers, "common-vault")?;
    approve_join(&mut device1, &join)?;
    write_all_device_events_to_provider(&device1, &mut providers, "common-vault")?;
    pull_provider_into_device(&mut device2, &providers, "common-vault")?;

    // Device 2 creates its own backup from the same replicated event graph.
    write_all_device_events_to_provider(&device2, &mut providers, "vault2-backup")?;

    // A secure note saved on device 1 fans out to its primary and backup targets,
    // then device 2 pulls it from the shared vault and fans out to its backup.
    append_secure_note(
        &mut device1,
        "secret_replicaten",
        "Replication proof",
        "created on device 1",
    )?;
    write_all_device_events_to_provider(&device1, &mut providers, "common-vault")?;
    write_all_device_events_to_provider(&device1, &mut providers, "common-vault-backup")?;
    pull_provider_into_device(&mut device2, &providers, "common-vault")?;
    write_all_device_events_to_provider(&device2, &mut providers, "vault2-backup")?;

    expect_provider_event_sets_equal(
        &providers,
        &["common-vault", "common-vault-backup", "vault2-backup"],
    )?;
    let common_vault_events = providers
        .get("common-vault")
        .ok_or(EventError::MissingProviderBucket)?
        .event_ids();
    assert_eq!(
        common_vault_events.len(),
        4,
        "genesis + join request + join approval + secure note"
    );
    assert!(
        live_secret_ids(&device2)?.contains("secret_replicaten"),
        "device 2 did not materialize the secure note after pulling the shared vault"
    );
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
fn event_union_is_associative_commutative_and_idempotent_across_orders() -> VaultResult<()> {
    let root = EventLogDevice::genesis("root")?;
    let mut a = EventLogDevice::replica_of(&root)?;
    let mut b = EventLogDevice::replica_of(&root)?;
    let mut c = EventLogDevice::replica_of(&root)?;
    a.union_from(&root)?;
    b.union_from(&root)?;
    c.union_from(&root)?;

    let shared_head = root.session.heads[0].clone();
    a.session.heads = vec![shared_head.clone()];
    a.append_secret("secret_unionaaaa", "from-a")?;
    b.session.heads = vec![shared_head.clone()];
    b.append_secret("secret_unionbbbb", "from-b")?;
    c.session.heads = vec![shared_head];
    c.append_secret("secret_unioncccc", "from-c")?;

    let mut ab = a.remote_events();
    ab.extend(b.remote_events());
    let c_events = c.remote_events();

    let mut left_grouped = EventLogDevice::replica_of(&root)?;
    left_grouped.union_from(&root)?;
    left_grouped.session.union_remote(&ab)?;
    left_grouped.session.union_remote(&c_events)?;
    // Duplicate delivery is allowed and must not change the materialized view.
    left_grouped.session.union_remote(&ab)?;

    let mut cb = c.remote_events();
    cb.extend(b.remote_events());
    let a_events = a.remote_events();

    let mut right_grouped = EventLogDevice::replica_of(&root)?;
    right_grouped.union_from(&root)?;
    right_grouped.session.union_remote(&cb)?;
    right_grouped.session.union_remote(&a_events)?;

    assert_eq!(event_id_set(&left_grouped), event_id_set(&right_grouped));
    assert_eq!(
        live_secret_ids(&left_grouped)?,
        live_secret_ids(&right_grouped)?
    );
    assert_eq!(live_secret_ids(&left_grouped)?.len(), 3);
    let graph = left_grouped
        .session
        .store
        .load_graph(left_grouped.store_id())?;
    assert_eq!(graph.heads().len(), 3);
    Ok(())
}

#[test]
fn provider_delivery_order_does_not_change_event_set_or_projection() -> VaultResult<()> {
    let root = EventLogDevice::genesis("root")?;
    let mut laptop = EventLogDevice::replica_of(&root)?;
    let mut phone = EventLogDevice::replica_of(&root)?;
    let mut tablet = EventLogDevice::replica_of(&root)?;
    laptop.union_from(&root)?;
    phone.union_from(&root)?;
    tablet.union_from(&root)?;

    let shared_head = root.session.heads[0].clone();
    laptop.session.heads = vec![shared_head.clone()];
    laptop.append_secret("secret_provideraa", "github")?;
    phone.session.heads = vec![shared_head.clone()];
    phone.append_secret("secret_providerbb", "drive")?;
    tablet.session.heads = vec![shared_head];
    tablet.append_secret("secret_providercc", "icloud")?;

    let provider_a = laptop.remote_events();
    let provider_b = phone.remote_events();
    let provider_c = tablet.remote_events();

    let mut github_drive_icloud = EventLogDevice::replica_of(&root)?;
    github_drive_icloud.session.union_remote(&provider_a)?;
    github_drive_icloud.session.union_remote(&provider_b)?;
    github_drive_icloud.session.union_remote(&provider_c)?;

    let mut icloud_drive_github = EventLogDevice::replica_of(&root)?;
    icloud_drive_github.session.union_remote(&provider_c)?;
    icloud_drive_github.session.union_remote(&provider_b)?;
    icloud_drive_github.session.union_remote(&provider_a)?;

    assert_eq!(
        event_id_set(&github_drive_icloud),
        event_id_set(&icloud_drive_github)
    );
    assert_eq!(
        live_secret_ids(&github_drive_icloud)?,
        live_secret_ids(&icloud_drive_github)?
    );
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
            fingerprint: None,
        },
    }])?;
    device.session.heads = vec![head];
    device.append_signed(vec![VaultOperation::SecretReplaced {
        old_id: SecretId::from_vault_record("secret_original1"),
        new_secret: EncryptedSecretPayload {
            id: SecretId::from_vault_record("secret_newbbbbbbb"),
            secret_type: SecretType::ApiKey,
            ciphertext: OpaqueCiphertext::from_trusted("cipher-secret_newbbbbbbb".to_owned()),
            fingerprint: None,
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
fn causal_join_observes_all_heads_and_collapses_branch_vector() -> VaultResult<()> {
    let mut device = EventLogDevice::genesis("main")?;
    let genesis_head = device.session.heads[0].clone();

    device.session.heads = vec![genesis_head.clone()];
    let branch_a = device.append_secret("secret_branchaaaa", "a")?;
    device.session.heads = vec![genesis_head];
    let branch_b = device.append_secret("secret_branchbbbb", "b")?;

    let graph = device.session.store.load_graph(device.store_id())?;
    assert!(graph.are_concurrent(&branch_a, &branch_b));
    assert_eq!(graph.heads().len(), 2);

    device.session.heads = vec![branch_a.as_str().to_owned(), branch_b.as_str().to_owned()];
    let join = device.append_secret("secret_joinvector", "joined")?;

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
            fingerprint: None,
        },
    }];
    let store_id = StoreId::parse(device.store_id())?;
    let actor_id = device.actor_id()?;
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
fn pending_child_from_one_provider_applies_after_parent_arrives_from_another() -> VaultResult<()> {
    let device = EventLogDevice::genesis("main")?;
    let genesis_head = EventId::parse(&device.session.heads[0])?;
    let genesis_bytes = device
        .session
        .store
        .get_bytes(&genesis_head)
        .ok_or(EventError::MissingGenesisBytes)?
        .to_vec();

    let store_id = StoreId::parse(device.store_id())?;
    let actor_id = device.actor_id()?;
    let key_epoch = EventId::parse(&device.session.key_epoch)?;
    let created_at = IsoTimestamp::from_trusted(TS.to_owned());
    let (event, child_bytes) = build_signed_event(AppendEventInput {
        store_id: &store_id,
        actor_id: &actor_id,
        signing_identity: &device.session.signing,
        parents: vec![genesis_head.clone()],
        key_epoch: &key_epoch,
        created_at: &created_at,
        operations: vec![VaultOperation::SecretCreated {
            secret: EncryptedSecretPayload {
                id: SecretId::from_vault_record("secret_splitparent"),
                secret_type: SecretType::ApiKey,
                ciphertext: OpaqueCiphertext::from_trusted("cipher-split".to_owned()),
                fingerprint: None,
            },
        }],
    })?;
    let child_id = event.id()?;

    let github_events = vec![(child_id, child_bytes)];
    let drive_events = vec![(genesis_head, genesis_bytes)];
    let mut joiner = EventLogDevice::replica_of(&device)?;

    joiner.session.union_remote(&github_events)?;
    let graph = joiner.session.store.load_graph(joiner.store_id())?;
    assert_eq!(graph.pending_events().len(), 1);
    assert!(live_secret_ids(&joiner)?.is_empty());

    joiner.session.union_remote(&drive_events)?;
    let graph = joiner.session.store.load_graph(joiner.store_id())?;
    assert!(graph.pending_events().is_empty());
    assert!(live_secret_ids(&joiner)?.contains("secret_splitparent"));
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
            fingerprint: None,
        },
    }])?;

    let graph = device.session.store.load_graph(device.store_id())?;
    assert_eq!(graph.heads().len(), 1);
    Ok(())
}

#[test]
fn epoch_rotation_decrypts_under_new_key() -> VaultResult<()> {
    let mut device = EventLogDevice::genesis("main")?;
    device.append_secret(
        "secret_epochrot1",
        "websiteUrl: https://example.com\nkey: rotate-me\nexpiresAt: ''\n",
    )?;
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
fn provider_advanced_before_local_flush_keeps_both_event_log_writes() -> VaultResult<()> {
    let root = EventLogDevice::genesis("root")?;
    let mut local = EventLogDevice::replica_of(&root)?;
    let mut remote_device = EventLogDevice::replica_of(&root)?;
    let mut providers: ProviderBuckets =
        HashMap::from([("github".to_owned(), nook_core::LocalEventStore::new())]);

    for (id, bytes) in root.remote_events() {
        providers
            .get_mut("github")
            .ok_or(EventError::MissingProviderBucket)?
            .put_event(id, bytes);
    }
    union_device_from_providers(&mut local, &providers)?;
    union_device_from_providers(&mut remote_device, &providers)?;

    let shared_head = root.session.heads[0].clone();
    local.session.heads = vec![shared_head.clone()];
    local.append_secret("secret_localflush1", "local draft")?;

    remote_device.session.heads = vec![shared_head];
    remote_device.append_secret("secret_remotewrite", "remote draft")?;
    push_device_outbox(&mut remote_device, &mut providers)?;

    // This is the event-log equivalent of saving after the provider changed:
    // flushing a new immutable event must not overwrite the remote event.
    push_device_outbox(&mut local, &mut providers)?;

    let mut reloaded = EventLogDevice::replica_of(&root)?;
    union_device_from_providers(&mut reloaded, &providers)?;
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
