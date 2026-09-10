//! Integration tests for local ↔ remote vault replication using in-memory stores.
//!
//! Two (or more) [`MemoryVaultStore`] values stand in for local `IndexedDB` and
//! sync providers — no browser or network required.

use nook_core::RecordTypeDeclaration;
use nook_core::{VaultStoreIdentity, VaultStoreIdentityRef, VaultVersionWrite};

use nook_core::{
    MemoryVaultStore, RevisionGuardedWrite, SecretId, StoreRevision, StoreRevisionRef,
    StoredRecordPayload, StoredSecretRecord, VaultFormatDocument, VaultRecordSet, VaultSyncAction,
    VaultSyncComparison, VaultSyncError, VaultSyncFanOut, VaultSyncPair, VaultUnlock,
};
use std::collections::HashMap;

const STORE_ID: &str = "store_AAAAAAAAAAA";

struct VaultSyncFixture;

impl VaultSyncFixture {
    fn sample_yaml(version: u64, armor_line: &str) -> anyhow::Result<String> {
        Ok(VaultRecordSet::serialize_yaml_with_unlock(
        &[StoredSecretRecord {
            key: SecretId::from_vault_record("secret_SMypl8K0w9Y"),
            secret_type: RecordTypeDeclaration::Undeclared,
            value: StoredRecordPayload::from_trusted(format!(
                "-----BEGIN AGE ENCRYPTED FILE-----\n{armor_line}\n-----END AGE ENCRYPTED FILE-----"
            )),
        }],
        &VaultUnlock::Keys,
        &[],
        VaultStoreIdentityRef::Assigned(STORE_ID),
        VaultVersionWrite::Version(version.into()),
    )?
    .into_inner())
    }
}

#[test]
fn local_save_then_fan_out_replicates_to_all_providers() -> anyhow::Result<()> {
    let v3 = VaultSyncFixture::sample_yaml(3, "after-save")?;
    let local = MemoryVaultStore::with_blob(v3.clone());
    let remotes = HashMap::from([
        (
            "provider-alpha".to_owned(),
            MemoryVaultStore::with_blob(VaultSyncFixture::sample_yaml(1, "alpha-old")?),
        ),
        (
            "provider-beta".to_owned(),
            MemoryVaultStore::with_blob(VaultSyncFixture::sample_yaml(2, "beta-old")?),
        ),
    ]);

    let completed = VaultSyncFanOut::new(local, remotes).run()?;
    let (local, remotes, results) = (
        completed.stores.local,
        completed.stores.remotes,
        completed.actions,
    );
    let actions: HashMap<_, _> = results.into_iter().collect();
    assert_eq!(actions["provider-alpha"], VaultSyncAction::PushLocal);
    assert_eq!(actions["provider-beta"], VaultSyncAction::PushLocal);
    assert_eq!(remotes["provider-alpha"].blob(), v3);
    assert_eq!(remotes["provider-beta"].blob(), v3);
    assert_eq!(
        u64::from(VaultFormatDocument::new(remotes["provider-alpha"].blob()).version()?),
        3
    );
    Ok(())
}

#[test]
fn remote_ahead_adopts_into_local_on_reconcile() -> anyhow::Result<()> {
    let local = MemoryVaultStore::with_blob(VaultSyncFixture::sample_yaml(1, "local-copy")?);
    let remote_blob = VaultSyncFixture::sample_yaml(4, "remote-newer")?;
    let remote = MemoryVaultStore::with_blob(remote_blob.clone());

    let next = VaultSyncPair::new(local, remote).prepare()?.commit();
    let (local, remote, action) = (next.local, next.remote, next.action);
    assert_eq!(action, VaultSyncAction::AdoptRemote);
    assert_eq!(local.blob(), remote_blob);
    assert_eq!(
        u64::from(VaultFormatDocument::new(local.blob()).version()?),
        4
    );
    assert_eq!(
        VaultSyncComparison::new(local.blob(), remote.blob()).decide()?,
        VaultSyncAction::Unchanged
    );
    Ok(())
}

#[test]
fn same_version_divergence_surfaces_conflict_without_mutating_stores() -> anyhow::Result<()> {
    let local_blob = VaultSyncFixture::sample_yaml(2, "device-a-edit")?;
    let remote_blob = VaultSyncFixture::sample_yaml(2, "device-b-edit")?;
    let local = MemoryVaultStore::with_blob(local_blob.clone());
    let remote = MemoryVaultStore::with_blob(remote_blob.clone());

    let next = VaultSyncPair::new(local, remote).prepare()?.commit();
    let (local, remote, action) = (next.local, next.remote, next.action);
    assert_eq!(action, VaultSyncAction::Conflict);
    assert_eq!(local.blob(), local_blob);
    assert_eq!(remote.blob(), remote_blob);
    Ok(())
}

#[test]
fn stale_revision_write_reports_remote_changed_without_overwriting() -> anyhow::Result<()> {
    let local_save_blob = VaultSyncFixture::sample_yaml(3, "local-save")?;
    let concurrent_remote_blob = VaultSyncFixture::sample_yaml(3, "remote-save")?;
    let remote = MemoryVaultStore::with_blob_and_revision(concurrent_remote_blob.clone(), "rev-2");

    let result = remote.write_if_revision_matches_or_same_content(
        &local_save_blob,
        StoreRevisionRef::Version("rev-1"),
    );

    let rejected = result.expect_err("stale revision rejects");
    assert!(matches!(
        rejected.cause,
        VaultSyncError::RemoteChangedDuringWrite
    ));
    let remote = rejected.store;
    assert_eq!(remote.blob(), concurrent_remote_blob);
    assert_eq!(remote.revision(), StoreRevisionRef::Version("rev-2"));
    Ok(())
}

#[test]
fn stale_revision_write_is_idempotent_when_remote_already_has_same_blob() -> anyhow::Result<()> {
    let local_save_blob = VaultSyncFixture::sample_yaml(3, "same-save")?;
    let remote = MemoryVaultStore::with_blob_and_revision(local_save_blob.clone(), "rev-2");

    let result = remote.write_if_revision_matches_or_same_content(
        &local_save_blob,
        StoreRevisionRef::Version("rev-1"),
    )?;
    let (remote, outcome) = (result.store, result.outcome);

    assert_eq!(
        outcome,
        RevisionGuardedWrite::AlreadyPresent {
            revision: StoreRevision::Version("rev-2".to_owned())
        }
    );
    assert_eq!(remote.blob(), local_save_blob);
    assert_eq!(remote.revision(), StoreRevisionRef::Version("rev-2"));
    Ok(())
}

#[test]
fn resolve_conflict_keep_local_then_fan_out_unifies_providers() -> anyhow::Result<()> {
    let local_blob = VaultSyncFixture::sample_yaml(2, "keep-this")?;
    let remote_blob = VaultSyncFixture::sample_yaml(2, "drop-this")?;
    let local = MemoryVaultStore::with_blob(local_blob.clone());
    let stale_remote = MemoryVaultStore::with_blob(remote_blob);

    let next = VaultSyncPair::new(local, stale_remote).prepare()?.commit();
    assert_eq!(next.action, VaultSyncAction::Conflict);
    let (local, stale_remote) = (next.local, next.remote);

    let stale_remote = local.keep_local(stale_remote);
    assert_eq!(stale_remote.blob(), local_blob);

    let remotes = HashMap::from([(
        "other".to_owned(),
        MemoryVaultStore::with_blob(VaultSyncFixture::sample_yaml(1, "stale")?),
    )]);
    let completed = VaultSyncFanOut::new(local, remotes).run()?;
    let (local, remotes, results) = (
        completed.stores.local,
        completed.stores.remotes,
        completed.actions,
    );
    assert_eq!(results[0].1, VaultSyncAction::PushLocal);
    assert_eq!(remotes["other"].blob(), local_blob);
    Ok(())
}

#[test]
fn resolve_conflict_keep_remote_updates_local() -> anyhow::Result<()> {
    let local_blob = VaultSyncFixture::sample_yaml(2, "local-edit")?;
    let remote_blob = VaultSyncFixture::sample_yaml(2, "remote-edit")?;
    let local = MemoryVaultStore::with_blob(local_blob);
    let remote = MemoryVaultStore::with_blob(remote_blob.clone());

    let local = local.keep_remote(&remote);
    assert_eq!(local.blob(), remote_blob);
    Ok(())
}

#[test]
fn empty_remote_receives_push_on_first_sync() -> anyhow::Result<()> {
    let local_blob = VaultSyncFixture::sample_yaml(1, "bootstrap")?;
    let local = MemoryVaultStore::with_blob(local_blob.clone());
    let remote = MemoryVaultStore::new();

    let next = VaultSyncPair::new(local, remote).prepare()?.commit();
    assert_eq!(next.action, VaultSyncAction::PushLocal);
    let remote = next.remote;
    assert_eq!(remote.blob(), local_blob);
    Ok(())
}

#[test]
fn sequential_fan_out_stops_updating_local_when_remote_is_newer() -> anyhow::Result<()> {
    let store_id = STORE_ID;
    let local = MemoryVaultStore::with_blob(VaultSyncFixture::sample_yaml(2, "local")?);
    let remotes = HashMap::from([
        (
            "stale".to_owned(),
            MemoryVaultStore::with_blob(VaultSyncFixture::sample_yaml(1, "old")?),
        ),
        (
            "ahead".to_owned(),
            MemoryVaultStore::with_blob(VaultSyncFixture::sample_yaml(5, "newest")?),
        ),
    ]);

    let completed = VaultSyncFanOut::new(local, remotes).run()?;
    let (local, remotes, results) = (
        completed.stores.local,
        completed.stores.remotes,
        completed.actions,
    );
    let actions: HashMap<_, _> = results.into_iter().collect();
    assert_eq!(actions["stale"], VaultSyncAction::PushLocal);
    assert_eq!(actions["ahead"], VaultSyncAction::AdoptRemote);
    assert_eq!(local.blob(), remotes["ahead"].blob());
    assert_eq!(
        u64::from(VaultFormatDocument::new(local.blob()).version()?),
        5
    );
    assert_eq!(
        u64::from(VaultFormatDocument::new(remotes["stale"].blob()).version()?),
        5
    );
    assert_eq!(
        VaultFormatDocument::new(local.blob()).store_id()?,
        VaultStoreIdentity::Assigned(store_id.to_owned())
    );
    Ok(())
}

#[test]
fn later_provider_failure_retains_earlier_fan_out_effect() -> anyhow::Result<()> {
    let local_blob = VaultSyncFixture::sample_yaml(3, "canonical")?;
    let local = MemoryVaultStore::with_blob(local_blob.clone());
    let remotes = HashMap::from([
        (
            "a-first".to_owned(),
            MemoryVaultStore::with_blob(VaultSyncFixture::sample_yaml(1, "stale")?),
        ),
        (
            "b-invalid".to_owned(),
            MemoryVaultStore::with_blob("not-a-vault"),
        ),
    ]);

    let rejected = VaultSyncFanOut::new(local, remotes)
        .run()
        .expect_err("invalid provider rejects");
    let remotes = rejected.stores.remotes;
    assert_eq!(remotes["a-first"].blob(), local_blob);
    assert_eq!(remotes["b-invalid"].blob(), "not-a-vault");
    Ok(())
}

#[test]
fn trimmed_equal_guarded_write_preserves_remote_bytes_and_revision() -> anyhow::Result<()> {
    let remote_blob = VaultSyncFixture::sample_yaml(3, "same-save")?;
    let proposed = format!("  {remote_blob}  \n");
    let remote = MemoryVaultStore::with_blob_and_revision(remote_blob.clone(), "rev-2");

    let result = remote
        .write_if_revision_matches_or_same_content(proposed, StoreRevisionRef::Version("rev-1"))?;
    let (remote, outcome) = (result.store, result.outcome);

    assert_eq!(
        outcome,
        RevisionGuardedWrite::AlreadyPresent {
            revision: StoreRevision::Version("rev-2".to_owned())
        }
    );
    assert_eq!(remote.blob(), remote_blob);
    assert_eq!(remote.revision(), StoreRevisionRef::Version("rev-2"));
    Ok(())
}
