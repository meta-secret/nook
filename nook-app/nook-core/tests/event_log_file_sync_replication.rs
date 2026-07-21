//! File-sync provider replication scenarios for the vault event log.
//!
//! These model the WASM local-folder / file-sync path as content-addressed
//! provider buckets (`vault-a.yaml` style): join, disconnect, concurrent offline
//! edits, and reconnect. Domain sync semantics live here; Node wasm-bindgen
//! tests cannot drive the browser File System Access API.

#[path = "event_log_harness.rs"]
mod harness;

use harness::{EventLogDevice, ProviderBuckets};
use nook_core::{
    DeviceIdentity, DeviceSigningPublicKey, EncryptedSecretPayload, EventError, JoinRequest,
    MemberLabel, OpaqueCiphertext, SecretId, SecretType, VaultOperation, VaultResult,
};
use std::collections::{BTreeSet, HashMap};

const TS: &str = "2026-06-28T00:00:00Z";
const VAULT_A: &str = "vault-a";
const VAULT_A_DEVICE_B: &str = "vault-a-device-b";
const LOGIN_SITE: &str = "https://login-a-1.example.com";
const LOGIN_USER: &str = "alice";

fn live_secret_ids(device: &EventLogDevice) -> VaultResult<BTreeSet<String>> {
    let graph = device.session.store.load_graph(device.store_id())?;
    Ok(device
        .project()?
        .live_secrets(&graph)
        .keys()
        .cloned()
        .collect())
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

fn clear_provider(providers: &mut ProviderBuckets, provider: &str) -> VaultResult<()> {
    let bucket = providers
        .get_mut(provider)
        .ok_or(EventError::MissingProviderBucket)?;
    *bucket = nook_core::LocalEventStore::new();
    Ok(())
}

fn provider_event_count(providers: &ProviderBuckets, provider: &str) -> VaultResult<usize> {
    Ok(providers
        .get(provider)
        .ok_or(EventError::MissingProviderBucket)?
        .event_ids()
        .len())
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
        label: MemberLabel::from_trusted("device-b".to_owned()),
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
        label: MemberLabel::from_trusted("device-b".to_owned()),
        secrets_key_ciphertext,
        members_key_ciphertext,
    }])?;
    Ok(())
}

/// Device-a creates vault-a, device-b joins through the shared file provider.
fn enrolled_pair_with_file_providers()
-> VaultResult<(EventLogDevice, EventLogDevice, ProviderBuckets)> {
    let mut device_a = EventLogDevice::genesis("device-a")?;
    let mut providers: ProviderBuckets = HashMap::from([
        (VAULT_A.to_owned(), nook_core::LocalEventStore::new()),
        (
            VAULT_A_DEVICE_B.to_owned(),
            nook_core::LocalEventStore::new(),
        ),
    ]);

    write_all_device_events_to_provider(&device_a, &mut providers, VAULT_A)?;

    let mut device_b = EventLogDevice::replica_of(&device_a)?;
    pull_provider_into_device(&mut device_b, &providers, VAULT_A)?;
    let device_b_identity = device_b.identity.clone();
    let join = request_join(&mut device_b, &device_b_identity)?;
    write_all_device_events_to_provider(&device_b, &mut providers, VAULT_A)?;
    write_all_device_events_to_provider(&device_b, &mut providers, VAULT_A_DEVICE_B)?;

    pull_provider_into_device(&mut device_a, &providers, VAULT_A)?;
    approve_join(&mut device_a, &join)?;
    write_all_device_events_to_provider(&device_a, &mut providers, VAULT_A)?;
    pull_provider_into_device(&mut device_b, &providers, VAULT_A)?;
    write_all_device_events_to_provider(&device_b, &mut providers, VAULT_A_DEVICE_B)?;

    Ok((device_a, device_b, providers))
}

#[test]
fn disconnect_then_concurrent_same_identity_logins_both_survive_on_reconnect() -> VaultResult<()> {
    // 1–4. device-a owns vault-a; device-b joins and has its own file-sync target.
    let (mut device_a, mut device_b, mut providers) = enrolled_pair_with_file_providers()?;
    let shared_head = device_a.session.heads[0].clone();

    // 5. Remove the shared vault-a file-sync target (devices go offline from each other).
    clear_provider(&mut providers, VAULT_A)?;
    assert_eq!(provider_event_count(&providers, VAULT_A)?, 0);

    // 6–7. Concurrent offline creates of the same login identity, different passwords.
    device_a.session.heads = vec![shared_head.clone()];
    device_a.append_login(
        "secret_logina1aaaa",
        LOGIN_SITE,
        LOGIN_USER,
        "password-from-device-a",
        "created offline on device-a",
    )?;
    device_b.session.heads = vec![shared_head];
    device_b.append_login(
        "secret_logina1bbbb",
        LOGIN_SITE,
        LOGIN_USER,
        "password-from-device-b",
        "created offline on device-b",
    )?;

    // While disconnected, device-b can still write its local backup; vault-a stays empty.
    write_all_device_events_to_provider(&device_b, &mut providers, VAULT_A_DEVICE_B)?;
    assert_eq!(provider_event_count(&providers, VAULT_A)?, 0);

    // 8. device-b reconnects by attaching a fresh file-sync provider to vault-a.yaml.
    // Seed vault-a from device-a's offline history, then pull into device-b.
    write_all_device_events_to_provider(&device_a, &mut providers, VAULT_A)?;
    pull_provider_into_device(&mut device_b, &providers, VAULT_A)?;
    write_all_device_events_to_provider(&device_b, &mut providers, VAULT_A)?;
    pull_provider_into_device(&mut device_a, &providers, VAULT_A)?;

    let live_a = live_secret_ids(&device_a)?;
    let live_b = live_secret_ids(&device_b)?;
    assert_eq!(
        live_a.len(),
        2,
        "device-a must keep both concurrent creates"
    );
    assert_eq!(
        live_b, live_a,
        "both devices must converge to the same live set"
    );
    assert!(live_a.contains("secret_logina1aaaa"));
    assert!(live_a.contains("secret_logina1bbbb"));

    let passwords_a = device_a.decrypt_live_login_passwords()?;
    let passwords_b = device_b.decrypt_live_login_passwords()?;
    let expected = BTreeSet::from([
        "password-from-device-a".to_owned(),
        "password-from-device-b".to_owned(),
    ]);
    assert_eq!(passwords_a, expected, "neither password may be dropped");
    assert_eq!(passwords_b, expected);

    let identities_a = device_a.live_identity_fingerprints()?;
    let identities_b = device_b.live_identity_fingerprints()?;
    assert_eq!(identities_a.len(), 2);
    assert_eq!(identities_a[0], identities_a[1], "same login identity");
    assert_eq!(identities_b, identities_a);

    let graph = device_a.session.store.load_graph(device_a.store_id())?;
    let projection = device_a.project()?;
    assert!(
        !projection.has_blocking_conflicts(),
        "independent concurrent creates are not replacement conflicts"
    );
    assert!(projection.replacement_conflicts.is_empty());
    assert_eq!(graph.heads().len(), 2);
    Ok(())
}

#[test]
fn reconnect_keeps_identical_password_duplicates_as_separate_records() -> VaultResult<()> {
    let (mut device_a, mut device_b, mut providers) = enrolled_pair_with_file_providers()?;
    let shared_head = device_a.session.heads[0].clone();

    clear_provider(&mut providers, VAULT_A)?;

    device_a.session.heads = vec![shared_head.clone()];
    device_a.append_login(
        "secret_samepwdaaaa",
        LOGIN_SITE,
        LOGIN_USER,
        "same-password",
        "device-a",
    )?;
    device_b.session.heads = vec![shared_head];
    device_b.append_login(
        "secret_samepwdbbbb",
        LOGIN_SITE,
        LOGIN_USER,
        "same-password",
        "device-b",
    )?;

    write_all_device_events_to_provider(&device_a, &mut providers, VAULT_A)?;
    pull_provider_into_device(&mut device_b, &providers, VAULT_A)?;
    write_all_device_events_to_provider(&device_b, &mut providers, VAULT_A)?;
    pull_provider_into_device(&mut device_a, &providers, VAULT_A)?;

    assert_eq!(live_secret_ids(&device_a)?.len(), 2);
    assert_eq!(
        device_a.decrypt_live_login_passwords()?,
        BTreeSet::from(["same-password".to_owned()])
    );
    // Sync does not coalesce by version fingerprint the way import enrich does.
    assert_eq!(device_a.live_identity_fingerprints()?.len(), 2);
    Ok(())
}

#[test]
fn reconnect_after_mixed_offline_edits_converges_without_losing_either_branch() -> VaultResult<()> {
    let (mut device_a, mut device_b, mut providers) = enrolled_pair_with_file_providers()?;
    let shared_head = device_a.session.heads[0].clone();

    clear_provider(&mut providers, VAULT_A)?;

    device_a.session.heads = vec![shared_head.clone()];
    device_a.append_login(
        "secret_logina1aaaa",
        LOGIN_SITE,
        LOGIN_USER,
        "password-from-device-a",
        "",
    )?;
    device_a.append_login(
        "secret_onlyonaaaaa",
        "https://only-a.example.com",
        "bob",
        "only-a-password",
        "",
    )?;

    device_b.session.heads = vec![shared_head];
    device_b.append_login(
        "secret_logina1bbbb",
        LOGIN_SITE,
        LOGIN_USER,
        "password-from-device-b",
        "",
    )?;
    device_b.append_login(
        "secret_onlyonbbbbb",
        "https://only-b.example.com",
        "carol",
        "only-b-password",
        "",
    )?;

    write_all_device_events_to_provider(&device_a, &mut providers, VAULT_A)?;
    pull_provider_into_device(&mut device_b, &providers, VAULT_A)?;
    write_all_device_events_to_provider(&device_b, &mut providers, VAULT_A)?;
    pull_provider_into_device(&mut device_a, &providers, VAULT_A)?;
    write_all_device_events_to_provider(&device_b, &mut providers, VAULT_A_DEVICE_B)?;

    let live = live_secret_ids(&device_a)?;
    assert_eq!(live.len(), 4);
    assert_eq!(live_secret_ids(&device_b)?, live);
    assert_eq!(
        device_a.decrypt_live_login_passwords()?,
        BTreeSet::from([
            "password-from-device-a".to_owned(),
            "password-from-device-b".to_owned(),
            "only-a-password".to_owned(),
            "only-b-password".to_owned(),
        ])
    );
    Ok(())
}

#[test]
fn device_b_local_backup_alone_cannot_heal_cleared_shared_vault() -> VaultResult<()> {
    let (mut device_a, mut device_b, mut providers) = enrolled_pair_with_file_providers()?;
    let shared_head = device_a.session.heads[0].clone();

    clear_provider(&mut providers, VAULT_A)?;
    device_a.session.heads = vec![shared_head.clone()];
    device_a.append_login(
        "secret_logina1aaaa",
        LOGIN_SITE,
        LOGIN_USER,
        "password-from-device-a",
        "",
    )?;
    device_b.session.heads = vec![shared_head];
    device_b.append_login(
        "secret_logina1bbbb",
        LOGIN_SITE,
        LOGIN_USER,
        "password-from-device-b",
        "",
    )?;
    write_all_device_events_to_provider(&device_b, &mut providers, VAULT_A_DEVICE_B)?;

    // Pulling an empty shared vault must not erase device-b's local offline secret.
    pull_provider_into_device(&mut device_b, &providers, VAULT_A)?;
    assert_eq!(live_secret_ids(&device_b)?.len(), 1);
    assert!(live_secret_ids(&device_b)?.contains("secret_logina1bbbb"));

    // Healing requires reseeding vault-a from a device that still has the missing events.
    write_all_device_events_to_provider(&device_a, &mut providers, VAULT_A)?;
    pull_provider_into_device(&mut device_b, &providers, VAULT_A)?;
    assert_eq!(live_secret_ids(&device_b)?.len(), 2);
    Ok(())
}

#[test]
fn concurrent_replace_of_shared_secret_surfaces_conflict_group_after_reconnect() -> VaultResult<()>
{
    let (mut device_a, mut device_b, mut providers) = enrolled_pair_with_file_providers()?;
    device_a.append_login(
        "secret_sharedlogin",
        LOGIN_SITE,
        LOGIN_USER,
        "shared-password",
        "",
    )?;
    write_all_device_events_to_provider(&device_a, &mut providers, VAULT_A)?;
    pull_provider_into_device(&mut device_b, &providers, VAULT_A)?;
    write_all_device_events_to_provider(&device_b, &mut providers, VAULT_A_DEVICE_B)?;

    let shared_head = device_a.session.heads[0].clone();
    clear_provider(&mut providers, VAULT_A)?;

    device_a.session.heads = vec![shared_head.clone()];
    device_a.append_signed(vec![VaultOperation::SecretReplaced {
        old_id: SecretId::from_vault_record("secret_sharedlogin"),
        new_secret: EncryptedSecretPayload {
            id: SecretId::from_vault_record("secret_replaceaaaa"),
            secret_type: SecretType::Login,
            ciphertext: OpaqueCiphertext::from_trusted("cipher-replace-a".to_owned()),
            identity_fingerprint: None,
            fingerprint: None,
        },
    }])?;
    device_b.session.heads = vec![shared_head];
    device_b.append_signed(vec![VaultOperation::SecretReplaced {
        old_id: SecretId::from_vault_record("secret_sharedlogin"),
        new_secret: EncryptedSecretPayload {
            id: SecretId::from_vault_record("secret_replacebbbb"),
            secret_type: SecretType::Login,
            ciphertext: OpaqueCiphertext::from_trusted("cipher-replace-b".to_owned()),
            identity_fingerprint: None,
            fingerprint: None,
        },
    }])?;

    write_all_device_events_to_provider(&device_a, &mut providers, VAULT_A)?;
    pull_provider_into_device(&mut device_b, &providers, VAULT_A)?;
    write_all_device_events_to_provider(&device_b, &mut providers, VAULT_A)?;
    pull_provider_into_device(&mut device_a, &providers, VAULT_A)?;

    let projection = device_a.project()?;
    assert!(projection.has_blocking_conflicts());
    assert!(
        projection
            .replacement_conflicts
            .contains_key(&SecretId::from_vault_record("secret_sharedlogin"))
    );
    assert_eq!(live_secret_ids(&device_a)?.len(), 2);
    assert_eq!(live_secret_ids(&device_b)?, live_secret_ids(&device_a)?);
    Ok(())
}

#[test]
fn three_way_file_provider_fanout_keeps_concurrent_logins() -> VaultResult<()> {
    let (mut device_a, mut device_b, mut providers) = enrolled_pair_with_file_providers()?;
    providers.insert(
        "vault-a-backup".to_owned(),
        nook_core::LocalEventStore::new(),
    );
    write_all_device_events_to_provider(&device_a, &mut providers, "vault-a-backup")?;

    let mut device_c = EventLogDevice::replica_of(&device_a)?;
    pull_provider_into_device(&mut device_c, &providers, VAULT_A)?;
    let shared_head = device_a.session.heads[0].clone();

    device_a.session.heads = vec![shared_head.clone()];
    device_a.append_login(
        "secret_threewayaaa",
        "https://a.example.com",
        "a",
        "pw-a",
        "",
    )?;
    device_b.session.heads = vec![shared_head.clone()];
    device_b.append_login(
        "secret_threewaybbb",
        "https://b.example.com",
        "b",
        "pw-b",
        "",
    )?;
    device_c.session.heads = vec![shared_head];
    device_c.append_login(
        "secret_threewayccc",
        "https://c.example.com",
        "c",
        "pw-c",
        "",
    )?;

    // Each device publishes its offline branch into the shared vault (and backups).
    write_all_device_events_to_provider(&device_a, &mut providers, VAULT_A)?;
    write_all_device_events_to_provider(&device_a, &mut providers, "vault-a-backup")?;
    write_all_device_events_to_provider(&device_b, &mut providers, VAULT_A)?;
    write_all_device_events_to_provider(&device_b, &mut providers, VAULT_A_DEVICE_B)?;
    write_all_device_events_to_provider(&device_c, &mut providers, VAULT_A)?;

    pull_provider_into_device(&mut device_a, &providers, VAULT_A)?;
    pull_provider_into_device(&mut device_b, &providers, VAULT_A)?;
    pull_provider_into_device(&mut device_c, &providers, VAULT_A)?;
    write_all_device_events_to_provider(&device_a, &mut providers, "vault-a-backup")?;
    write_all_device_events_to_provider(&device_b, &mut providers, VAULT_A_DEVICE_B)?;

    for device in [&device_a, &device_b, &device_c] {
        assert_eq!(live_secret_ids(device)?.len(), 3);
        assert_eq!(
            device.decrypt_live_login_passwords()?,
            BTreeSet::from(["pw-a".to_owned(), "pw-b".to_owned(), "pw-c".to_owned()])
        );
    }
    assert_eq!(
        provider_event_count(&providers, VAULT_A)?,
        provider_event_count(&providers, "vault-a-backup")?
    );
    Ok(())
}
