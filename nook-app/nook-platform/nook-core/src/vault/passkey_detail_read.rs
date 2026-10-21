//! Public passkey details for a selected immutable record revision.

use std::cmp::Ordering;

use crate::{
    AgeArmoredCiphertext, EventGraph, EventLookup, PasskeyDetails, ProjectedSecret,
    ProjectedSecretLifecycle, ProjectedSecretOrigin, RecordTypeDeclaration, SecretId, SecretType,
    SecretValue, StoreId, VaultCrypto, VaultError, VaultOperation, VaultProjection,
};

#[derive(Debug, thiserror::Error)]
pub enum PasskeyDetailReadError {
    #[error("The selected passkey is not in the current vault.")]
    NotFound,
    #[error("Requested secret is not a passkey item.")]
    WrongKind,
    #[error("The selected passkey has conflicting replacements.")]
    ConflictingReplacements,
    #[error("The selected passkey replacement history is inconsistent.")]
    BrokenLineage,
    #[error(transparent)]
    Vault(#[from] VaultError),
}

/// One current-vault signed projection owns both revision resolution and ciphertext selection.
/// No old payload is decrypted, and deleted or conflicting branches cannot be resurrected.
pub struct PasskeyDetailRead<'a> {
    pub projection: &'a VaultProjection,
    pub graph: &'a EventGraph,
    pub store_id: &'a StoreId,
    pub selected_id: &'a SecretId,
    pub crypto: &'a VaultCrypto,
}

enum PasskeyProjectionAccess {
    Readable,
    Unavailable,
}

enum PasskeyRevisionState {
    Live,
    Tombstoned,
}

impl PasskeyDetailRead<'_> {
    pub fn read(&self) -> Result<PasskeyDetails, PasskeyDetailReadError> {
        let record = self.resolve()?;
        let ciphertext =
            AgeArmoredCiphertext::parse(record.record.value.as_str()).map_err(VaultError::from)?;
        let mut plaintext = self
            .crypto
            .decrypt_value(&ciphertext)
            .map_err(VaultError::from)?;
        let parsed = SecretValue::from_yaml_str(SecretType::Passkey, plaintext.as_str());
        plaintext.zeroize_plaintext();
        let mut value = parsed.map_err(VaultError::from)?;
        let details = if let SecretValue::Passkey(passkey) = &value {
            passkey.details().map_err(VaultError::from)
        } else {
            value.zeroize_plaintext();
            return Err(PasskeyDetailReadError::WrongKind);
        };
        value.zeroize_plaintext();
        Ok(details?)
    }

    fn resolve(&self) -> Result<&ProjectedSecret, PasskeyDetailReadError> {
        let PasskeyProjectionAccess::Readable = self.projection_access() else {
            return Err(PasskeyDetailReadError::NotFound);
        };
        let mut pending = vec![self.selected_id];
        let mut remaining = self.projection.secrets.len();
        let mut live = None;
        while let Some(id) = pending.pop() {
            let record = self
                .projection
                .secrets
                .get(id)
                .ok_or(PasskeyDetailReadError::NotFound)?;
            remaining = remaining
                .checked_sub(1)
                .ok_or(PasskeyDetailReadError::BrokenLineage)?;
            let RecordTypeDeclaration::Secret(SecretType::Passkey) = record.record.secret_type
            else {
                return Err(PasskeyDetailReadError::WrongKind);
            };
            // A simple branch deletion does not resolve a concurrent replacement conflict.
            let None = self.projection.replacement_conflicts.get(id) else {
                return Err(PasskeyDetailReadError::ConflictingReplacements);
            };
            match (self.revision_state(record), live) {
                (PasskeyRevisionState::Live, Some(_)) => {
                    return Err(PasskeyDetailReadError::ConflictingReplacements);
                }
                (PasskeyRevisionState::Live, None) => live = Some(record),
                (PasskeyRevisionState::Tombstoned, None | Some(_)) => {
                    pending.extend(self.successors(record)?);
                }
            }
        }
        live.ok_or(PasskeyDetailReadError::NotFound)
    }

    fn projection_access(&self) -> PasskeyProjectionAccess {
        match (
            self.projection.store_id.cmp(self.store_id),
            self.projection.cleared,
        ) {
            (Ordering::Equal, false) => PasskeyProjectionAccess::Readable,
            (Ordering::Equal, true) | (Ordering::Less | Ordering::Greater, false | true) => {
                PasskeyProjectionAccess::Unavailable
            }
        }
    }

    #[expect(
        clippy::match_bool,
        reason = "Convert the projection's native boolean into revision state"
    )]
    fn revision_state(&self, record: &ProjectedSecret) -> PasskeyRevisionState {
        match record.is_live(self.graph) {
            true => PasskeyRevisionState::Live,
            false => PasskeyRevisionState::Tombstoned,
        }
    }

    fn successors(
        &self,
        record: &ProjectedSecret,
    ) -> Result<Vec<&SecretId>, PasskeyDetailReadError> {
        let id = &record.record.key;
        let ProjectedSecretLifecycle::Deleted { by } = &record.lifecycle else {
            return Err(PasskeyDetailReadError::BrokenLineage);
        };
        let EventLookup::Recorded(event) = self.graph.get(by) else {
            return Err(PasskeyDetailReadError::BrokenLineage);
        };
        let Ordering::Equal = event.body.store_id.cmp(self.store_id) else {
            return Err(PasskeyDetailReadError::BrokenLineage);
        };
        for operation in &event.body.operations {
            let VaultOperation::SecretDeleted { secret_id } = operation else {
                continue;
            };
            let Ordering::Equal = secret_id.cmp(id) else {
                continue;
            };
            return Ok(Vec::new());
        }
        for operation in &event.body.operations {
            let VaultOperation::SecretConflictResolved {
                rejected_secret_ids,
                ..
            } = operation
            else {
                continue;
            };
            let Some(_) = rejected_secret_ids.iter().find(|rejected| *rejected == id) else {
                continue;
            };
            return Ok(Vec::new());
        }
        let replacement = event.body.operations.iter().find_map(|operation| {
            let VaultOperation::SecretReplaced { old_id, .. } = operation else {
                return None;
            };
            match old_id.cmp(id) {
                Ordering::Equal => Some(old_id),
                Ordering::Less | Ordering::Greater => None,
            }
        });
        let Some(_) = replacement else {
            return Err(PasskeyDetailReadError::BrokenLineage);
        };
        let successors = self
            .projection
            .secrets
            .iter()
            .filter_map(|(next_id, next)| {
                let ProjectedSecretOrigin::Replacement { from } = &next.origin else {
                    return None;
                };
                match from.cmp(id) {
                    Ordering::Equal => Some(next_id),
                    Ordering::Less | Ordering::Greater => None,
                }
            })
            .collect::<Vec<_>>();
        successors
            .first()
            .ok_or(PasskeyDetailReadError::BrokenLineage)?;
        Ok(successors)
    }
}

#[cfg(test)]
mod tests {
    use crate::*;
    use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};

    struct PasskeyReadFixture {
        store_id: StoreId,
        signing: SigningIdentity,
        epoch: EventId,
        graph: EventGraph,
        head: EventId,
        keys: VaultKeys,
        crypto: VaultCrypto,
        credential: PasskeySecret,
        original_id: SecretId,
        current_id: SecretId,
    }

    struct FixtureEventImport {
        parents: Vec<EventId>,
        operation: VaultOperation,
    }

    impl PasskeyReadFixture {
        fn registered() -> anyhow::Result<Self> {
            let keys = VaultKeys::generate()?;
            let crypto = VaultCrypto::new(&keys.secrets_key)?;
            let request = PasskeyRegistrationRequest {
                origin: "https://login.example.com".to_owned(),
                challenge: URL_SAFE_NO_PAD.encode([7_u8; 32]),
                relying_party: PasskeyRelyingParty {
                    id: "example.com".to_owned(),
                    name: "Example".to_owned(),
                },
                user: PasskeyUser {
                    id: URL_SAFE_NO_PAD.encode(b"user-123"),
                    name: "alice@example.com".to_owned(),
                    display_name: "Alice".to_owned(),
                },
                algorithms: vec![-7],
                exclude_credentials: Vec::new(),
                resident_key_required: true,
                user_verification: PasskeyUserVerification::Required,
            };
            let credential = request.prepare(&[])?.generate()?.credential;
            let original_id = SecretId::generate()?;
            let (signing, _) = SigningIdentity::generate()?;
            let epoch = EventId::from_body_bytes(&CanonicalEventBodyBytes::from(
                b"passkey read epoch".to_vec(),
            ));
            let mut fixture = Self {
                store_id: StoreId::generate()?,
                signing,
                epoch: epoch.clone(),
                graph: EventGraph::new(),
                head: epoch,
                keys,
                crypto,
                credential,
                original_id: original_id.clone(),
                current_id: original_id,
            };
            fixture.import(FixtureEventImport {
                parents: Vec::new(),
                operation: VaultOperation::VaultImported {
                    source_content_hash: Sha256Hex::from_bytes(b"passkey read genesis"),
                    secrets: Vec::new(),
                    password_entries: Vec::new(),
                },
            })?;
            let payload = fixture.payload(&fixture.original_id)?;
            fixture.import(FixtureEventImport {
                parents: vec![fixture.head.clone()],
                operation: VaultOperation::SecretCreated { secret: payload },
            })?;
            Ok(fixture)
        }

        fn payload(&self, id: &SecretId) -> anyhow::Result<EncryptedSecretPayload> {
            let mut value = SecretValue::Passkey(self.credential.clone());
            let identity = value.identity_fingerprint(&self.keys.secrets_key)?;
            let fingerprint = value.fingerprint(&self.keys.secrets_key)?;
            let mut yaml = value.to_yaml()?;
            let encrypted = self.crypto.encrypt_value(yaml.as_str())?;
            yaml.zeroize_plaintext();
            value.zeroize_plaintext();
            Ok(EncryptedSecretPayload::from_armored(
                id,
                SecretType::Passkey,
                encrypted.as_str(),
                identity,
                fingerprint,
            ))
        }

        fn import(&mut self, request: FixtureEventImport) -> anyhow::Result<()> {
            let event = VaultEvent::sign(
                VaultEventBody {
                    schema_version: VaultEventSchemaVersion::CURRENT,
                    store_id: self.store_id.clone(),
                    actor_id: self.signing.actor_id()?,
                    actor_signing_public_key: self.signing.public_key(),
                    parents: request.parents,
                    created_at: IsoTimestamp::parse("2026-10-21T00:00:00Z")?,
                    key_epoch: self.epoch.clone(),
                    operations: vec![request.operation],
                },
                self.signing.signing_key(),
            )?;
            let bytes = VaultEvent::serialize_event_storage_yaml(&event)?;
            let imported = VaultEvent::parse_event_storage_bytes(&bytes)?;
            self.head = imported.id()?;
            self.graph = std::mem::take(&mut self.graph)
                .insert(EventGraphInsert {
                    event: imported,
                    expected_store_id: self.store_id.as_str(),
                })
                .map_err(EventGraphRejection::into_cause)?
                .graph;
            Ok(())
        }

        fn assert_and_import(&mut self) -> anyhow::Result<()> {
            let request = WebsitePasskeyAssertionRequest {
                origin: "https://login.example.com".to_owned(),
                challenge: URL_SAFE_NO_PAD.encode([8_u8; 32]),
                rp_id: "example.com".to_owned(),
                allow_credentials: Vec::new(),
                user_verification: PasskeyUserVerification::Required,
            };
            let result = request
                .prepare(std::slice::from_ref(&self.credential))?
                .sign()?;
            self.credential.zeroize_plaintext();
            self.credential = result.updated_credential;
            let new_id = SecretId::generate()?;
            let payload = self.payload(&new_id)?;
            self.import(FixtureEventImport {
                parents: vec![self.head.clone()],
                operation: VaultOperation::SecretReplaced {
                    old_id: self.current_id.clone(),
                    new_secret: payload,
                },
            })?;
            self.current_id = new_id;
            Ok(())
        }

        fn delete(&mut self, id: SecretId) -> anyhow::Result<()> {
            self.import(FixtureEventImport {
                parents: vec![self.head.clone()],
                operation: VaultOperation::SecretDeleted { secret_id: id },
            })
        }

        fn conflicting_assertion(&mut self, parent: EventId) -> anyhow::Result<SecretId> {
            let projection = VaultProjection::from_graph(&self.graph, self.store_id.as_str())?;
            let original = projection
                .secrets
                .get(&self.original_id)
                .ok_or_else(|| anyhow::anyhow!("missing fixture registration"))?;
            let ciphertext = AgeArmoredCiphertext::parse(original.record.value.as_str())?;
            let mut plaintext = self.crypto.decrypt_value(&ciphertext)?;
            let parsed = SecretValue::from_yaml_str(SecretType::Passkey, plaintext.as_str());
            plaintext.zeroize_plaintext();
            let mut value = parsed?;
            let request = WebsitePasskeyAssertionRequest {
                origin: "https://login.example.com".to_owned(),
                challenge: URL_SAFE_NO_PAD.encode([9_u8; 32]),
                rp_id: "example.com".to_owned(),
                allow_credentials: Vec::new(),
                user_verification: PasskeyUserVerification::Required,
            };
            let signed = if let SecretValue::Passkey(passkey) = &value {
                request.prepare(std::slice::from_ref(passkey))?.sign()
            } else {
                anyhow::bail!("fixture registration is not a passkey");
            };
            value.zeroize_plaintext();
            self.credential.zeroize_plaintext();
            self.credential = signed?.updated_credential;
            let branch_id = SecretId::generate()?;
            let payload = self.payload(&branch_id)?;
            self.import(FixtureEventImport {
                parents: vec![parent],
                operation: VaultOperation::SecretReplaced {
                    old_id: self.original_id.clone(),
                    new_secret: payload,
                },
            })?;
            Ok(branch_id)
        }

        fn details(
            &self,
            selected_id: &SecretId,
        ) -> Result<PasskeyDetails, super::PasskeyDetailReadError> {
            let projection = VaultProjection::from_graph(&self.graph, self.store_id.as_str())
                .map_err(VaultError::from)?;
            super::PasskeyDetailRead {
                projection: &projection,
                graph: &self.graph,
                store_id: &self.store_id,
                selected_id,
                crypto: &self.crypto,
            }
            .read()
        }
    }

    impl Drop for PasskeyReadFixture {
        fn drop(&mut self) {
            self.credential.zeroize_plaintext();
        }
    }

    #[test]
    fn imported_assertion_keeps_visible_passkey_reference_readable() -> anyhow::Result<()> {
        let mut fixture = PasskeyReadFixture::registered()?;
        let before = fixture.details(&fixture.original_id)?;
        fixture.assert_and_import()?;
        assert_ne!(fixture.original_id, fixture.current_id);
        let current = fixture.details(&fixture.current_id)?;
        assert_eq!(u32::from(current.signature_count), 1);
        let selected = fixture.details(&fixture.original_id)?;
        assert_eq!(selected.credential_id, before.credential_id);
        assert_eq!(selected.signature_count, current.signature_count);
        Ok(())
    }

    #[test]
    fn multiple_assertions_resolve_only_latest_live_payload() -> anyhow::Result<()> {
        let mut fixture = PasskeyReadFixture::registered()?;
        fixture.assert_and_import()?;
        fixture.assert_and_import()?;
        let mut projection =
            VaultProjection::from_graph(&fixture.graph, fixture.store_id.as_str())?;
        // Prove the old private-key payload is never decrypted while following its public lineage.
        projection
            .secrets
            .get_mut(&fixture.original_id)
            .ok_or_else(|| anyhow::anyhow!("missing original"))?
            .record
            .value =
            StoredRecordPayload::from_trusted("obsolete ciphertext must not be read".to_owned());
        let details = super::PasskeyDetailRead {
            projection: &projection,
            graph: &fixture.graph,
            store_id: &fixture.store_id,
            selected_id: &fixture.original_id,
            crypto: &fixture.crypto,
        }
        .read()?;
        assert_eq!(u32::from(details.signature_count), 2);
        Ok(())
    }

    #[test]
    fn deletion_does_not_resurrect_any_revision() -> anyhow::Result<()> {
        let mut fixture = PasskeyReadFixture::registered()?;
        fixture.assert_and_import()?;
        fixture.delete(fixture.current_id.clone())?;
        assert!(matches!(
            fixture.details(&fixture.original_id),
            Err(super::PasskeyDetailReadError::NotFound)
        ));
        assert!(matches!(
            fixture.details(&fixture.current_id),
            Err(super::PasskeyDetailReadError::NotFound)
        ));
        Ok(())
    }

    #[test]
    fn missing_wrong_kind_and_other_vault_are_rejected() -> anyhow::Result<()> {
        let fixture = PasskeyReadFixture::registered()?;
        let missing = SecretId::generate()?;
        assert!(matches!(
            fixture.details(&missing),
            Err(super::PasskeyDetailReadError::NotFound)
        ));
        let mut projection =
            VaultProjection::from_graph(&fixture.graph, fixture.store_id.as_str())?;
        let other_store = StoreId::generate()?;
        let read = super::PasskeyDetailRead {
            projection: &projection,
            graph: &fixture.graph,
            store_id: &other_store,
            selected_id: &fixture.original_id,
            crypto: &fixture.crypto,
        };
        assert!(matches!(
            read.read(),
            Err(super::PasskeyDetailReadError::NotFound)
        ));
        projection
            .secrets
            .get_mut(&fixture.original_id)
            .ok_or_else(|| anyhow::anyhow!("missing original"))?
            .record
            .secret_type = RecordTypeDeclaration::Secret(SecretType::Login);
        let read = super::PasskeyDetailRead {
            projection: &projection,
            graph: &fixture.graph,
            store_id: &fixture.store_id,
            selected_id: &fixture.original_id,
            crypto: &fixture.crypto,
        };
        assert!(matches!(
            read.read(),
            Err(super::PasskeyDetailReadError::WrongKind)
        ));
        Ok(())
    }

    #[test]
    fn conflicting_replacements_stay_blocked_when_one_branch_is_deleted() -> anyhow::Result<()> {
        let mut fixture = PasskeyReadFixture::registered()?;
        let parent = fixture.head.clone();
        fixture.assert_and_import()?;
        let first_head = fixture.head.clone();
        let branch_id = fixture.conflicting_assertion(parent)?;
        assert!(matches!(
            fixture.details(&fixture.original_id),
            Err(super::PasskeyDetailReadError::ConflictingReplacements)
        ));
        fixture.import(FixtureEventImport {
            parents: vec![first_head, fixture.head.clone()],
            operation: VaultOperation::SecretDeleted {
                secret_id: branch_id,
            },
        })?;
        assert!(matches!(
            fixture.details(&fixture.original_id),
            Err(super::PasskeyDetailReadError::ConflictingReplacements)
        ));
        Ok(())
    }

    #[test]
    fn explicit_conflict_resolution_selects_only_its_live_branch() -> anyhow::Result<()> {
        let mut fixture = PasskeyReadFixture::registered()?;
        let parent = fixture.head.clone();
        fixture.assert_and_import()?;
        let first_head = fixture.head.clone();
        let branch_id = fixture.conflicting_assertion(parent)?;
        fixture.import(FixtureEventImport {
            parents: vec![first_head, fixture.head.clone()],
            operation: VaultOperation::SecretConflictResolved {
                old_id: fixture.original_id.clone(),
                chosen_secret_id: fixture.current_id.clone(),
                rejected_secret_ids: vec![branch_id],
            },
        })?;
        assert_eq!(
            u32::from(fixture.details(&fixture.original_id)?.signature_count),
            1
        );
        Ok(())
    }

    #[test]
    fn broken_replacement_is_not_a_live_read() -> anyhow::Result<()> {
        let mut fixture = PasskeyReadFixture::registered()?;
        fixture.assert_and_import()?;
        let mut projection =
            VaultProjection::from_graph(&fixture.graph, fixture.store_id.as_str())?;
        projection.secrets.remove(&fixture.current_id);
        let read = super::PasskeyDetailRead {
            projection: &projection,
            graph: &fixture.graph,
            store_id: &fixture.store_id,
            selected_id: &fixture.original_id,
            crypto: &fixture.crypto,
        };
        assert!(matches!(
            read.read(),
            Err(super::PasskeyDetailReadError::BrokenLineage)
        ));
        Ok(())
    }
}
