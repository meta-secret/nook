//! Extension vault grant admission and atomic session projection publication.

use crate::manager::session::VaultSessionGraphProjection;
use crate::manager::{NookVaultManager, VaultCryptoState, VaultSessionState};
use crate::{NookDatabase, NookError};
use nook_core::{
    DeviceAuthorization, DeviceId, DeviceIdentity, DevicePublicKey, DeviceSigningPublicKey,
    EventGraph, EventGraphDeviceAccess, EventGraphDeviceAccessRequest, StoreId, VaultApplication,
    VaultCrypto, VaultProjectionObservation, VaultProjectionRefresh, VaultSessionProjection,
    VaultType,
};
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

struct ExtensionVaultOpenRequest {
    store_id: StoreId,
    app_id: DeviceId,
    encryption_public_key: DevicePublicKey,
    signing_public_key: DeviceSigningPublicKey,
}

#[derive(Clone, Copy)]
struct ExtensionVaultProjectionRequest<'a> {
    grant: &'a ExtensionVaultOpenRequest,
    identity: &'a DeviceIdentity,
    graph: &'a EventGraph,
}

#[derive(Clone, Copy)]
struct ExtensionUnlockedIdentity<'a> {
    identity: &'a DeviceIdentity,
    signing_public_key: &'a DeviceSigningPublicKey,
}

enum ExtensionGrantIdentityMatch {
    Matched,
    Mismatched,
}

impl ExtensionVaultOpenRequest {
    #[expect(
        clippy::match_bool,
        reason = "native-bool boundary conversion of current app, encryption and signing-key equality into named grant identity match outcomes required by branching-and-exhaustive-matching"
    )]
    fn identity_match(
        &self,
        unlocked: ExtensionUnlockedIdentity<'_>,
    ) -> ExtensionGrantIdentityMatch {
        match unlocked.identity.app_id() == &self.app_id
            && unlocked.identity.public_key() == self.encryption_public_key
            && unlocked.signing_public_key == &self.signing_public_key
        {
            true => ExtensionGrantIdentityMatch::Matched,
            false => ExtensionGrantIdentityMatch::Mismatched,
        }
    }

    fn validate_identity(&self, unlocked: ExtensionUnlockedIdentity<'_>) -> Result<(), NookError> {
        match self.identity_match(unlocked) {
            ExtensionGrantIdentityMatch::Matched => Ok(()),
            ExtensionGrantIdentityMatch::Mismatched => Err(NookError::Decryption(
                "Approved extension grant does not match the unlocked device.".to_owned(),
            )),
        }
    }
}

impl NookVaultManager {
    async fn open_extension_passkey_vault(
        &mut self,
        request: &ExtensionVaultOpenRequest,
    ) -> Result<(), NookError> {
        self.ensure_passkey_extension_capability()?;
        let identity = self.device_identity()?;
        let signing = self.ensure_signing_identity().await?;
        request.validate_identity(ExtensionUnlockedIdentity {
            identity: &identity,
            signing_public_key: &signing.public_key(),
        })?;
        let store = NookDatabase::load_local_event_store(request.store_id.as_str()).await?;
        let graph = store.load_graph(request.store_id.as_str())?;
        self.hydrate_extension_vault_projection(ExtensionVaultProjectionRequest {
            grant: request,
            identity: &identity,
            graph: &graph,
        })
    }

    /// Adapt the freshly loaded authorized graph to the externally retained
    /// manager; portable reuse policy remains owned by `VaultSessionProjection`.
    fn hydrate_extension_vault_projection(
        &mut self,
        input: ExtensionVaultProjectionRequest<'_>,
    ) -> Result<(), NookError> {
        self.ensure_passkey_extension_capability()?;
        let ExtensionVaultProjectionRequest {
            grant: request,
            identity,
            graph,
        } = input;
        let envelopes = match EventGraphDeviceAccess::new(graph).active_envelopes(
            &EventGraphDeviceAccessRequest {
                expected_device_id: &request.app_id,
                expected_public_key: &request.encryption_public_key,
                expected_signing_public_key: &request.signing_public_key,
            },
        )? {
            DeviceAuthorization::Granted(envelopes) => envelopes,
            DeviceAuthorization::NotGranted => {
                return Err(NookError::Decryption(
                    "Extension vault grant is missing or revoked.".to_owned(),
                ));
            }
        };
        // Authorization above always uses fresh durable graph data. Only the
        // encrypted session projection can be reused after that succeeds.
        let projection = match &self.vault.crypto {
            VaultCryptoState::Locked => &VaultSessionProjection::Unhydrated,
            VaultCryptoState::Unlocked(_) => &self.vault.projection,
        };
        let refresh = projection.observe(VaultProjectionObservation {
            store_id: &request.store_id,
            app_id: &request.app_id,
            encryption_public_key: &request.encryption_public_key,
            signing_public_key: &request.signing_public_key,
            graph,
        })?;
        let VaultProjectionRefresh::Hydrate(snapshot) = refresh else {
            return Ok(());
        };
        let secrets_key = identity.decrypt_envelope(&envelopes.secrets_key)?;
        let members_key = identity.decrypt_envelope(&envelopes.members_key)?;
        let crypto = VaultCrypto::new(&secrets_key)?;
        let mut vault = VaultSessionState::from_event_graph(&VaultSessionGraphProjection {
            graph,
            store_id: &request.store_id,
            architecture: &self.vault.architecture,
        })?;
        vault.secrets_key = secrets_key.as_str().to_owned();
        vault.members_key = members_key.as_str().to_owned();
        vault.crypto = VaultCryptoState::Unlocked(crypto);
        vault.projection = VaultSessionProjection::Hydrated(snapshot);
        // Switching or refreshing adopts only keys from the current graph grant.
        // Drop the prior catalog before it can be used with different vault keys.
        self.vault.reset();
        self.event_log.heads.clear();
        self.event_log.key_epoch.clear();
        self.vault = vault;
        if let Ok(identity) = self.device_identity() {
            drop(self.maybe_sync_self_into_roster(&identity));
        }
        Ok(())
    }

    pub(in crate::manager) fn ensure_passkey_extension_capability(&self) -> Result<(), NookError> {
        if self.application != VaultApplication::Extension
            && self.application != VaultApplication::UnifiedDevelopment
        {
            return Err(NookError::Database(
                "Website passkeys require the extension application capability.".to_owned(),
            ));
        }
        self.application
            .validate_session_access(self.vault.architecture.vault_type)?;
        if self.vault.architecture.vault_type != VaultType::Simple {
            return Err(NookError::Database(
                "Website passkeys are available only for Simple Vault.".to_owned(),
            ));
        }
        if self.device.identity_private_key.is_empty() {
            return Err(NookError::Decryption(
                "Extension device identity is locked.".to_owned(),
            ));
        }
        Ok(())
    }
}

#[wasm_bindgen]
impl NookVaultManager {
    #[wasm_bindgen]
    pub async fn open_extension_passkey_vault_js(
        &mut self,
        expected_store_id: &str,
        expected_device_id: &str,
        expected_device_public_key: &str,
        expected_device_signing_public_key: &str,
    ) -> Result<(), JsError> {
        self.open_extension_passkey_vault(&ExtensionVaultOpenRequest {
            store_id: StoreId::parse(expected_store_id)?,
            app_id: DeviceId::parse(expected_device_id)?,
            encryption_public_key: DevicePublicKey::parse(expected_device_public_key)?,
            signing_public_key: DeviceSigningPublicKey::parse(expected_device_signing_public_key)?,
        })
        .await
        .map_err(Into::into)
    }
}

#[cfg(test)]
mod tests {
    use super::{
        ExtensionUnlockedIdentity, ExtensionVaultOpenRequest, ExtensionVaultProjectionRequest,
        NookVaultManager,
    };
    use crate::NookError;
    use crate::manager::{SearchCatalogState, VaultCryptoState};
    use nook_core::{
        CanonicalEventBodyBytes, DeviceIdentity, DeviceMode, EncryptedSecretPayload,
        EpochMetadataState, EpochPasswordState, EventGraph, EventGraphInsert, EventGraphRejection,
        EventId, IsoTimestamp, MemberLabel, SecretFingerprint, SecretId, SecretSearchCatalog,
        SecretType, Sha256Hex, SigningIdentity, StoreId, VaultApplication, VaultArchitecture,
        VaultCrypto, VaultEvent, VaultEventBody, VaultEventSchemaVersion, VaultKeys,
        VaultOperation, VaultSessionProjection,
    };
    use wasm_bindgen_test::wasm_bindgen_test;

    enum FixtureEnvelopeKey {
        Generated,
        Malformed,
    }

    struct ExtensionProjectionFixture {
        identity: DeviceIdentity,
        grant: ExtensionVaultOpenRequest,
        graph: EventGraph,
        signing: SigningIdentity,
        epoch: EventId,
    }

    struct ProjectionEventFixture {
        parents: Vec<EventId>,
        key_epoch: EventId,
        operations: Vec<VaultOperation>,
    }

    impl ExtensionProjectionFixture {
        fn new(envelope_key: FixtureEnvelopeKey) -> anyhow::Result<Self> {
            let identity = DeviceIdentity::generate()?;
            let keys = VaultKeys::generate()?;
            let envelope_secrets_key = match envelope_key {
                FixtureEnvelopeKey::Generated => keys.secrets_key.as_str(),
                FixtureEnvelopeKey::Malformed => "invalid",
            };
            let (signing, _) = SigningIdentity::generate()?;
            let store_id = StoreId::generate()?;
            let epoch = EventId::from_body_bytes(&CanonicalEventBodyBytes::from(
                b"extension projection epoch".to_vec(),
            ));
            let mut fixture = Self {
                grant: ExtensionVaultOpenRequest {
                    store_id,
                    app_id: identity.app_id().clone(),
                    encryption_public_key: identity.public_key(),
                    signing_public_key: signing.public_key(),
                },
                identity,
                graph: EventGraph::new(),
                signing,
                epoch,
            };
            let ciphertext =
                VaultCrypto::new(&keys.secrets_key)?.encrypt_value("encrypted fixture")?;
            let secrets = (0..1_300)
                .map(|index| {
                    EncryptedSecretPayload::from_armored(
                        &SecretId::from_vault_record(&format!("secret_projection{index:05}")),
                        SecretType::Login,
                        ciphertext.as_str(),
                        SecretFingerprint::from_trusted("fixture identity".to_owned()),
                        SecretFingerprint::from_trusted("fixture version".to_owned()),
                    )
                })
                .collect();
            let root = fixture.event(ProjectionEventFixture {
                parents: Vec::new(),
                key_epoch: fixture.epoch.clone(),
                operations: vec![
                    VaultOperation::VaultImported {
                        source_content_hash: Sha256Hex::from_bytes(b"fixture"),
                        secrets,
                        password_entries: Vec::new(),
                    },
                    VaultOperation::JoinApproved {
                        device_id: fixture.identity.app_id().clone(),
                        encryption_public_key: fixture.identity.public_key(),
                        signing_public_key: fixture.signing.public_key(),
                        label: MemberLabel::from_trusted("Extension".to_owned()),
                        secrets_key_ciphertext: fixture.identity.seal_utf8(envelope_secrets_key)?,
                        members_key_ciphertext: fixture
                            .identity
                            .seal_utf8(keys.members_key.as_str())?,
                    },
                ],
            })?;
            fixture.graph = fixture
                .graph
                .insert(EventGraphInsert {
                    event: root,
                    expected_store_id: fixture.grant.store_id.as_str(),
                })
                .map_err(EventGraphRejection::into_cause)?
                .graph;
            Ok(fixture)
        }

        fn event(&self, request: ProjectionEventFixture) -> anyhow::Result<VaultEvent> {
            Ok(VaultEvent::sign(
                VaultEventBody {
                    schema_version: VaultEventSchemaVersion::CURRENT,
                    store_id: self.grant.store_id.clone(),
                    actor_id: self.signing.actor_id()?,
                    actor_signing_public_key: self.signing.public_key(),
                    parents: request.parents,
                    created_at: IsoTimestamp::parse("2026-10-07T00:00:00Z")?,
                    key_epoch: request.key_epoch,
                    operations: request.operations,
                },
                self.signing.signing_key(),
            )?)
        }

        fn manager(&self) -> NookVaultManager {
            let mut manager = NookVaultManager::new();
            manager.device.identity_private_key = self.identity.secret_string().into_inner();
            manager
        }

        fn request(&self) -> ExtensionVaultProjectionRequest<'_> {
            ExtensionVaultProjectionRequest {
                grant: &self.grant,
                identity: &self.identity,
                graph: &self.graph,
            }
        }

        #[must_use = "retain the revoked durable graph fixture"]
        fn revoke(mut self) -> anyhow::Result<Self> {
            let trigger = self.event(ProjectionEventFixture {
                parents: self.graph.heads(),
                key_epoch: self.epoch.clone(),
                operations: vec![VaultOperation::DeviceRevoked {
                    device_id: self.identity.app_id().clone(),
                }],
            })?;
            let trigger_id = trigger.id()?;
            let checkpoint = self.event(ProjectionEventFixture {
                parents: vec![trigger_id.clone()],
                key_epoch: trigger_id,
                operations: vec![VaultOperation::EpochCheckpoint {
                    secrets: Vec::new(),
                    members_checkpoint_hash: Sha256Hex::from_bytes(b"empty roster"),
                    rotated_meta_records: EpochMetadataState::Replace(Vec::new()),
                    password_entries: EpochPasswordState::Replace(Vec::new()),
                }],
            })?;
            for event in [trigger, checkpoint] {
                self.graph = self
                    .graph
                    .insert(EventGraphInsert {
                        event,
                        expected_store_id: self.grant.store_id.as_str(),
                    })
                    .map_err(EventGraphRejection::into_cause)?
                    .graph;
            }
            Ok(self)
        }
    }

    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
    fn current_grant_identity_rejects_different_app_or_signer_before_graph_loading()
    -> anyhow::Result<()> {
        let fixture = ExtensionProjectionFixture::new(FixtureEnvelopeKey::Generated)?;
        fixture.grant.validate_identity(ExtensionUnlockedIdentity {
            identity: &fixture.identity,
            signing_public_key: &fixture.signing.public_key(),
        })?;
        let (other_signing, _) = SigningIdentity::generate()?;
        assert!(matches!(
            fixture.grant.validate_identity(ExtensionUnlockedIdentity {
                identity: &fixture.identity,
                signing_public_key: &other_signing.public_key(),
            }),
            Err(NookError::Decryption(_))
        ));
        let other_identity = DeviceIdentity::generate()?;
        assert!(matches!(
            fixture.grant.validate_identity(ExtensionUnlockedIdentity {
                identity: &other_identity,
                signing_public_key: &fixture.signing.public_key(),
            }),
            Err(NookError::Decryption(_))
        ));
        Ok(())
    }

    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
    fn repeated_1300_item_projection_retains_warm_catalog_and_ciphertexts() -> anyhow::Result<()> {
        let fixture = ExtensionProjectionFixture::new(FixtureEnvelopeKey::Generated)?;
        let mut manager = fixture.manager();
        manager.hydrate_extension_vault_projection(fixture.request())?;
        assert_eq!(manager.vault.meta.secrets.len(), 1_300);
        manager.vault.search_catalog = SearchCatalogState::Ready(SecretSearchCatalog::default());
        manager.vault.search_catalog_dirty = false;
        for _ in 0..20 {
            manager.hydrate_extension_vault_projection(fixture.request())?;
            assert!(manager.vault.search_catalog.is_ready());
            assert!(!manager.vault.search_catalog_dirty);
            assert_eq!(manager.vault.meta.secrets.len(), 1_300);
        }
        manager.vault.crypto = VaultCryptoState::Locked;
        manager.hydrate_extension_vault_projection(fixture.request())?;
        assert!(matches!(
            manager.vault.crypto,
            VaultCryptoState::Unlocked(_)
        ));
        assert!(manager.vault.search_catalog_dirty);
        assert_eq!(manager.vault.meta.secrets.len(), 1_300);
        Ok(())
    }

    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
    fn fresh_revocation_blocks_an_already_hydrated_projection() -> anyhow::Result<()> {
        let fixture = ExtensionProjectionFixture::new(FixtureEnvelopeKey::Generated)?;
        let mut manager = fixture.manager();
        manager.hydrate_extension_vault_projection(fixture.request())?;
        let fixture = fixture.revoke()?;
        assert!(
            manager
                .hydrate_extension_vault_projection(fixture.request())
                .is_err()
        );
        Ok(())
    }

    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
    fn clear_keys_reset_and_identity_lock_end_projection_reuse() -> anyhow::Result<()> {
        let fixture = ExtensionProjectionFixture::new(FixtureEnvelopeKey::Generated)?;
        let mut manager = fixture.manager();
        manager.hydrate_extension_vault_projection(fixture.request())?;
        manager.clear_vault_keys();
        assert!(matches!(
            manager.vault.projection,
            VaultSessionProjection::Unhydrated
        ));
        manager.hydrate_extension_vault_projection(fixture.request())?;
        manager.reset_vault_session();
        assert!(matches!(
            manager.vault.projection,
            VaultSessionProjection::Unhydrated
        ));
        manager.hydrate_extension_vault_projection(fixture.request())?;
        manager.lock_device_identity();
        assert!(matches!(
            manager.vault.projection,
            VaultSessionProjection::Unhydrated
        ));
        assert!(
            manager
                .hydrate_extension_vault_projection(fixture.request())
                .is_err()
        );
        Ok(())
    }

    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
    fn malformed_envelope_keys_preserve_the_prior_session() -> anyhow::Result<()> {
        let fixture = ExtensionProjectionFixture::new(FixtureEnvelopeKey::Malformed)?;
        let mut manager = fixture.manager();
        manager.vault.store_id = "prior vault".to_owned();
        manager.vault.search_catalog_dirty = false;
        assert!(matches!(
            manager.hydrate_extension_vault_projection(fixture.request()),
            Err(NookError::Encryption(_))
        ));
        assert_eq!(manager.vault.store_id, "prior vault");
        assert!(!manager.vault.search_catalog_dirty);
        Ok(())
    }

    #[wasm_bindgen_test]
    fn passkey_capability_requires_unlock_and_simple_architecture() -> anyhow::Result<()> {
        let locked = NookVaultManager::new();
        assert!(locked.ensure_passkey_extension_capability().is_err());

        let identity = DeviceIdentity::generate()?;
        let mut ready = NookVaultManager::new();
        ready.device.identity_private_key = identity.secret_string().into_inner();
        assert!(ready.ensure_passkey_extension_capability().is_ok());

        ready.vault.architecture = VaultArchitecture::sentinel_personal(
            DeviceMode::Standard,
            nook_core::SentinelPolicy {
                threshold: 2.into(),
                required_participants: 2.into(),
                ready_participants: 0.into(),
            },
        );
        assert!(ready.ensure_passkey_extension_capability().is_err());
        ready.vault.architecture = VaultArchitecture::default();
        ready.application = VaultApplication::Simple;
        assert!(ready.ensure_passkey_extension_capability().is_err());
        Ok(())
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod browser_tests {
    use super::NookVaultManager;
    use nook_core::{DeviceIdentity, StoreId};
    use wasm_bindgen::JsError;
    use wasm_bindgen_test::wasm_bindgen_test;

    #[wasm_bindgen_test]
    async fn opening_passkey_vault_rejects_malformed_grants_before_storage() -> Result<(), JsError>
    {
        let identity = DeviceIdentity::generate()?;
        let store_id = StoreId::generate()?.to_string();
        let mut manager = NookVaultManager::new();
        manager.device.identity_private_key = identity.secret_string().into_inner();

        assert!(
            manager
                .open_extension_passkey_vault_js("", "", "", "")
                .await
                .is_err()
        );
        assert!(
            manager
                .open_extension_passkey_vault_js(&store_id, "", "", "")
                .await
                .is_err()
        );
        assert!(
            manager
                .open_extension_passkey_vault_js(
                    &store_id,
                    &identity.device_id().to_string(),
                    &identity.public_key().to_string(),
                    "",
                )
                .await
                .is_err()
        );
        Ok(())
    }
}
