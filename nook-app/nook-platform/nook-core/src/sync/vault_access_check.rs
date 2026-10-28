//! Which vaults a passkey or a backup password opens, proven by decryption.
//!
//! A passkey check re-derives one device's app key from the passkey. The key
//! opens a vault when the identity log it is a member of wraps the vault's
//! current key to it, or when the vault's own log enrolled it; the check
//! proves it by decrypting the key envelope and the vault's name. A backup
//! password check opens the vault's password envelope the same way. Results
//! are for the person checking, in memory only: nothing is stored, imported,
//! or written to any source.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use serde::{Deserialize, Serialize};
use tsify::Tsify;

use crate::errors::{AgeCryptoError, VaultResult};
use crate::{
    AgeArmoredCiphertext, AppKey, EventGraph, IdentityControlLog, IdentityControlState, IdentityId,
    IdentityVaultDekLookup, IdentityWords, LocalEventStore, LocalEventWrite,
    PasswordEntryResolution, PasswordError, ProjectedVaultName, ProviderIdentityLogEvents,
    ProviderVaultName, ProviderVaultSummary, StoreId, SymmetricKey, VaultCrypto,
    VaultMetaGraphProjection, VaultMetaState, VaultProjection, VaultRecordView,
};

/// One vault a check covers, with the identity whose folder files it and
/// the events its own log holds.
pub struct CheckedVaultEvents {
    pub store_id: StoreId,
    pub filed_under: IdentityId,
    pub events: Vec<LocalEventWrite>,
}

/// Whether a key or password opened one vault.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum VaultCheckOutcome {
    /// Its key decrypted; the name is what the vault's log carries.
    Opens { name: ProviderVaultName },
    /// Nothing wraps the vault's key to the checked passkey, or no backup
    /// password of the vault accepts the checked password.
    DoesNotOpen,
    /// A backup password was checked, and the vault has none set.
    NoBackupPassword,
}

/// One vault's result in a check.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct VaultCheck {
    pub store_id: StoreId,
    /// The first characters of the store token, to tell vaults apart.
    pub short_id: String,
    pub outcome: VaultCheckOutcome,
}

/// Whether a check opened an identity. A passkey belongs to an identity, so
/// it opens every vault the identity keeps.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub enum IdentityCheckOutcome {
    /// The checked passkey's key is a member of the identity.
    Opens,
    /// The identity does not open, but some of its vaults do: a backup
    /// password, or a vault that enrolled the key on its own.
    VaultsOnly,
    DoesNotOpen,
}

/// One identity of the source, its result, and its vaults.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct IdentityCheck {
    #[tsify(type = "string")]
    pub identity_id: IdentityId,
    pub words: IdentityWords,
    /// The identity's name, once the checked passkey opened it.
    pub name: ProviderVaultName,
    pub outcome: IdentityCheckOutcome,
    pub vaults: Vec<VaultCheck>,
}

/// What was checked.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CheckedCredential {
    /// One passkey, told apart by a non-secret fingerprint of its credential id.
    Passkey {
        fingerprint: String,
    },
    BackupPassword,
}

/// What one passkey or backup password opens in one source, identity by
/// identity.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct CredentialCheckReport {
    pub credential: CheckedCredential,
    pub identities: Vec<IdentityCheck>,
}

/// One passkey's re-derived app key against a source's identity logs and
/// vaults.
pub struct PasskeyAccessCheck<'a> {
    pub app_key: &'a AppKey,
    /// A non-secret fingerprint of the passkey's credential id.
    pub fingerprint: String,
    pub identity_logs: Vec<ProviderIdentityLogEvents>,
    pub vaults: Vec<CheckedVaultEvents>,
}

/// The identity the checked app key is a member of, its sealed name, and
/// the vault keys its log wraps to the app key.
struct IdentityGrants {
    member: Option<(IdentityId, ProviderVaultName)>,
    keys: Vec<(StoreId, SymmetricKey)>,
}

impl PasskeyAccessCheck<'_> {
    /// Check every identity and vault of the source. An identity opens when
    /// the key is its member; a vault opens only when its key and name
    /// actually decrypt.
    pub fn report(self) -> VaultResult<CredentialCheckReport> {
        let grants = self.identity_grants()?;
        let mut checked = Vec::with_capacity(self.vaults.len());
        for vault in self.vaults {
            let source = CheckedVaultSource::load(&vault.store_id, vault.events)?;
            let granted = grants
                .keys
                .iter()
                .find(|(store_id, _)| store_id == &vault.store_id)
                .map(|(_, key)| key.clone());
            let secrets_key = match granted {
                Some(key) => Some(key),
                None => source.enrolled_key(self.app_key)?,
            };
            let outcome = match secrets_key {
                Some(key) => VaultCheckOutcome::Opens {
                    name: source.name(&key)?,
                },
                None => VaultCheckOutcome::DoesNotOpen,
            };
            checked.push((vault.filed_under, VaultCheck::of(&vault.store_id, outcome)));
        }
        let listed = self
            .identity_logs
            .iter()
            .map(|log| log.identity_id.clone())
            .collect::<Vec<_>>();
        Ok(CredentialCheckReport {
            credential: CheckedCredential::Passkey {
                fingerprint: self.fingerprint,
            },
            identities: IdentityCheck::group(IdentityGrouping {
                listed: &listed,
                vaults: checked,
                member: grants.member.as_ref(),
            }),
        })
    }

    fn identity_grants(&self) -> VaultResult<IdentityGrants> {
        let app_id = self.app_key.app_id();
        for listed in &self.identity_logs {
            if listed.events.is_empty() {
                continue;
            }
            let log = IdentityControlLog::new(listed.identity_id.clone())
                .union_storage_bytes(&listed.events)
                .map_err(|rejection| rejection.cause)?;
            let state = IdentityControlState::project(&log)?;
            if state.member(app_id).is_none() {
                continue;
            }
            let name = match state.sealed_name_for(app_id) {
                Some(sealed) => ProviderVaultName::named(&self.app_key.open_utf8(sealed)?),
                None => ProviderVaultName::Unknown,
            };
            let mut keys = Vec::new();
            for vault in &state.vaults {
                if let IdentityVaultDekLookup::Granted(dek) = vault.current_dek_for(app_id) {
                    keys.push((
                        vault.store_id.clone(),
                        self.app_key.decrypt_envelope(&dek.secrets_key_ciphertext)?,
                    ));
                }
            }
            return Ok(IdentityGrants {
                member: Some((listed.identity_id.clone(), name)),
                keys,
            });
        }
        Ok(IdentityGrants {
            member: None,
            keys: Vec::new(),
        })
    }
}

/// A typed backup password against every vault of a source.
pub struct BackupPasswordAccessCheck<'a> {
    pub password: &'a str,
    pub vaults: Vec<CheckedVaultEvents>,
}

impl BackupPasswordAccessCheck<'_> {
    /// Try the password against each vault's password envelopes. A password
    /// opens vaults, never an identity; any failure other than a wrong
    /// password is reported.
    pub fn report(self) -> VaultResult<CredentialCheckReport> {
        let mut checked = Vec::with_capacity(self.vaults.len());
        for vault in self.vaults {
            let source = CheckedVaultSource::load(&vault.store_id, vault.events)?;
            let outcome = source.password_outcome(self.password)?;
            checked.push((vault.filed_under, VaultCheck::of(&vault.store_id, outcome)));
        }
        Ok(CredentialCheckReport {
            credential: CheckedCredential::BackupPassword,
            identities: IdentityCheck::group(IdentityGrouping {
                listed: &[],
                vaults: checked,
                member: None,
            }),
        })
    }
}

impl VaultCheck {
    fn of(store_id: &StoreId, outcome: VaultCheckOutcome) -> Self {
        Self {
            store_id: store_id.clone(),
            short_id: ProviderVaultSummary::short_id(store_id),
            outcome,
        }
    }
}

/// The checked vaults with the identities filing them, and the identity the
/// key is a member of.
struct IdentityGrouping<'a> {
    listed: &'a [IdentityId],
    vaults: Vec<(IdentityId, VaultCheck)>,
    member: Option<&'a (IdentityId, ProviderVaultName)>,
}

impl IdentityCheck {
    /// One entry per identity, in the order the source lists them, each with
    /// its own vaults.
    fn group(grouping: IdentityGrouping<'_>) -> Vec<Self> {
        let IdentityGrouping {
            listed,
            vaults,
            member,
        } = grouping;
        let mut identities: Vec<Self> = Vec::new();
        let order = listed
            .iter()
            .chain(vaults.iter().map(|(identity_id, _)| identity_id));
        for identity_id in order {
            if identities
                .iter()
                .any(|seen| &seen.identity_id == identity_id)
            {
                continue;
            }
            let own = vaults
                .iter()
                .filter(|(filed_under, _)| filed_under == identity_id)
                .map(|(_, vault)| vault.clone())
                .collect::<Vec<_>>();
            let (outcome, name) = match member {
                Some((member_id, name)) if member_id == identity_id => {
                    (IdentityCheckOutcome::Opens, name.clone())
                }
                Some(_) | None => {
                    let any_opens = own
                        .iter()
                        .any(|vault| matches!(vault.outcome, VaultCheckOutcome::Opens { .. }));
                    (
                        if any_opens {
                            IdentityCheckOutcome::VaultsOnly
                        } else {
                            IdentityCheckOutcome::DoesNotOpen
                        },
                        ProviderVaultName::Unknown,
                    )
                }
            };
            identities.push(Self {
                words: IdentityWords::of(identity_id),
                identity_id: identity_id.clone(),
                name,
                outcome,
                vaults: own,
            });
        }
        identities
    }
}

/// One vault's causal graph and projection, built in memory.
pub(crate) struct CheckedVaultSource {
    graph: EventGraph,
    projection: VaultProjection,
}

impl CheckedVaultSource {
    pub(crate) fn load(store_id: &StoreId, events: Vec<LocalEventWrite>) -> VaultResult<Self> {
        let graph = events
            .into_iter()
            .fold(LocalEventStore::new(), LocalEventStore::put_event)
            .load_graph(store_id.as_str())?;
        let projection = VaultProjection::from_graph(&graph, store_id.as_str())?;
        Ok(Self { graph, projection })
    }

    /// The vault's secrets key, when its own log enrolled the app key.
    fn enrolled_key(&self, app_key: &AppKey) -> VaultResult<Option<SymmetricKey>> {
        let mut meta = VaultMetaState::default();
        VaultMetaGraphProjection::new(&self.graph).materialize(&mut meta)?;
        if !meta.enrolled_devices.contains_key(app_key.app_id()) {
            return Ok(None);
        }
        let records = meta.to_stored_records();
        Ok(Some(VaultRecordView::new(&records).secrets_key(app_key)?))
    }

    /// Whether a backup password opens the vault: some envelope accepts it.
    fn password_outcome(&self, password: &str) -> VaultResult<VaultCheckOutcome> {
        if self.projection.password_entries.is_empty() {
            return Ok(VaultCheckOutcome::NoBackupPassword);
        }
        for entry in &self.projection.password_entries {
            match PasswordEntryResolution::new(entry, password).resolve() {
                Ok(keys) => {
                    return Ok(VaultCheckOutcome::Opens {
                        name: self.name(&keys.secrets_key)?,
                    });
                }
                Err(PasswordError::Age(AgeCryptoError::EnvelopeDecrypt(_))) => {}
                Err(other) => return Err(other.into()),
            }
        }
        Ok(VaultCheckOutcome::DoesNotOpen)
    }

    /// The vault's projection of its own log.
    pub(crate) fn projection(&self) -> &VaultProjection {
        &self.projection
    }

    /// The vault's name, decrypted with its secrets key.
    pub(crate) fn name(&self, secrets_key: &SymmetricKey) -> VaultResult<ProviderVaultName> {
        let crypto = VaultCrypto::new(secrets_key)?;
        Ok(match &self.projection.vault_name {
            ProjectedVaultName::Unnamed => ProviderVaultName::Unknown,
            ProjectedVaultName::Named(ciphertext) => {
                let armored =
                    AgeArmoredCiphertext::from_trusted_armored(ciphertext.as_str().to_owned());
                ProviderVaultName::named(crypto.decrypt_value(&armored)?.as_str())
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        EventId, GenesisImportPayload, GenesisImportRequest, IdentityEvent, IdentityEventSigning,
        IdentityGenesisRequest, IdentityMemberKeys, IdentityNaming, IdentityVaultRegistration,
        IsoTimestamp, MemberLabel, OpaqueCiphertext, OpenedVaultDek, PasswordEntryIssuance,
        SigningIdentity, VaultEvent, VaultEventBody, VaultEventSchemaVersion, VaultKeys,
        VaultOperation,
    };

    const PASSWORD: &str = "correct horse battery staple";

    /// An identity named "Personal" whose founder registered one vault that
    /// its own log names "Family", optionally with a backup password.
    struct NamedIdentity {
        app_key: AppKey,
        identity_id: IdentityId,
        store_id: StoreId,
        identity_logs: Vec<ProviderIdentityLogEvents>,
        vault_events: Vec<LocalEventWrite>,
    }

    impl NamedIdentity {
        #[expect(
            clippy::too_many_lines,
            reason = "one fixture signs an identity log and a named vault log"
        )]
        fn new(with_password: bool) -> anyhow::Result<Self> {
            let app_key = AppKey::generate()?;
            let signer = SigningIdentity::generate()?.0;
            let at = IsoTimestamp::parse("2026-10-27T17:28:00Z")?;
            let identity_id = IdentityId::generate()?;
            let store_id = StoreId::generate()?;
            let keys = VaultKeys::generate()?;
            let epoch = EventId::from_sha256_hex(
                nook_auth2::Sha256Hex::from_trusted("1".repeat(64)).as_str(),
            )?;
            let signing = IdentityEventSigning {
                signing_key: signer.signing_key(),
                created_at: &at,
            };
            let mut log = IdentityControlLog::new(identity_id.clone())
                .insert(IdentityEvent::genesis(IdentityGenesisRequest {
                    identity_id: &identity_id,
                    founder: IdentityMemberKeys {
                        app_id: app_key.app_id().clone(),
                        encryption_public_key: app_key.public_key(),
                        signing_public_key: signer.public_key(),
                        label: MemberLabel::from_trusted(String::new()),
                    },
                    signing: IdentityEventSigning {
                        signing_key: signer.signing_key(),
                        created_at: &at,
                    },
                })?)?
                .log;
            let state = IdentityControlState::project(&log)?;
            let operations = vec![
                state.vault_registration_operation(IdentityVaultRegistration {
                    dek: OpenedVaultDek {
                        store_id: &store_id,
                        key_epoch: &epoch,
                        keys: &keys,
                    },
                })?,
                state.naming_operation(&IdentityNaming {
                    name: "Personal",
                    joining: None,
                })?,
            ];
            log = log
                .clone()
                .insert(log.build_append(operations, &signing)?)?
                .log;

            let password_entries = if with_password {
                vec![
                    PasswordEntryIssuance::with_work_factor(
                        &keys,
                        "pwdentry001",
                        "Emergency kit",
                        "2026-10-27T17:28:00Z",
                        PASSWORD,
                        10.into(),
                    )
                    .issue()?,
                ]
            } else {
                Vec::new()
            };
            let genesis = VaultEvent::build_genesis_import_event(GenesisImportRequest {
                store_id: &store_id,
                actor_id: &signer.actor_id()?,
                key_epoch: &epoch,
                payload: GenesisImportPayload {
                    source_content_hash: nook_auth2::Sha256Hex::from_trusted("0".repeat(64)),
                    secrets: vec![],
                    password_entries,
                },
                created_at: &at,
                signing_key: signer.signing_key(),
            })?;
            let sealed_name = VaultCrypto::new(&keys.secrets_key)?.encrypt_value("Family")?;
            let named = VaultEvent::sign(
                VaultEventBody {
                    schema_version: VaultEventSchemaVersion::CURRENT,
                    store_id: store_id.clone(),
                    actor_id: signer.actor_id()?,
                    actor_signing_public_key: signer.public_key(),
                    parents: vec![genesis.id()?],
                    created_at: at.clone(),
                    key_epoch: epoch.clone(),
                    operations: vec![VaultOperation::VaultNamed {
                        name: OpaqueCiphertext::from_trusted(sealed_name.as_str().to_owned()),
                    }],
                },
                signer.signing_key(),
            )?;
            let vault_events = [genesis, named]
                .iter()
                .map(|event| {
                    Ok(LocalEventWrite {
                        event_id: event.id()?,
                        bytes: VaultEvent::serialize_event_storage_yaml(event)?,
                    })
                })
                .collect::<anyhow::Result<Vec<_>>>()?;
            Ok(Self {
                app_key,
                store_id,
                identity_id: identity_id.clone(),
                identity_logs: vec![ProviderIdentityLogEvents {
                    identity_id,
                    events: log
                        .storage_bytes()?
                        .into_iter()
                        .map(|(_, bytes)| bytes)
                        .collect(),
                }],
                vault_events,
            })
        }

        fn identity_id(&self) -> IdentityId {
            self.identity_id.clone()
        }

        fn checked_vaults(&self) -> Vec<CheckedVaultEvents> {
            vec![CheckedVaultEvents {
                store_id: self.store_id.clone(),
                filed_under: self.identity_id(),
                events: self
                    .vault_events
                    .iter()
                    .map(|event| LocalEventWrite {
                        event_id: event.event_id.clone(),
                        bytes: event.bytes.clone(),
                    })
                    .collect(),
            }]
        }

        fn check(&self, app_key: &AppKey) -> VaultResult<CredentialCheckReport> {
            PasskeyAccessCheck {
                app_key,
                fingerprint: "passkey-a1b2".to_owned(),
                identity_logs: self.identity_logs.clone(),
                vaults: self.checked_vaults(),
            }
            .report()
        }

        fn check_password(&self, password: &str) -> VaultResult<CredentialCheckReport> {
            BackupPasswordAccessCheck {
                password,
                vaults: self.checked_vaults(),
            }
            .report()
        }
    }

    #[test]
    fn the_member_passkey_opens_its_identity_and_every_vault_it_keeps() -> anyhow::Result<()> {
        let named = NamedIdentity::new(false)?;
        let identity_id = named.identity_id();
        let report = named.check(&named.app_key)?;

        assert_eq!(
            report.credential,
            CheckedCredential::Passkey {
                fingerprint: "passkey-a1b2".to_owned()
            }
        );
        assert_eq!(
            report.identities,
            [IdentityCheck {
                words: IdentityWords::of(&identity_id),
                identity_id: identity_id.clone(),
                name: ProviderVaultName::named("Personal"),
                outcome: IdentityCheckOutcome::Opens,
                vaults: vec![VaultCheck {
                    short_id: ProviderVaultSummary::short_id(&named.store_id),
                    store_id: named.store_id.clone(),
                    outcome: VaultCheckOutcome::Opens {
                        name: ProviderVaultName::named("Family"),
                    },
                }],
            }]
        );
        Ok(())
    }

    #[test]
    fn another_passkey_opens_no_identity_and_no_vault() -> anyhow::Result<()> {
        let named = NamedIdentity::new(false)?;
        let report = named.check(&AppKey::generate()?)?;

        let [identity] = report.identities.as_slice() else {
            anyhow::bail!("the source lists one identity");
        };
        assert_eq!(identity.outcome, IdentityCheckOutcome::DoesNotOpen);
        assert_eq!(identity.name, ProviderVaultName::Unknown);
        assert!(
            identity
                .vaults
                .iter()
                .all(|vault| vault.outcome == VaultCheckOutcome::DoesNotOpen)
        );
        Ok(())
    }

    #[test]
    fn a_backup_password_opens_its_vault_but_never_the_identity() -> anyhow::Result<()> {
        let with_password = NamedIdentity::new(true)?;
        let outcome = |report: CredentialCheckReport| {
            assert_eq!(report.credential, CheckedCredential::BackupPassword);
            report
                .identities
                .into_iter()
                .map(|identity| {
                    (
                        identity.outcome,
                        identity
                            .vaults
                            .into_iter()
                            .map(|vault| vault.outcome)
                            .collect::<Vec<_>>(),
                    )
                })
                .collect::<Vec<_>>()
        };
        assert_eq!(
            outcome(with_password.check_password(PASSWORD)?),
            [(
                IdentityCheckOutcome::VaultsOnly,
                vec![VaultCheckOutcome::Opens {
                    name: ProviderVaultName::named("Family"),
                }]
            )]
        );
        assert_eq!(
            outcome(with_password.check_password("not the backup password")?),
            [(
                IdentityCheckOutcome::DoesNotOpen,
                vec![VaultCheckOutcome::DoesNotOpen]
            )]
        );
        assert_eq!(
            outcome(NamedIdentity::new(false)?.check_password(PASSWORD)?),
            [(
                IdentityCheckOutcome::DoesNotOpen,
                vec![VaultCheckOutcome::NoBackupPassword]
            )]
        );
        Ok(())
    }
}
