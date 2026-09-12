//! Event-sourcing integration scenarios using the in-memory harness.

#![allow(clippy::result_large_err, clippy::too_many_lines)]

use nook_core::EventPublicationDestination;
use nook_core::LocalEventBytes;
use nook_core::{
    DeviceId, LocalEventStore, ObservedHeads, SigningIdentity, VaultCrypto, VaultError,
    VaultEventSession,
};

use std::slice;

#[path = "event_log_harness.rs"]
mod harness;

use harness::{
    EventLogDevice, ProviderBuckets, approve_join, live_secret_ids, missing_provider_bucket,
    pull_provider_into_device, push_device_outbox, request_join, union_device_from_providers,
    write_all_device_events_to_provider,
};
use nook_core::{
    AppendEventInput, EncryptedSecretPayload, EventError, EventId, IsoTimestamp, OpaqueCiphertext,
    SecretFingerprint, SecretId, SecretType, SecretValue, SecureNoteSecret, StoreId, SymmetricKey,
    VaultOperation, VaultResult, VaultSecurityEpochRotationInput,
};
use std::collections::{BTreeSet, HashMap};

const TS: &str = "2026-06-28T00:00:00Z";

impl EventLogDevice {
    fn expect_quarantine_unchanged(
        &self,
        result: VaultResult<()>,
        expected_id: &EventId,
        before: &VaultEventSession,
    ) -> anyhow::Result<()> {
        match result {
            Err(VaultError::Event(EventError::LocalAppendQuarantined { event_id, reason })) => {
                assert_eq!(&event_id, expected_id);
                assert_eq!(
                    reason,
                    format!(
                        "Event actor {} was not authorized in causal history",
                        self.actor_id()?
                    )
                );
            }
            _ => anyhow::bail!("expected typed local quarantine rejection"),
        }
        assert_eq!(self.session.heads, before.heads);
        assert_eq!(self.session.key_epoch, before.key_epoch);
        assert_eq!(self.session.store.event_ids(), before.store.event_ids());
        for id in before.store.event_ids() {
            assert_eq!(
                self.session.store.get_bytes(&id),
                before.store.get_bytes(&id)
            );
        }
        assert_eq!(
            self.session.store.pending_outbox("github"),
            before.store.pending_outbox("github")
        );
        assert!(matches!(
            self.session.store.get_bytes(expected_id),
            LocalEventBytes::UnknownEvent
        ));
        Ok(())
    }
}

#[test]
fn unauthorized_append_and_rotation_do_not_publish() -> anyhow::Result<()> {
    let mut device = EventLogDevice::genesis("owner")?;
    let (signing, seed) = SigningIdentity::generate()?;
    device.session.signing = signing;
    device.session.signing_seed = seed.into_inner();
    let before = device.session.clone();
    let trigger = VaultOperation::DeviceRevoked {
        device_id: DeviceId::parse("abcd1234ef567890")?,
    };
    let store_id = StoreId::parse(device.store_id())?;
    let (event, _) = nook_core::AppendEventInput::build(AppendEventInput {
        store_id: &store_id,
        actor_id: &device.actor_id()?,
        signing_identity: &device.session.signing,
        parents: ObservedHeads::parse(&device.session.heads)?.as_parents(),
        key_epoch: &EventId::parse(&device.session.key_epoch)?,
        created_at: &IsoTimestamp::parse(TS)?,
        operations: vec![trigger.clone()],
    })?;
    let expected_id = event.validate_envelope(&store_id)?;
    let result = match device
        .session
        .append_operations(nook_core::VaultEventAppend {
            operations: vec![trigger.clone()],
            created_at: TS,
            destination: EventPublicationDestination::Provider("github"),
        }) {
        Ok(outcome) => {
            device.session = outcome.session;
            Ok(outcome.event_id)
        }
        Err(rejected) => {
            device.session = rejected.session;
            Err(rejected.cause)
        }
    };
    device.expect_quarantine_unchanged(result.map(|_| ()), &expected_id, &before)?;

    let new_keys = nook_core::VaultKeys::generate()?;
    let old_secrets_key = SymmetricKey::parse(&device.secrets_key)?;
    let result = match device
        .session
        .rotate_security_epoch(VaultSecurityEpochRotationInput {
            trigger,
            new_keys: &new_keys,
            user_records: &[],
            old_secrets_key: &old_secrets_key,
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
    };
    device.expect_quarantine_unchanged(result.map(|_| ()), &expected_id, &before)?;
    Ok(())
}

#[test]
fn applied_pending_and_duplicate_appends_keep_publication_behavior() -> VaultResult<()> {
    let mut applied = EventLogDevice::genesis("owner")?;
    let genesis_heads = applied.session.heads.clone();
    let epoch = applied.session.key_epoch.clone();
    let mut pending = EventLogDevice::replica_of(&applied)?;
    pending.session.heads = genesis_heads.clone();
    let operation = VaultOperation::SecretDeleted {
        secret_id: SecretId::from_vault_record("secret_absent0001"),
    };
    let event_id = match applied.append_signed(vec![operation.clone()]) {
        Ok(outcome) => {
            applied = outcome.device;
            Ok(outcome.event_id)
        }
        Err(rejected) => {
            applied = rejected.device;
            Err(rejected.cause)
        }
    }?;
    assert_eq!(applied.session.heads, vec![event_id.as_str().to_owned()]);
    assert_eq!(applied.session.key_epoch, epoch);
    let graph = applied.session.store.load_graph(applied.store_id())?;
    assert_eq!(graph.applicable_events().len(), 2);
    assert!(graph.pending_events().is_empty());
    let pending_id = match pending.append_signed(vec![operation.clone()]) {
        Ok(outcome) => {
            pending = outcome.device;
            Ok(outcome.event_id)
        }
        Err(rejected) => {
            pending = rejected.device;
            Err(rejected.cause)
        }
    }?;
    assert_eq!(pending_id, event_id);
    assert_eq!(pending.session.heads, applied.session.heads);
    assert_eq!(pending.session.key_epoch, epoch);
    assert_eq!(
        pending.session.store.get_bytes(&event_id),
        applied.session.store.get_bytes(&event_id)
    );
    assert_eq!(
        pending
            .session
            .store
            .load_graph(pending.store_id())?
            .pending_events()
            .len(),
        1
    );
    let pending_outbox = pending.session.store.pending_outbox("github");
    assert_eq!(pending_outbox.len(), 1);
    let pending_event = pending_outbox
        .first()
        .unwrap_or_else(|| panic!("pending outbox event must exist"));
    assert_eq!(pending_event.0, event_id);
    assert_eq!(
        LocalEventBytes::Stored(pending_event.1.clone()),
        applied.session.store.get_bytes(&event_id)
    );

    let before_events = applied.remote_events();
    let before_outbox = applied.session.store.pending_outbox("github");
    assert!(before_outbox.contains(pending_event));
    applied.session.heads = genesis_heads;
    assert_eq!(
        match applied.append_signed(vec![operation]) {
            Ok(outcome) => {
                applied = outcome.device;
                Ok(outcome.event_id)
            }
            Err(rejected) => {
                applied = rejected.device;
                Err(rejected.cause)
            }
        }?,
        event_id
    );
    assert_eq!(applied.session.heads, pending.session.heads);
    assert_eq!(applied.session.key_epoch, epoch);
    assert_eq!(applied.remote_events(), before_events);
    assert_eq!(
        applied.session.store.pending_outbox("github"),
        before_outbox
    );
    Ok(())
}

fn test_fingerprint(label: &str) -> SecretFingerprint {
    SecretFingerprint::from_trusted(format!("test:{label}"))
}

fn event_id_set(device: &EventLogDevice) -> BTreeSet<String> {
    device
        .session
        .store
        .event_ids()
        .into_iter()
        .map(|id| id.as_str().to_owned())
        .collect()
}

fn provider_event_id_set(provider: &nook_core::LocalEventStore) -> BTreeSet<String> {
    provider
        .event_ids()
        .into_iter()
        .map(|id| id.as_str().to_owned())
        .collect()
}

fn expect_provider_event_sets_equal(
    providers: &ProviderBuckets,
    names: &[&str],
) -> VaultResult<()> {
    let mut iter = names.iter();
    let first_name = iter
        .next()
        .ok_or_else(|| missing_provider_bucket("provider-set"))?;
    let first = provider_event_id_set(
        providers
            .get(*first_name)
            .ok_or_else(|| missing_provider_bucket(first_name))?,
    );
    for name in iter {
        let current = provider_event_id_set(
            providers
                .get(*name)
                .ok_or_else(|| missing_provider_bucket(name))?,
        );
        assert_eq!(current, first, "{name} did not contain the same event set");
    }
    Ok(())
}

fn append_secure_note(
    device: EventLogDevice,
    secret_id: &str,
    title: &str,
    note: &str,
) -> Result<harness::DeviceAppended, harness::DeviceRejection> {
    let operation: VaultResult<_> = (|| {
        let value = SecretValue::SecureNote(SecureNoteSecret {
            title: title.to_owned(),
            note: note.to_owned(),
        });
        let secrets_key = SymmetricKey::parse(&device.secrets_key)?;
        let identity_fingerprint = value.identity_fingerprint(&secrets_key)?;
        let fingerprint = value.fingerprint(&secrets_key)?;
        let ciphertext = device.crypto.encrypt_value(value.to_yaml()?.as_str())?;
        Ok(VaultOperation::SecretCreated {
            secret: EncryptedSecretPayload::from_armored(
                &SecretId::from_vault_record(secret_id),
                SecretType::SecureNote,
                ciphertext.as_str(),
                identity_fingerprint,
                fingerprint,
            ),
        })
    })();
    match operation {
        Ok(operation) => device.append_signed(vec![operation]),
        Err(cause) => Err(harness::DeviceRejection { device, cause }),
    }
}

fn child_event_with_genesis(
    device: &EventLogDevice,
    secret_id: &str,
    ciphertext: &str,
) -> VaultResult<(EventId, Vec<u8>, EventId, Vec<u8>)> {
    let genesis_head = EventId::parse(
        device
            .session
            .heads
            .first()
            .unwrap_or_else(|| panic!("genesis head must exist")),
    )?;
    let genesis_bytes = match device.session.store.get_bytes(&genesis_head) {
        LocalEventBytes::Stored(bytes) => bytes.into(),
        LocalEventBytes::UnknownEvent => return Err(EventError::MissingGenesisBytes.into()),
    };
    let store_id = StoreId::parse(device.store_id())?;
    let actor_id = device.actor_id()?;
    let key_epoch = EventId::parse(&device.session.key_epoch)?;
    let created_at = IsoTimestamp::from_trusted(TS.to_owned());
    let (event, child_bytes) = AppendEventInput::build(AppendEventInput {
        store_id: &store_id,
        actor_id: &actor_id,
        signing_identity: &device.session.signing,
        parents: vec![genesis_head.clone()],
        key_epoch: &key_epoch,
        created_at: &created_at,
        operations: vec![VaultOperation::SecretCreated {
            secret: EncryptedSecretPayload {
                id: SecretId::from_vault_record(secret_id),
                secret_type: SecretType::ApiKey,
                ciphertext: OpaqueCiphertext::from_trusted(ciphertext.to_owned()),
                identity_fingerprint: test_fingerprint("child-identity"),
                fingerprint: test_fingerprint("child-version"),
            },
        }],
    })?;
    Ok((genesis_head, genesis_bytes, event.id()?, child_bytes.into()))
}

#[test]
fn two_device_genesis_append_and_union() -> VaultResult<()> {
    let mut a = EventLogDevice::genesis("a")?;
    let mut b = EventLogDevice::replica_of(&a)?;
    match a.append_secret("secret_deviceaaaa", "value-a") {
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
        ("common-vault".to_owned(), LocalEventStore::new()),
        ("common-vault-backup".to_owned(), LocalEventStore::new()),
        ("vault2-backup".to_owned(), LocalEventStore::new()),
    ]);

    // Device 1 creates the primary file-sync target and its local-file backup.
    match write_all_device_events_to_provider(&device1, providers, "common-vault") {
        Ok(outcome) => {
            providers = outcome;
            Ok(())
        }
        Err(rejected) => {
            providers = rejected.providers;
            Err(rejected.cause)
        }
    }?;
    match write_all_device_events_to_provider(&device1, providers, "common-vault-backup") {
        Ok(outcome) => {
            providers = outcome;
            Ok(())
        }
        Err(rejected) => {
            providers = rejected.providers;
            Err(rejected.cause)
        }
    }?;
    expect_provider_event_sets_equal(&providers, &["common-vault", "common-vault-backup"])?;

    // Device 2 onboards through the shared vault, then device 1 approves that request.
    let mut device2 = EventLogDevice::replica_of(&device1)?;
    match pull_provider_into_device(device2, &providers, "common-vault") {
        Ok(outcome) => {
            device2 = outcome;
            Ok(())
        }
        Err(rejected) => {
            device2 = rejected.device;
            Err(rejected.cause)
        }
    }?;
    let device2_identity = device2.identity.clone();
    let join = match request_join(device2, &device2_identity, "device 2") {
        Ok(outcome) => {
            device2 = outcome.device;
            Ok(outcome.join)
        }
        Err(rejected) => {
            device2 = rejected.device;
            Err(rejected.cause)
        }
    }?;
    match write_all_device_events_to_provider(&device2, providers, "common-vault") {
        Ok(outcome) => {
            providers = outcome;
            Ok(())
        }
        Err(rejected) => {
            providers = rejected.providers;
            Err(rejected.cause)
        }
    }?;
    match pull_provider_into_device(device1, &providers, "common-vault") {
        Ok(outcome) => {
            device1 = outcome;
            Ok(())
        }
        Err(rejected) => {
            device1 = rejected.device;
            Err(rejected.cause)
        }
    }?;
    match approve_join(device1, &join, "device 2") {
        Ok(outcome) => {
            device1 = outcome;
            Ok(())
        }
        Err(rejected) => {
            device1 = rejected.device;
            Err(rejected.cause)
        }
    }?;
    match write_all_device_events_to_provider(&device1, providers, "common-vault") {
        Ok(outcome) => {
            providers = outcome;
            Ok(())
        }
        Err(rejected) => {
            providers = rejected.providers;
            Err(rejected.cause)
        }
    }?;
    match pull_provider_into_device(device2, &providers, "common-vault") {
        Ok(outcome) => {
            device2 = outcome;
            Ok(())
        }
        Err(rejected) => {
            device2 = rejected.device;
            Err(rejected.cause)
        }
    }?;

    // Device 2 creates its own backup from the same replicated event graph.
    match write_all_device_events_to_provider(&device2, providers, "vault2-backup") {
        Ok(outcome) => {
            providers = outcome;
            Ok(())
        }
        Err(rejected) => {
            providers = rejected.providers;
            Err(rejected.cause)
        }
    }?;

    // A secure note saved on device 1 fans out to its primary and backup targets,
    // then device 2 pulls it from the shared vault and fans out to its backup.
    match append_secure_note(
        device1,
        "secret_replicaten",
        "Replication proof",
        "created on device 1",
    ) {
        Ok(outcome) => {
            device1 = outcome.device;
            Ok(outcome.event_id)
        }
        Err(rejected) => {
            device1 = rejected.device;
            Err(rejected.cause)
        }
    }?;
    match write_all_device_events_to_provider(&device1, providers, "common-vault") {
        Ok(outcome) => {
            providers = outcome;
            Ok(())
        }
        Err(rejected) => {
            providers = rejected.providers;
            Err(rejected.cause)
        }
    }?;
    match write_all_device_events_to_provider(&device1, providers, "common-vault-backup") {
        Ok(outcome) => {
            providers = outcome;
            Ok(())
        }
        Err(rejected) => {
            providers = rejected.providers;
            Err(rejected.cause)
        }
    }?;
    match pull_provider_into_device(device2, &providers, "common-vault") {
        Ok(outcome) => {
            device2 = outcome;
            Ok(())
        }
        Err(rejected) => {
            device2 = rejected.device;
            Err(rejected.cause)
        }
    }?;
    match write_all_device_events_to_provider(&device2, providers, "vault2-backup") {
        Ok(outcome) => {
            providers = outcome;
            Ok(())
        }
        Err(rejected) => {
            providers = rejected.providers;
            Err(rejected.cause)
        }
    }?;

    expect_provider_event_sets_equal(
        &providers,
        &["common-vault", "common-vault-backup", "vault2-backup"],
    )?;
    let common_vault_events = providers
        .get("common-vault")
        .ok_or_else(|| missing_provider_bucket("common-vault"))?
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

    match a.append_secret("secret_concurrenta", "a") {
        Ok(outcome) => {
            a = outcome.device;
            Ok(outcome.event_id)
        }
        Err(rejected) => {
            a = rejected.device;
            Err(rejected.cause)
        }
    }?;
    match b.append_secret("secret_concurrentb", "b") {
        Ok(outcome) => {
            b = outcome.device;
            Ok(outcome.event_id)
        }
        Err(rejected) => {
            b = rejected.device;
            Err(rejected.cause)
        }
    }?;

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
    match b.union_from(&a) {
        Ok(_) => Ok(()),
        Err(rejected) => Err(rejected.cause),
    }?;

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
    match a.union_from(&root) {
        Ok(outcome) => {
            a = outcome;
            Ok(())
        }
        Err(rejected) => {
            a = rejected.device;
            Err(rejected.cause)
        }
    }?;
    match b.union_from(&root) {
        Ok(outcome) => {
            b = outcome;
            Ok(())
        }
        Err(rejected) => {
            b = rejected.device;
            Err(rejected.cause)
        }
    }?;
    match c.union_from(&root) {
        Ok(outcome) => {
            c = outcome;
            Ok(())
        }
        Err(rejected) => {
            c = rejected.device;
            Err(rejected.cause)
        }
    }?;

    let shared_head = root
        .session
        .heads
        .first()
        .cloned()
        .unwrap_or_else(|| panic!("genesis head must exist"));
    a.session.heads = vec![shared_head.clone()];
    match a.append_secret("secret_unionaaaa", "from-a") {
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
    match b.append_secret("secret_unionbbbb", "from-b") {
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
    match c.append_secret("secret_unioncccc", "from-c") {
        Ok(outcome) => {
            c = outcome.device;
            Ok(outcome.event_id)
        }
        Err(rejected) => {
            c = rejected.device;
            Err(rejected.cause)
        }
    }?;

    let mut ab = a.remote_events();
    ab.extend(b.remote_events());
    let c_events = c.remote_events();

    let mut left_grouped = EventLogDevice::replica_of(&root)?;
    match left_grouped.union_from(&root) {
        Ok(outcome) => {
            left_grouped = outcome;
            Ok(())
        }
        Err(rejected) => {
            left_grouped = rejected.device;
            Err(rejected.cause)
        }
    }?;
    match left_grouped.session.union_remote(&ab) {
        Ok(outcome) => {
            left_grouped.session = outcome;
            Ok(())
        }
        Err(rejected) => {
            left_grouped.session = rejected.session;
            Err(rejected.cause)
        }
    }?;
    match left_grouped.session.union_remote(&c_events) {
        Ok(outcome) => {
            left_grouped.session = outcome;
            Ok(())
        }
        Err(rejected) => {
            left_grouped.session = rejected.session;
            Err(rejected.cause)
        }
    }?;
    // Duplicate delivery is allowed and must not change the materialized view.
    match left_grouped.session.union_remote(&ab) {
        Ok(outcome) => {
            left_grouped.session = outcome;
            Ok(())
        }
        Err(rejected) => {
            left_grouped.session = rejected.session;
            Err(rejected.cause)
        }
    }?;

    let mut cb = c.remote_events();
    cb.extend(b.remote_events());
    let a_events = a.remote_events();

    let mut right_grouped = EventLogDevice::replica_of(&root)?;
    match right_grouped.union_from(&root) {
        Ok(outcome) => {
            right_grouped = outcome;
            Ok(())
        }
        Err(rejected) => {
            right_grouped = rejected.device;
            Err(rejected.cause)
        }
    }?;
    match right_grouped.session.union_remote(&cb) {
        Ok(outcome) => {
            right_grouped.session = outcome;
            Ok(())
        }
        Err(rejected) => {
            right_grouped.session = rejected.session;
            Err(rejected.cause)
        }
    }?;
    match right_grouped.session.union_remote(&a_events) {
        Ok(outcome) => {
            right_grouped.session = outcome;
            Ok(())
        }
        Err(rejected) => {
            right_grouped.session = rejected.session;
            Err(rejected.cause)
        }
    }?;

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
    match laptop.union_from(&root) {
        Ok(outcome) => {
            laptop = outcome;
            Ok(())
        }
        Err(rejected) => {
            laptop = rejected.device;
            Err(rejected.cause)
        }
    }?;
    match phone.union_from(&root) {
        Ok(outcome) => {
            phone = outcome;
            Ok(())
        }
        Err(rejected) => {
            phone = rejected.device;
            Err(rejected.cause)
        }
    }?;
    match tablet.union_from(&root) {
        Ok(outcome) => {
            tablet = outcome;
            Ok(())
        }
        Err(rejected) => {
            tablet = rejected.device;
            Err(rejected.cause)
        }
    }?;

    let shared_head = root
        .session
        .heads
        .first()
        .cloned()
        .unwrap_or_else(|| panic!("genesis head must exist"));
    laptop.session.heads = vec![shared_head.clone()];
    match laptop.append_secret("secret_provideraa", "github") {
        Ok(outcome) => {
            laptop = outcome.device;
            Ok(outcome.event_id)
        }
        Err(rejected) => {
            laptop = rejected.device;
            Err(rejected.cause)
        }
    }?;
    phone.session.heads = vec![shared_head.clone()];
    match phone.append_secret("secret_providerbb", "drive") {
        Ok(outcome) => {
            phone = outcome.device;
            Ok(outcome.event_id)
        }
        Err(rejected) => {
            phone = rejected.device;
            Err(rejected.cause)
        }
    }?;
    tablet.session.heads = vec![shared_head];
    match tablet.append_secret("secret_providercc", "icloud") {
        Ok(outcome) => {
            tablet = outcome.device;
            Ok(outcome.event_id)
        }
        Err(rejected) => {
            tablet = rejected.device;
            Err(rejected.cause)
        }
    }?;

    let provider_a = laptop.remote_events();
    let provider_b = phone.remote_events();
    let provider_c = tablet.remote_events();

    let mut github_drive_icloud = EventLogDevice::replica_of(&root)?;
    match github_drive_icloud.session.union_remote(&provider_a) {
        Ok(outcome) => {
            github_drive_icloud.session = outcome;
            Ok(())
        }
        Err(rejected) => {
            github_drive_icloud.session = rejected.session;
            Err(rejected.cause)
        }
    }?;
    match github_drive_icloud.session.union_remote(&provider_b) {
        Ok(outcome) => {
            github_drive_icloud.session = outcome;
            Ok(())
        }
        Err(rejected) => {
            github_drive_icloud.session = rejected.session;
            Err(rejected.cause)
        }
    }?;
    match github_drive_icloud.session.union_remote(&provider_c) {
        Ok(outcome) => {
            github_drive_icloud.session = outcome;
            Ok(())
        }
        Err(rejected) => {
            github_drive_icloud.session = rejected.session;
            Err(rejected.cause)
        }
    }?;

    let mut icloud_drive_github = EventLogDevice::replica_of(&root)?;
    match icloud_drive_github.session.union_remote(&provider_c) {
        Ok(outcome) => {
            icloud_drive_github.session = outcome;
            Ok(())
        }
        Err(rejected) => {
            icloud_drive_github.session = rejected.session;
            Err(rejected.cause)
        }
    }?;
    match icloud_drive_github.session.union_remote(&provider_b) {
        Ok(outcome) => {
            icloud_drive_github.session = outcome;
            Ok(())
        }
        Err(rejected) => {
            icloud_drive_github.session = rejected.session;
            Err(rejected.cause)
        }
    }?;
    match icloud_drive_github.session.union_remote(&provider_a) {
        Ok(outcome) => {
            icloud_drive_github.session = outcome;
            Ok(())
        }
        Err(rejected) => {
            icloud_drive_github.session = rejected.session;
            Err(rejected.cause)
        }
    }?;

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

#[path = "event_log_workflow/convergence.rs"]
mod convergence;
