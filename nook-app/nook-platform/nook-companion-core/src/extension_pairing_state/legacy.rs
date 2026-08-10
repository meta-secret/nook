use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use super::{
    EXTENSION_SETUP_KEY, ExtensionConnectScope, ExtensionPairingEntry, ExtensionPairingRecord,
    ExtensionPairingState, ExtensionPairingStateError, ExtensionPairingVaultType,
    ExtensionReadySetupStatus, StoredExtensionPairingGrant, grant_storage_key, non_empty,
    setup_from_grant,
};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct LegacyStoredExtensionPairingGrant {
    vault_type: ExtensionPairingVaultType,
    device_id: String,
    device_public_key: String,
    device_signing_public_key: String,
    device_label: String,
    vault_store_id: String,
    vault_name: String,
    approved_at: String,
    scopes: Vec<ExtensionConnectScope>,
    sync_provider_count: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct LegacyExtensionReadySetup {
    status: ExtensionReadySetupStatus,
    device_label: String,
    paired_vaults: Vec<String>,
    selected_vault_name: String,
    sync_provider_count: u32,
    event_count: u32,
    event_log_heads: Vec<String>,
    last_local_sync_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(untagged)]
enum LegacyExtensionPairingRecord {
    CompleteGrant(StoredExtensionPairingGrant),
    Grant(LegacyStoredExtensionPairingGrant),
    Setup(LegacyExtensionReadySetup),
}

pub fn migrate_legacy_pairing_state_json(
    value: &str,
) -> Result<ExtensionPairingState, ExtensionPairingStateError> {
    let records: HashMap<String, LegacyExtensionPairingRecord> =
        serde_json::from_str(value).map_err(|_| ExtensionPairingStateError::InvalidLegacyState)?;
    let setup = records
        .get(EXTENSION_SETUP_KEY)
        .and_then(|record| match record {
            LegacyExtensionPairingRecord::Setup(setup) => Some(setup),
            LegacyExtensionPairingRecord::CompleteGrant(_)
            | LegacyExtensionPairingRecord::Grant(_) => None,
        })
        .cloned()
        .ok_or(ExtensionPairingStateError::InvalidLegacyState)?;
    if setup.status != ExtensionReadySetupStatus::Ready
        || !non_empty(&setup.device_label)
        || setup.paired_vaults.is_empty()
        || setup.paired_vaults.iter().any(|vault| !non_empty(vault))
    {
        return Err(ExtensionPairingStateError::InvalidLegacyState);
    }
    let mut matching = records.iter().filter_map(|(key, record)| match record {
        LegacyExtensionPairingRecord::CompleteGrant(grant)
            if grant.vault_name == setup.selected_vault_name =>
        {
            Some(key)
        }
        LegacyExtensionPairingRecord::Grant(grant)
            if grant.vault_name == setup.selected_vault_name =>
        {
            Some(key)
        }
        LegacyExtensionPairingRecord::CompleteGrant(_)
        | LegacyExtensionPairingRecord::Grant(_)
        | LegacyExtensionPairingRecord::Setup(_) => None,
    });
    let Some(selected_key) = matching.next().cloned() else {
        return Err(ExtensionPairingStateError::InvalidLegacyState);
    };
    if matching.next().is_some() {
        return Err(ExtensionPairingStateError::InvalidLegacyState);
    }
    let mut entries = Vec::with_capacity(records.len());
    let mut selected = None;
    for (key, record) in records {
        let grant = match record {
            LegacyExtensionPairingRecord::CompleteGrant(grant) => grant,
            LegacyExtensionPairingRecord::Grant(grant) if key == selected_key => {
                StoredExtensionPairingGrant {
                    vault_type: grant.vault_type,
                    device_id: grant.device_id,
                    device_public_key: grant.device_public_key,
                    device_signing_public_key: grant.device_signing_public_key,
                    device_label: grant.device_label,
                    vault_store_id: grant.vault_store_id,
                    vault_name: grant.vault_name,
                    approved_at: grant.approved_at,
                    scopes: grant.scopes,
                    sync_provider_count: grant.sync_provider_count,
                    event_count: setup.event_count,
                    event_log_heads: setup.event_log_heads.clone(),
                    last_local_sync_at: setup.last_local_sync_at.clone(),
                }
            }
            LegacyExtensionPairingRecord::Grant(_) | LegacyExtensionPairingRecord::Setup(_) => {
                continue;
            }
        };
        if key != grant_storage_key(&grant.vault_store_id) {
            return Err(ExtensionPairingStateError::InvalidLegacyState);
        }
        if key == selected_key {
            selected = Some(grant.clone());
        }
        entries.push(ExtensionPairingEntry {
            key,
            record: ExtensionPairingRecord::Grant(grant),
        });
    }
    let selected = selected.ok_or(ExtensionPairingStateError::InvalidLegacyState)?;
    if setup.sync_provider_count != selected.sync_provider_count {
        return Err(ExtensionPairingStateError::InvalidLegacyState);
    }
    let migrated_vault_names: std::collections::HashSet<_> = entries
        .iter()
        .filter_map(|entry| match &entry.record {
            ExtensionPairingRecord::Grant(grant) => Some(grant.vault_name.as_str()),
            ExtensionPairingRecord::Setup(_) => None,
        })
        .collect();
    let mut ready_setup = setup_from_grant(&selected);
    ready_setup.paired_vaults = setup
        .paired_vaults
        .into_iter()
        .filter(|vault_name| migrated_vault_names.contains(vault_name.as_str()))
        .collect();
    entries.push(ExtensionPairingEntry {
        key: EXTENSION_SETUP_KEY.to_owned(),
        record: ExtensionPairingRecord::Setup(ready_setup),
    });
    let state = ExtensionPairingState { entries };
    state.validate()?;
    Ok(state)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn grant() -> StoredExtensionPairingGrant {
        StoredExtensionPairingGrant {
            vault_type: ExtensionPairingVaultType::Simple,
            device_id: "device-test".to_owned(),
            device_public_key: "age1test".to_owned(),
            device_signing_public_key: "signing-test".to_owned(),
            device_label: "Nook Extension".to_owned(),
            vault_store_id: "store-test".to_owned(),
            vault_name: "Personal".to_owned(),
            approved_at: "2026-07-25T00:00:00.000Z".to_owned(),
            scopes: vec![ExtensionConnectScope::PasswordFilling],
            sync_provider_count: 1,
            event_count: 2,
            event_log_heads: vec!["event-2".to_owned()],
            last_local_sync_at: "2026-07-25T00:00:01.000Z".to_owned(),
        }
    }

    fn legacy_grant(vault_store_id: &str) -> LegacyStoredExtensionPairingGrant {
        LegacyStoredExtensionPairingGrant {
            vault_type: ExtensionPairingVaultType::Simple,
            device_id: "device-test".to_owned(),
            device_public_key: "age1test".to_owned(),
            device_signing_public_key: "signing-test".to_owned(),
            device_label: "Nook Extension".to_owned(),
            vault_store_id: vault_store_id.to_owned(),
            vault_name: "Personal".to_owned(),
            approved_at: "2026-07-25T00:00:00.000Z".to_owned(),
            scopes: vec![ExtensionConnectScope::PasswordFilling],
            sync_provider_count: 1,
        }
    }

    fn legacy_setup() -> LegacyExtensionReadySetup {
        LegacyExtensionReadySetup {
            status: ExtensionReadySetupStatus::Ready,
            device_label: "Nook Extension".to_owned(),
            paired_vaults: vec!["Personal".to_owned()],
            selected_vault_name: "Personal".to_owned(),
            sync_provider_count: 1,
            event_count: 2,
            event_log_heads: vec!["event-2".to_owned()],
            last_local_sync_at: "2026-07-25T00:00:01.000Z".to_owned(),
        }
    }

    fn legacy_pairing_state(
        grant: LegacyStoredExtensionPairingGrant,
        setup: LegacyExtensionReadySetup,
    ) -> HashMap<String, LegacyExtensionPairingRecord> {
        let mut records = HashMap::new();
        records.insert(
            grant_storage_key(&grant.vault_store_id),
            LegacyExtensionPairingRecord::Grant(grant),
        );
        records.insert(
            EXTENSION_SETUP_KEY.to_owned(),
            LegacyExtensionPairingRecord::Setup(setup),
        );
        records
    }

    #[test]
    fn migrates_a_valid_legacy_pairing_state_into_typed_domain_records() -> anyhow::Result<()> {
        let records = legacy_pairing_state(legacy_grant("store-test"), legacy_setup());
        let serialized = serde_json::to_string(&records)?;

        let migrated = migrate_legacy_pairing_state_json(&serialized)?;
        let selected = migrated
            .selected_grant()
            .ok_or_else(|| anyhow::anyhow!("migrated state must select its grant"))?;

        assert_eq!(selected.vault_store_id, "store-test");
        assert_eq!(selected.event_count, 2);
        assert_eq!(selected.event_log_heads, vec!["event-2"]);
        assert_eq!(selected.last_local_sync_at, "2026-07-25T00:00:01.000Z");
        migrated.validate()?;
        Ok(())
    }

    #[test]
    fn migration_preserves_complete_non_selected_pairing_grants() -> anyhow::Result<()> {
        let mut setup = legacy_setup();
        setup.paired_vaults.push("Team".to_owned());
        let mut records = legacy_pairing_state(legacy_grant("store-test"), setup);
        let mut team = grant();
        team.vault_store_id = "store-team".to_owned();
        team.vault_name = "Team".to_owned();
        team.event_count = 7;
        team.event_log_heads = vec!["event-team-7".to_owned()];
        records.insert(
            grant_storage_key(&team.vault_store_id),
            LegacyExtensionPairingRecord::CompleteGrant(team.clone()),
        );
        let serialized = serde_json::to_string(&records)?;

        let migrated = migrate_legacy_pairing_state_json(&serialized)?;

        assert_eq!(migrated.ordered_grants().len(), 2);
        assert_eq!(migrated.grant("store-team"), Some(&team));
        assert_eq!(
            migrated
                .ready_setup()
                .map(|setup| setup.paired_vaults.clone()),
            Some(vec!["Personal".to_owned(), "Team".to_owned()])
        );
        assert_eq!(
            migrated.selected_grant().map(|grant| grant.vault_store_id),
            Some("store-test".to_owned())
        );
        Ok(())
    }

    #[test]
    fn migration_quarantines_incomplete_non_selected_pairing_grants() -> anyhow::Result<()> {
        let mut setup = legacy_setup();
        setup.paired_vaults.push("Team".to_owned());
        let mut records = legacy_pairing_state(legacy_grant("store-test"), setup);
        let mut incomplete_team = legacy_grant("store-team");
        incomplete_team.vault_name = "Team".to_owned();
        records.insert(
            grant_storage_key(&incomplete_team.vault_store_id),
            LegacyExtensionPairingRecord::Grant(incomplete_team),
        );
        let serialized = serde_json::to_string(&records)?;

        let migrated = migrate_legacy_pairing_state_json(&serialized)?;

        assert_eq!(migrated.ordered_grants().len(), 1);
        assert_eq!(migrated.grant("store-team"), None);
        assert_eq!(
            migrated
                .ready_setup()
                .map(|setup| setup.paired_vaults.clone()),
            Some(vec!["Personal".to_owned()])
        );
        migrated.validate()?;
        Ok(())
    }

    #[test]
    fn rejects_malformed_legacy_pairing_state_json() {
        assert_eq!(
            migrate_legacy_pairing_state_json("{"),
            Err(ExtensionPairingStateError::InvalidLegacyState)
        );
    }

    #[test]
    fn rejects_ambiguous_legacy_pairing_grants_for_the_selected_vault() -> anyhow::Result<()> {
        let mut records = legacy_pairing_state(legacy_grant("store-one"), legacy_setup());
        records.insert(
            grant_storage_key("store-two"),
            LegacyExtensionPairingRecord::Grant(legacy_grant("store-two")),
        );
        let serialized = serde_json::to_string(&records)?;

        assert_eq!(
            migrate_legacy_pairing_state_json(&serialized),
            Err(ExtensionPairingStateError::InvalidLegacyState)
        );
        Ok(())
    }

    #[test]
    fn rejects_inconsistent_legacy_pairing_metadata() -> anyhow::Result<()> {
        let mut setup = legacy_setup();
        setup.sync_provider_count = 2;
        let records = legacy_pairing_state(legacy_grant("store-test"), setup);
        let serialized = serde_json::to_string(&records)?;

        assert_eq!(
            migrate_legacy_pairing_state_json(&serialized),
            Err(ExtensionPairingStateError::InvalidLegacyState)
        );
        Ok(())
    }
}
