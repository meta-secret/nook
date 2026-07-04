//! Integration tests for local ↔ remote vault replication using in-memory stores.
//!
//! Two (or more) [`MemoryVaultStore`] values stand in for local `IndexedDB` and
//! sync providers — no browser or network required.

use nook_core::{
    MemoryVaultStore, RevisionGuardedWrite, SecretId, StoredRecordPayload, StoredSecretRecord,
    VaultSyncAction, VaultSyncError, VaultUnlock, compare_vault_sync, fan_out_sync,
    read_vault_store_id, read_vault_version, reconcile_vault_stores, resolve_conflict_keep_local,
    resolve_conflict_keep_remote, serialize_stored_yaml_with_unlock,
};
use std::collections::HashMap;

const STORE_ID: &str = "store_AAAAAAAAAAA";

fn sample_yaml(version: u64, armor_line: &str) -> String {
    serialize_stored_yaml_with_unlock(
        &[StoredSecretRecord {
            key: SecretId::from_vault_record("secret_SMypl8K0w9Y"),
            secret_type: None,
            value: StoredRecordPayload::from_trusted(format!(
                "-----BEGIN AGE ENCRYPTED FILE-----\n{armor_line}\n-----END AGE ENCRYPTED FILE-----"
            )),
        }],
        &VaultUnlock::Keys,
        &[],
        Some(STORE_ID),
        Some(version),
    )
    .unwrap()
    .into_inner()
}

#[test]
fn local_save_then_fan_out_replicates_to_all_providers() {
    let v3 = sample_yaml(3, "after-save");
    let mut local = MemoryVaultStore::with_blob(v3.clone());
    let mut remotes = HashMap::from([
        (
            "provider-alpha".to_owned(),
            MemoryVaultStore::with_blob(sample_yaml(1, "alpha-old")),
        ),
        (
            "provider-beta".to_owned(),
            MemoryVaultStore::with_blob(sample_yaml(2, "beta-old")),
        ),
    ]);

    let results = fan_out_sync(&mut local, &mut remotes).unwrap();
    let actions: HashMap<_, _> = results.into_iter().collect();
    assert_eq!(actions["provider-alpha"], VaultSyncAction::PushLocal);
    assert_eq!(actions["provider-beta"], VaultSyncAction::PushLocal);
    assert_eq!(remotes["provider-alpha"].blob(), v3);
    assert_eq!(remotes["provider-beta"].blob(), v3);
    assert_eq!(
        read_vault_version(remotes["provider-alpha"].blob()).unwrap(),
        3
    );
}

#[test]
fn remote_ahead_adopts_into_local_on_reconcile() {
    let mut local = MemoryVaultStore::with_blob(sample_yaml(1, "local-copy"));
    let remote_blob = sample_yaml(4, "remote-newer");
    let mut remote = MemoryVaultStore::with_blob(remote_blob.clone());

    let action = reconcile_vault_stores(&mut local, &mut remote).unwrap();
    assert_eq!(action, VaultSyncAction::AdoptRemote);
    assert_eq!(local.blob(), remote_blob);
    assert_eq!(read_vault_version(local.blob()).unwrap(), 4);
    assert_eq!(
        compare_vault_sync(local.blob(), remote.blob()).unwrap(),
        VaultSyncAction::Unchanged
    );
}

#[test]
fn same_version_divergence_surfaces_conflict_without_mutating_stores() {
    let local_blob = sample_yaml(2, "device-a-edit");
    let remote_blob = sample_yaml(2, "device-b-edit");
    let mut local = MemoryVaultStore::with_blob(local_blob.clone());
    let mut remote = MemoryVaultStore::with_blob(remote_blob.clone());

    let action = reconcile_vault_stores(&mut local, &mut remote).unwrap();
    assert_eq!(action, VaultSyncAction::Conflict);
    assert_eq!(local.blob(), local_blob);
    assert_eq!(remote.blob(), remote_blob);
}

#[test]
fn stale_revision_write_reports_remote_changed_without_overwriting() {
    let local_save_blob = sample_yaml(3, "local-save");
    let concurrent_remote_blob = sample_yaml(3, "remote-save");
    let mut remote =
        MemoryVaultStore::with_blob_and_revision(concurrent_remote_blob.clone(), "rev-2");

    let result = remote.write_if_revision_matches_or_same_content(&local_save_blob, Some("rev-1"));

    assert!(matches!(
        result,
        Err(VaultSyncError::RemoteChangedDuringWrite)
    ));
    assert_eq!(remote.blob(), concurrent_remote_blob);
    assert_eq!(remote.revision(), Some("rev-2"));
}

#[test]
fn stale_revision_write_is_idempotent_when_remote_already_has_same_blob() {
    let local_save_blob = sample_yaml(3, "same-save");
    let mut remote = MemoryVaultStore::with_blob_and_revision(local_save_blob.clone(), "rev-2");

    let result = remote
        .write_if_revision_matches_or_same_content(&local_save_blob, Some("rev-1"))
        .unwrap();

    assert_eq!(
        result,
        RevisionGuardedWrite::AlreadyPresent {
            revision: Some("rev-2".to_owned())
        }
    );
    assert_eq!(remote.blob(), local_save_blob);
    assert_eq!(remote.revision(), Some("rev-2"));
}

#[test]
fn resolve_conflict_keep_local_then_fan_out_unifies_providers() {
    let local_blob = sample_yaml(2, "keep-this");
    let remote_blob = sample_yaml(2, "drop-this");
    let mut local = MemoryVaultStore::with_blob(local_blob.clone());
    let mut stale_remote = MemoryVaultStore::with_blob(remote_blob);

    assert_eq!(
        reconcile_vault_stores(&mut local, &mut stale_remote).unwrap(),
        VaultSyncAction::Conflict
    );

    resolve_conflict_keep_local(&local, &mut stale_remote);
    assert_eq!(stale_remote.blob(), local_blob);

    let mut remotes = HashMap::from([(
        "other".to_owned(),
        MemoryVaultStore::with_blob(sample_yaml(1, "stale")),
    )]);
    let results = fan_out_sync(&mut local, &mut remotes).unwrap();
    assert_eq!(results[0].1, VaultSyncAction::PushLocal);
    assert_eq!(remotes["other"].blob(), local_blob);
}

#[test]
fn resolve_conflict_keep_remote_updates_local() {
    let local_blob = sample_yaml(2, "local-edit");
    let remote_blob = sample_yaml(2, "remote-edit");
    let mut local = MemoryVaultStore::with_blob(local_blob);
    let remote = MemoryVaultStore::with_blob(remote_blob.clone());

    resolve_conflict_keep_remote(&mut local, &remote);
    assert_eq!(local.blob(), remote_blob);
}

#[test]
fn empty_remote_receives_push_on_first_sync() {
    let local_blob = sample_yaml(1, "bootstrap");
    let mut local = MemoryVaultStore::with_blob(local_blob.clone());
    let mut remote = MemoryVaultStore::new();

    assert_eq!(
        reconcile_vault_stores(&mut local, &mut remote).unwrap(),
        VaultSyncAction::PushLocal
    );
    assert_eq!(remote.blob(), local_blob);
}

#[test]
fn sequential_fan_out_stops_updating_local_when_remote_is_newer() {
    let store_id = STORE_ID;
    let mut local = MemoryVaultStore::with_blob(sample_yaml(2, "local"));
    let mut remotes = HashMap::from([
        (
            "stale".to_owned(),
            MemoryVaultStore::with_blob(sample_yaml(1, "old")),
        ),
        (
            "ahead".to_owned(),
            MemoryVaultStore::with_blob(sample_yaml(5, "newest")),
        ),
    ]);

    let results = fan_out_sync(&mut local, &mut remotes).unwrap();
    let actions: HashMap<_, _> = results.into_iter().collect();
    assert_eq!(actions["stale"], VaultSyncAction::PushLocal);
    assert_eq!(actions["ahead"], VaultSyncAction::AdoptRemote);
    assert_eq!(local.blob(), remotes["ahead"].blob());
    assert_eq!(read_vault_version(local.blob()).unwrap(), 5);
    assert_eq!(read_vault_version(remotes["stale"].blob()).unwrap(), 5);
    assert_eq!(
        read_vault_store_id(local.blob()).unwrap(),
        Some(store_id.to_owned())
    );
}
