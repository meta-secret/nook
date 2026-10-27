//! Asking the members of a vault this device cannot open to grant it access.
//!
//! The request is a self-signed `join-requested` event carrying this app's
//! public keys only. It goes on top of the vault's current heads and key
//! epoch, so a member that syncs the vault sees it and can approve it; until
//! then the vault stays closed to this device.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use crate::errors::VaultResult;
use crate::{
    AppKey, AppendEventInput, EventError, EventStorageBytes, IsoTimestamp, KeyEpoch,
    LocalEventStore, LocalEventWrite, MemberLabel, ProjectionEpoch, SigningIdentity, StoreId,
    VaultEvent, VaultOperation, VaultProjection,
};

/// A provider vault's events and the app asking to join it.
pub struct ProviderVaultAccessRequest<'a> {
    pub store_id: &'a StoreId,
    pub events: Vec<LocalEventWrite>,
    pub app_key: &'a AppKey,
    pub signing: &'a SigningIdentity,
    pub created_at: &'a IsoTimestamp,
}

impl ProviderVaultAccessRequest<'_> {
    /// Sign the join request for the vault's current frontier.
    pub fn build(self) -> VaultResult<(VaultEvent, EventStorageBytes)> {
        let store = self
            .events
            .into_iter()
            .fold(LocalEventStore::new(), LocalEventStore::put_event);
        let graph = store.load_graph(self.store_id.as_str())?;
        let ProjectionEpoch::Current(KeyEpoch(key_epoch)) =
            VaultProjection::from_graph(&graph, self.store_id.as_str())?.epoch
        else {
            return Err(EventError::MissingGenesisBytes.into());
        };
        Ok(AppendEventInput {
            store_id: self.store_id,
            actor_id: &self.signing.actor_id()?,
            signing_identity: self.signing,
            parents: graph.heads(),
            key_epoch: &key_epoch,
            created_at: self.created_at,
            operations: vec![VaultOperation::JoinRequested {
                device_id: self.app_key.device_id().clone(),
                encryption_public_key: self.app_key.public_key().clone(),
                signing_public_key: self.signing.public_key(),
                label: MemberLabel::from_trusted(String::new()),
            }],
        }
        .build()?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        EventId, GenesisImportPayload, GenesisImportRequest, ProviderVaultEvents,
        ProviderVaultStanding,
    };

    #[test]
    fn a_request_joins_the_vault_frontier_and_marks_this_app_as_asking() -> anyhow::Result<()> {
        let owner = SigningIdentity::generate()?.0;
        let store_id = StoreId::parse("store_requestvlt1")?;
        let at = IsoTimestamp::parse("2026-07-22T00:00:00Z")?;
        let genesis = VaultEvent::build_genesis_import_event(GenesisImportRequest {
            store_id: &store_id,
            actor_id: &owner.actor_id()?,
            key_epoch: &EventId::from_sha256_hex(
                nook_auth2::Sha256Hex::from_trusted("1".repeat(64)).as_str(),
            )?,
            payload: GenesisImportPayload {
                source_content_hash: nook_auth2::Sha256Hex::from_trusted("0".repeat(64)),
                secrets: vec![],
                password_entries: vec![],
            },
            created_at: &at,
            signing_key: owner.signing_key(),
        })?;
        let genesis_write = || -> anyhow::Result<LocalEventWrite> {
            Ok(LocalEventWrite {
                event_id: genesis.id()?,
                bytes: VaultEvent::serialize_event_storage_yaml(&genesis)?,
            })
        };
        let app_key = AppKey::generate()?;
        let signing = SigningIdentity::generate()?.0;
        let (request, bytes) = ProviderVaultAccessRequest {
            store_id: &store_id,
            events: vec![genesis_write()?],
            app_key: &app_key,
            signing: &signing,
            created_at: &at,
        }
        .build()?;
        assert_eq!(request.body.parents, [genesis.id()?]);
        let inspection = ProviderVaultEvents {
            store_id: &store_id,
            events: vec![
                genesis_write()?,
                LocalEventWrite {
                    event_id: request.id()?,
                    bytes,
                },
            ],
        }
        .inspect(Some(app_key.device_id()))?;
        assert_eq!(inspection.standing, ProviderVaultStanding::Requested);
        Ok(())
    }

    #[test]
    fn a_vault_without_events_cannot_be_asked_to_join() -> anyhow::Result<()> {
        let app_key = AppKey::generate()?;
        let signing = SigningIdentity::generate()?.0;
        assert!(
            ProviderVaultAccessRequest {
                store_id: &StoreId::parse("store_requestvlt1")?,
                events: Vec::new(),
                app_key: &app_key,
                signing: &signing,
                created_at: &IsoTimestamp::parse("2026-07-22T00:00:00Z")?,
            }
            .build()
            .is_err()
        );
        Ok(())
    }
}
