//! Public passkey details for a selected immutable record revision.

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
            fixture.import(
                Vec::new(),
                VaultOperation::VaultImported {
                    source_content_hash: Sha256Hex::from_bytes(b"passkey read genesis"),
                    secrets: Vec::new(),
                    password_entries: Vec::new(),
                },
            )?;
            let payload = fixture.payload(&fixture.original_id)?;
            fixture.import(
                vec![fixture.head.clone()],
                VaultOperation::SecretCreated { secret: payload },
            )?;
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

        fn import(
            &mut self,
            parents: Vec<EventId>,
            operation: VaultOperation,
        ) -> anyhow::Result<()> {
            let event = VaultEvent::sign(
                VaultEventBody {
                    schema_version: VaultEventSchemaVersion::CURRENT,
                    store_id: self.store_id.clone(),
                    actor_id: self.signing.actor_id()?,
                    actor_signing_public_key: self.signing.public_key(),
                    parents,
                    created_at: IsoTimestamp::parse("2026-10-21T00:00:00Z")?,
                    key_epoch: self.epoch.clone(),
                    operations: vec![operation],
                },
                self.signing.signing_key(),
            )?;
            let bytes = VaultEvent::serialize_event_storage_yaml(&event)?;
            let imported = VaultEvent::parse_event_storage_bytes(&bytes.to_vec().into())?;
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
            self.import(
                vec![self.head.clone()],
                VaultOperation::SecretReplaced {
                    old_id: self.current_id.clone(),
                    new_secret: payload,
                },
            )?;
            self.current_id = new_id;
            Ok(())
        }

        fn details(&self, selected_id: &SecretId) -> anyhow::Result<PasskeyDetails> {
            let projection = VaultProjection::from_graph(&self.graph, self.store_id.as_str())?;
            let records = projection.live_secrets(&self.graph).into_values().collect();
            let mut meta = VaultMetaState::default();
            VaultUserRecordBatch::new(records).replace(&mut meta);
            // The original WASM detail method reads this live map using the captured list ID.
            let mut record =
                VaultSecretSession::new(&meta.secrets, &self.crypto).decrypt(selected_id)?;
            let result = match &record.data {
                SecretValue::Passkey(value) => value.details(),
                _ => anyhow::bail!("fixture did not contain a passkey"),
            };
            record.zeroize_plaintext();
            Ok(result?)
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
}
