//! Create, adopt, or bind the replicated identity control log.

use nook_core::{
    EventGraphVaultArchitecture, EventId, EventLogLocation, IdentityAdoption,
    IdentityAdoptionChoice, IdentityControlLog, IdentityControlMigration, IdentityControlState,
    IdentityEventSigning, IdentityId, IdentityVaultKeyOpening, LegacyVaultMembership,
    OpenedVaultDek, StorageMode, StoreId, VaultFounder, VaultKeys,
};
use serde::{Deserialize, Serialize};
use tsify::Tsify;
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

use super::UNENCODABLE_TYPED_OUTPUT;
use crate::manager::NookVaultManager;
use crate::storage::event_db::StoredKeyEpoch;
use crate::storage::identity_log::IdentityLogWrite;
use crate::storage::identity_record::KeyringDbRebindLocalIdentity;
use crate::storage::remote_event::RemoteEventRead;
use crate::{NookDatabase, NookError};

/// Result of making sure the current identity has a control log.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum NookIdentityLogEnsureOutcome {
    Existing,
    #[serde(rename_all = "camelCase")]
    Created {
        /// Vault devices whose public keys do not form a valid member tuple.
        skipped_app_ids: Vec<String>,
    },
    /// Vaults created on another installation belong to that installation's
    /// identity. Adopt it, or upgrade here explicitly.
    #[serde(rename_all = "camelCase")]
    AwaitingFounder {
        store_ids: Vec<String>,
    },
}

/// Result of looking for a published identity that lists this app key.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum NookIdentityAdoptionOutcome {
    AlreadyReplicated,
    #[serde(rename_all = "camelCase")]
    Adopted {
        identity_id: String,
    },
    NoneListed,
    Ambiguous,
}

/// One owned Simple vault prepared for migration.
struct MigratedVault {
    store_id: StoreId,
    key_epoch: EventId,
    keys: VaultKeys,
    roster: nook_core::VaultAuthorizedRoster,
}

impl NookVaultManager {
    async fn migrated_vaults(
        &mut self,
        identity_id: &IdentityId,
        include_foreign_vaults: bool,
    ) -> Result<(Vec<MigratedVault>, Vec<String>), NookError> {
        let app_key = self.unlocked_app_key()?;
        let signer = self.ensure_signing_identity().await?;
        let directory = NookDatabase::load_identity_directory().await?;
        let record = directory
            .identities()
            .iter()
            .find(|record| &record.identity_id == identity_id)
            .ok_or_else(|| NookError::Database("The current identity is missing.".to_owned()))?;
        let mut vaults = Vec::new();
        let mut foreign = Vec::new();
        for grant in &record.vault_deks {
            let store_id = grant.store_id.clone();
            let store = NookDatabase::load_local_event_store(store_id.as_str()).await?;
            if store.event_ids().is_empty() {
                // Not loaded on this installation; registered when opened here.
                continue;
            }
            let graph = store.load_graph(store_id.as_str())?;
            if graph.classify_vault_architecture() == EventGraphVaultArchitecture::Sentinel {
                continue;
            }
            match VaultFounder::classify(&graph, &signer)? {
                VaultFounder::ThisInstallation => {}
                VaultFounder::AnotherInstallation if include_foreign_vaults => {}
                VaultFounder::AnotherInstallation => {
                    foreign.push(store_id.as_str().to_owned());
                    continue;
                }
                VaultFounder::Unknown => continue,
            }
            let StoredKeyEpoch::Recorded(epoch) =
                NookDatabase::load_key_epoch(store_id.as_str()).await?
            else {
                continue;
            };
            let keys = directory
                .open_vault_dek(IdentityVaultKeyOpening {
                    app_key: &app_key,
                    store_id: store_id.clone(),
                })
                .map_err(NookDatabase::map_domain_error)?;
            vaults.push(MigratedVault {
                key_epoch: EventId::parse(&epoch)?,
                roster: graph.authorized_roster()?,
                store_id,
                keys,
            });
        }
        Ok((vaults, foreign))
    }

    async fn fetch_remote_identity_log(
        &self,
        identity_id: &IdentityId,
    ) -> Result<IdentityControlLog, NookError> {
        let location = EventLogLocation::Identity(identity_id.clone());
        let mut log = IdentityControlLog::new(identity_id.clone());
        for event_id in self.list_provider_event_ids_at(&location).await? {
            let RemoteEventRead::Retrieved(bytes) =
                self.read_provider_event_at(&location, &event_id).await?
            else {
                continue;
            };
            let event = nook_core::IdentityEvent::parse_storage_bytes(&bytes)?;
            log = log.insert(event).map_err(|rejection| rejection.cause)?.log;
        }
        Ok(log)
    }

    async fn adopt_identity_at_current_provider(
        &mut self,
    ) -> Result<NookIdentityAdoptionOutcome, NookError> {
        let app_key = self.unlocked_app_key()?;
        let local_identity_id = Self::current_identity_id(&app_key).await?;
        if !NookDatabase::load_identity_log(&local_identity_id)
            .await?
            .is_empty()
        {
            return Ok(NookIdentityAdoptionOutcome::AlreadyReplicated);
        }
        let mut candidates = Vec::new();
        let mut logs = Vec::new();
        for identity_id in self.list_identity_ids_at_current_provider().await? {
            let log = self.fetch_remote_identity_log(&identity_id).await?;
            if log.is_empty() {
                continue;
            }
            candidates.push(IdentityControlState::project(&log)?);
            logs.push(log);
        }
        let choice = IdentityAdoptionChoice {
            local_identity_id: &local_identity_id,
            app_id: app_key.app_id(),
            candidates: &candidates,
        }
        .choose();
        let IdentityAdoption::Adopt(adopted) = choice else {
            return Ok(match choice {
                IdentityAdoption::AlreadyReplicated => {
                    NookIdentityAdoptionOutcome::AlreadyReplicated
                }
                IdentityAdoption::Ambiguous(_) => NookIdentityAdoptionOutcome::Ambiguous,
                IdentityAdoption::NoneListed | IdentityAdoption::Adopt(_) => {
                    NookIdentityAdoptionOutcome::NoneListed
                }
            });
        };
        let log = logs
            .into_iter()
            .find(|log| log.identity_id() == &adopted)
            .ok_or_else(|| NookError::Database("Adopted identity log disappeared.".to_owned()))?;
        NookDatabase::save_identity_events(IdentityLogWrite {
            identity_id: &adopted,
            events: &log.storage_bytes()?.into_iter().collect::<Vec<_>>(),
        })
        .await?;
        NookDatabase::rebind_local_identity(KeyringDbRebindLocalIdentity {
            local_identity_id: &local_identity_id,
            replicated_identity_id: &adopted,
        })
        .await?;
        Self::apply_identity_state_locally(&app_key, &IdentityControlState::project(&log)?).await?;
        Ok(NookIdentityAdoptionOutcome::Adopted {
            identity_id: adopted.as_str().to_owned(),
        })
    }
}

#[wasm_bindgen]
impl NookVaultManager {
    /// Create the identity's control log from its local membership and the
    /// vaults this installation founded. Vaults founded elsewhere wait for
    /// adoption unless `include_foreign_vaults` explicitly upgrades them here.
    #[wasm_bindgen]
    pub async fn ensure_identity_control_log(
        &mut self,
        include_foreign_vaults: bool,
    ) -> Result<tsify::Ts<NookIdentityLogEnsureOutcome>, JsError> {
        let app_key = self.unlocked_app_key()?;
        let identity_id = Self::current_identity_id(&app_key).await?;
        let outcome = if NookDatabase::load_identity_log(&identity_id)
            .await?
            .is_empty()
        {
            let (vaults, foreign) = self
                .migrated_vaults(&identity_id, include_foreign_vaults)
                .await?;
            if foreign.is_empty() {
                let founder = self.own_identity_member_keys(&app_key).await?;
                let signing = self.ensure_signing_identity().await?;
                let created_at = Self::identity_event_time()?;
                let memberships = vaults
                    .iter()
                    .map(|vault| LegacyVaultMembership {
                        dek: OpenedVaultDek {
                            store_id: &vault.store_id,
                            key_epoch: &vault.key_epoch,
                            keys: &vault.keys,
                        },
                        roster: &vault.roster,
                    })
                    .collect::<Vec<_>>();
                let migrated = IdentityControlMigration {
                    identity_id: &identity_id,
                    founder,
                    vaults: &memberships,
                    mounts: Vec::new(),
                    signing: IdentityEventSigning {
                        signing_key: signing.signing_key(),
                        created_at: &created_at,
                    },
                }
                .events()?;
                let mut log = IdentityControlLog::new(identity_id.clone());
                let mut stored = Vec::new();
                for event in migrated.events {
                    stored.push((event.id()?, event.serialize_storage_yaml()?));
                    log = log.insert(event).map_err(|rejection| rejection.cause)?.log;
                }
                NookDatabase::save_identity_events(IdentityLogWrite {
                    identity_id: &identity_id,
                    events: &stored,
                })
                .await?;
                Self::apply_identity_state_locally(&app_key, &IdentityControlState::project(&log)?)
                    .await?;
                NookIdentityLogEnsureOutcome::Created {
                    skipped_app_ids: migrated
                        .skipped
                        .iter()
                        .map(|app_id| app_id.as_str().to_owned())
                        .collect(),
                }
            } else {
                NookIdentityLogEnsureOutcome::AwaitingFounder { store_ids: foreign }
            }
        } else {
            NookIdentityLogEnsureOutcome::Existing
        };
        Tsify::into_ts(&outcome).map_err(|_| JsError::new(UNENCODABLE_TYPED_OUTPUT))
    }

    /// Adopt the identity a provider publishes for this app key, renaming the
    /// local identity to it.
    #[wasm_bindgen]
    pub async fn adopt_identity_from_provider(
        &mut self,
        storage_mode: String,
        github_pat: String,
        github_repo: String,
    ) -> Result<tsify::Ts<NookIdentityAdoptionOutcome>, JsError> {
        let restore_local = self.storage.mode == StorageMode::Local;
        let result = async {
            self.prepare_storage_preserving_vault_metadata(
                &storage_mode,
                &github_pat,
                &github_repo,
            )
            .await?;
            self.adopt_identity_at_current_provider().await
        }
        .await;
        if restore_local {
            self.prepare_storage_preserving_vault_metadata("local", "", "")
                .await?;
        }
        Tsify::into_ts(&result?).map_err(|_| JsError::new(UNENCODABLE_TYPED_OUTPUT))
    }

    /// Bind a freshly protected local identity to the identity an enrollment
    /// code invites it into. The local identity must not own vaults yet.
    #[wasm_bindgen]
    pub async fn bind_local_identity_to_invitation(
        &mut self,
        identity_id: String,
    ) -> Result<(), JsError> {
        let invited = IdentityId::parse(&identity_id)?;
        let app_key = self.unlocked_app_key()?;
        let local = Self::current_identity_id(&app_key).await?;
        if local == invited {
            return Ok(());
        }
        let directory = NookDatabase::load_identity_directory().await?;
        let record = directory
            .identities()
            .iter()
            .find(|record| record.identity_id == local)
            .ok_or_else(|| JsError::new("The current identity is missing."))?;
        if !record.vault_deks.is_empty() || record.members.len() != 1 {
            return Err(JsError::new(
                "Join with a new identity: this identity already has vaults or apps.",
            ));
        }
        if !NookDatabase::load_identity_log(&local).await?.is_empty() {
            return Err(JsError::new(
                "Join with a new identity: this identity is already replicated.",
            ));
        }
        NookDatabase::rebind_local_identity(KeyringDbRebindLocalIdentity {
            local_identity_id: &local,
            replicated_identity_id: &invited,
        })
        .await?;
        Ok(())
    }
}
