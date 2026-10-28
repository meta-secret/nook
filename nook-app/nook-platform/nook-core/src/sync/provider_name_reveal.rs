//! Names a provider listing shows after one passkey tap.
//!
//! A passkey re-derives this device's app key. If that key is a member of one
//! of the listed identities, its envelopes in that identity's control log
//! open the identity's name and the keys of the identity's vaults, and each
//! vault's own event log carries its encrypted name. Everything is decrypted
//! in memory for the listing and never stored; nothing is imported.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use serde::{Deserialize, Serialize};
use tsify::Tsify;

use crate::errors::VaultResult;
use crate::{
    AgeArmoredCiphertext, AppKey, IdentityControlLog, IdentityControlState, IdentityId,
    IdentityVaultDekLookup, LocalEventStore, LocalEventWrite, ProjectedVaultName,
    ProviderIdentityLogEvents, ProviderVaultName, StoreId, VaultCrypto, VaultProjection,
};

/// The identity a passkey's app key belongs to among the listed ones.
pub struct ProviderNameReveal<'a> {
    pub app_key: &'a AppKey,
    pub identity_logs: Vec<ProviderIdentityLogEvents>,
}

/// One vault the revealed identity's log opens for this app key.
pub struct RevealableVault {
    pub store_id: StoreId,
    crypto: VaultCrypto,
}

/// Which listed identity the passkey opens.
pub enum RevealMembership {
    /// The passkey's app key is a member of none of the listed identities.
    NotAMember,
    Member {
        identity_id: IdentityId,
        identity_name: ProviderVaultName,
        vaults: Vec<RevealableVault>,
    },
}

impl ProviderNameReveal<'_> {
    /// Find the listed identity this app key is a member of, open its name,
    /// and the current keys of the vaults its log grants this key.
    pub fn membership(self) -> VaultResult<RevealMembership> {
        let app_id = self.app_key.app_id();
        for listed in self.identity_logs {
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
            let identity_name = match state.sealed_name_for(app_id) {
                Some(sealed) => ProviderVaultName::named(&self.app_key.open_utf8(sealed)?),
                None => ProviderVaultName::Unknown,
            };
            let mut vaults = Vec::new();
            for vault in &state.vaults {
                if let IdentityVaultDekLookup::Granted(dek) = vault.current_dek_for(app_id) {
                    let secrets_key = self.app_key.decrypt_envelope(&dek.secrets_key_ciphertext)?;
                    vaults.push(RevealableVault {
                        store_id: vault.store_id.clone(),
                        crypto: VaultCrypto::new(&secrets_key)?,
                    });
                }
            }
            return Ok(RevealMembership::Member {
                identity_id: listed.identity_id,
                identity_name,
                vaults,
            });
        }
        Ok(RevealMembership::NotAMember)
    }
}

impl RevealableVault {
    /// The vault's name, read from its own event log and decrypted with the
    /// key its identity granted.
    pub fn name(&self, events: Vec<LocalEventWrite>) -> VaultResult<RevealedVaultName> {
        let graph = events
            .into_iter()
            .fold(LocalEventStore::new(), LocalEventStore::put_event)
            .load_graph(self.store_id.as_str())?;
        let name = match VaultProjection::from_graph(&graph, self.store_id.as_str())?.vault_name {
            ProjectedVaultName::Unnamed => ProviderVaultName::Unknown,
            ProjectedVaultName::Named(ciphertext) => {
                let armored =
                    AgeArmoredCiphertext::from_trusted_armored(ciphertext.as_str().to_owned());
                ProviderVaultName::named(self.crypto.decrypt_value(&armored)?.as_str())
            }
        };
        Ok(RevealedVaultName {
            store_id: self.store_id.clone(),
            name,
        })
    }
}

/// A listed vault's name, opened by the passkey.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct RevealedVaultName {
    pub store_id: StoreId,
    pub name: ProviderVaultName,
}

/// What one passkey tap revealed about the listing.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum ProviderNameRevealOutcome {
    /// The passkey belongs to none of the listed identities.
    NotAMember,
    #[serde(rename_all = "camelCase")]
    Revealed {
        #[tsify(type = "string")]
        identity_id: IdentityId,
        identity_name: ProviderVaultName,
        vaults: Vec<RevealedVaultName>,
    },
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        EventId, GenesisImportPayload, GenesisImportRequest, IdentityEvent, IdentityEventSigning,
        IdentityGenesisRequest, IdentityMemberKeys, IdentityNaming, IdentityVaultRegistration,
        IsoTimestamp, MemberLabel, OpaqueCiphertext, OpenedVaultDek, SigningIdentity, VaultEvent,
        VaultEventBody, VaultEventSchemaVersion, VaultKeys, VaultOperation,
    };

    /// An identity named "Personal" whose founder registered one vault the
    /// vault's own log names "Family".
    struct NamedIdentity {
        app_key: AppKey,
        store_id: StoreId,
        identity_logs: Vec<ProviderIdentityLogEvents>,
        vault_events: Vec<LocalEventWrite>,
    }

    impl NamedIdentity {
        fn new() -> anyhow::Result<Self> {
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

            let genesis = VaultEvent::build_genesis_import_event(GenesisImportRequest {
                store_id: &store_id,
                actor_id: &signer.actor_id()?,
                key_epoch: &epoch,
                payload: GenesisImportPayload {
                    source_content_hash: nook_auth2::Sha256Hex::from_trusted("0".repeat(64)),
                    secrets: vec![],
                    password_entries: vec![],
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
    }

    #[test]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(unowned_function, reason = "framework boundary: test function")
    )]
    fn the_member_passkey_opens_the_identity_and_vault_names_in_memory() -> anyhow::Result<()> {
        let named = NamedIdentity::new()?;
        let RevealMembership::Member {
            identity_name,
            vaults,
            ..
        } = (ProviderNameReveal {
            app_key: &named.app_key,
            identity_logs: named.identity_logs.clone(),
        })
        .membership()?
        else {
            anyhow::bail!("the founder's key must open its own identity");
        };
        assert_eq!(identity_name, ProviderVaultName::named("Personal"));
        let [vault] = vaults.as_slice() else {
            anyhow::bail!("the identity grants exactly one vault");
        };
        let store_id = named.store_id.clone();
        assert_eq!(vault.store_id, store_id);
        assert_eq!(
            vault.name(named.vault_events)?,
            RevealedVaultName {
                store_id,
                name: ProviderVaultName::named("Family"),
            }
        );
        Ok(())
    }

    #[test]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(unowned_function, reason = "framework boundary: test function")
    )]
    fn another_passkey_opens_nothing() -> anyhow::Result<()> {
        let named = NamedIdentity::new()?;
        let stranger = AppKey::generate()?;
        assert!(matches!(
            (ProviderNameReveal {
                app_key: &stranger,
                identity_logs: named.identity_logs,
            })
            .membership()?,
            RevealMembership::NotAMember
        ));
        Ok(())
    }
}
