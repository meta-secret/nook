//! Encrypted, destination-bound transfer protocol for splitting the legacy
//! unified web origin into isolated Simple and Sentinel applications.

use crate::{
    AgeArmoredCiphertext, DeviceIdentity, DeviceIdentitySecret, DevicePublicKey, ValidationError,
    VaultResult, VaultType, encrypt_for_recipient, generate_id, read_vault_architecture,
};
use serde::{Deserialize, Serialize};
use zeroize::{Zeroize, Zeroizing};

const MIGRATION_VERSION: u8 = 1;
const SIMPLE_ORIGIN: &str = "https://simple.nokey.sh";
const SENTINEL_ORIGIN: &str = "https://sentinel.nokey.sh";

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VaultMigrationRequest {
    version: u8,
    nonce: String,
    target_origin: String,
    vault_type: VaultType,
    recipient_public_key: DevicePublicKey,
    expires_at_epoch_ms: u64,
}

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VaultMigrationPayload {
    version: u8,
    nonce: String,
    target_origin: String,
    vault_type: VaultType,
    device_identity_secret: String,
    vault_blobs: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    auth_snapshot_json: Option<String>,
    #[serde(default)]
    sentinel_share_deliveries: Vec<String>,
}

impl VaultMigrationPayload {
    #[must_use]
    pub fn nonce(&self) -> &str {
        &self.nonce
    }

    #[must_use]
    pub fn vault_type(&self) -> VaultType {
        self.vault_type
    }

    #[must_use]
    pub fn device_identity_secret(&self) -> &str {
        &self.device_identity_secret
    }

    #[must_use]
    pub fn vault_blobs(&self) -> &[String] {
        &self.vault_blobs
    }

    #[must_use]
    pub fn auth_snapshot_json(&self) -> Option<&str> {
        self.auth_snapshot_json.as_deref()
    }

    #[must_use]
    pub fn sentinel_share_deliveries(&self) -> &[String] {
        &self.sentinel_share_deliveries
    }
}

impl Drop for VaultMigrationPayload {
    fn drop(&mut self) {
        self.device_identity_secret.zeroize();
    }
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VaultMigrationCapsule {
    version: u8,
    nonce: String,
    target_origin: String,
    vault_type: VaultType,
    ciphertext: AgeArmoredCiphertext,
}

fn expected_origin(vault_type: VaultType) -> &'static str {
    match vault_type {
        VaultType::Simple => SIMPLE_ORIGIN,
        VaultType::Sentinel => SENTINEL_ORIGIN,
    }
}

fn validate_request(request: &VaultMigrationRequest, now_epoch_ms: u64) -> VaultResult<()> {
    if request.version != MIGRATION_VERSION || request.nonce.trim().is_empty() {
        return Err(ValidationError::MigrationRequestInvalid.into());
    }
    if request.target_origin != expected_origin(request.vault_type) {
        return Err(ValidationError::MigrationOriginMismatch.into());
    }
    if now_epoch_ms > request.expires_at_epoch_ms {
        return Err(ValidationError::MigrationRequestExpired.into());
    }
    Ok(())
}

pub fn create_vault_migration_request(
    vault_type: VaultType,
    expires_at_epoch_ms: u64,
) -> VaultResult<(String, DeviceIdentity)> {
    let transport_identity = DeviceIdentity::generate()?;
    let request = VaultMigrationRequest {
        version: MIGRATION_VERSION,
        nonce: generate_id()?.to_string(),
        target_origin: expected_origin(vault_type).to_owned(),
        vault_type,
        recipient_public_key: transport_identity.public_key(),
        expires_at_epoch_ms,
    };
    Ok((
        serde_json::to_string(&request).map_err(|_| ValidationError::MigrationRequestInvalid)?,
        transport_identity,
    ))
}

pub fn vault_migration_request_type(
    request_json: &str,
    now_epoch_ms: u64,
) -> VaultResult<VaultType> {
    let request: VaultMigrationRequest =
        serde_json::from_str(request_json).map_err(|_| ValidationError::MigrationRequestInvalid)?;
    validate_request(&request, now_epoch_ms)?;
    Ok(request.vault_type)
}

pub fn build_vault_migration_capsule(
    request_json: &str,
    now_epoch_ms: u64,
    device_identity_secret: &DeviceIdentitySecret,
    vault_blobs: Vec<String>,
    auth_snapshot_json: Option<String>,
    sentinel_share_deliveries: Vec<String>,
) -> VaultResult<String> {
    let request: VaultMigrationRequest =
        serde_json::from_str(request_json).map_err(|_| ValidationError::MigrationRequestInvalid)?;
    validate_request(&request, now_epoch_ms)?;
    for blob in &vault_blobs {
        if read_vault_architecture(blob)?.vault_type != request.vault_type {
            return Err(ValidationError::MigrationVaultTypeMismatch.into());
        }
    }
    let payload = VaultMigrationPayload {
        version: MIGRATION_VERSION,
        nonce: request.nonce.clone(),
        target_origin: request.target_origin.clone(),
        vault_type: request.vault_type,
        device_identity_secret: device_identity_secret.as_str().to_owned(),
        vault_blobs,
        auth_snapshot_json,
        sentinel_share_deliveries,
    };
    let plaintext = Zeroizing::new(
        serde_json::to_vec(&payload).map_err(|_| ValidationError::MigrationRequestInvalid)?,
    );
    let capsule = VaultMigrationCapsule {
        version: MIGRATION_VERSION,
        nonce: request.nonce,
        target_origin: request.target_origin,
        vault_type: request.vault_type,
        ciphertext: encrypt_for_recipient(&plaintext, &request.recipient_public_key)?,
    };
    Ok(serde_json::to_string(&capsule).map_err(|_| ValidationError::MigrationRequestInvalid)?)
}

pub fn open_vault_migration_capsule(
    request_json: &str,
    capsule_json: &str,
    now_epoch_ms: u64,
    transport_identity: &DeviceIdentity,
) -> VaultResult<VaultMigrationPayload> {
    let request: VaultMigrationRequest =
        serde_json::from_str(request_json).map_err(|_| ValidationError::MigrationRequestInvalid)?;
    validate_request(&request, now_epoch_ms)?;
    let capsule: VaultMigrationCapsule =
        serde_json::from_str(capsule_json).map_err(|_| ValidationError::MigrationRequestInvalid)?;
    if capsule.version != MIGRATION_VERSION {
        return Err(ValidationError::MigrationRequestInvalid.into());
    }
    if capsule.nonce != request.nonce {
        return Err(ValidationError::MigrationNonceMismatch.into());
    }
    if capsule.target_origin != request.target_origin {
        return Err(ValidationError::MigrationOriginMismatch.into());
    }
    if capsule.vault_type != request.vault_type {
        return Err(ValidationError::MigrationVaultTypeMismatch.into());
    }
    let plaintext = Zeroizing::new(transport_identity.open_utf8(&capsule.ciphertext)?);
    let payload: VaultMigrationPayload =
        serde_json::from_str(&plaintext).map_err(|_| ValidationError::MigrationRequestInvalid)?;
    if payload.version != MIGRATION_VERSION || payload.nonce != request.nonce {
        return Err(ValidationError::MigrationNonceMismatch.into());
    }
    if payload.target_origin != request.target_origin {
        return Err(ValidationError::MigrationOriginMismatch.into());
    }
    if payload.vault_type != request.vault_type {
        return Err(ValidationError::MigrationVaultTypeMismatch.into());
    }
    DeviceIdentity::from_secret_str(&DeviceIdentitySecret::parse(
        &payload.device_identity_secret,
    )?)?;
    for blob in &payload.vault_blobs {
        if read_vault_architecture(blob)?.vault_type != payload.vault_type {
            return Err(ValidationError::MigrationVaultTypeMismatch.into());
        }
    }
    Ok(payload)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        VaultArchitecture, VaultUnlock, serialize_stored_yaml_with_unlock_name_architecture,
    };

    fn vault_blob(vault_type: VaultType) -> String {
        let architecture = VaultArchitecture {
            vault_type,
            ..VaultArchitecture::default()
        };
        let store_id = crate::generate_store_id().unwrap();
        serialize_stored_yaml_with_unlock_name_architecture(
            &[],
            &VaultUnlock::Keys,
            &[],
            Some(store_id.as_str()),
            Some("Migrated"),
            None,
            &architecture,
        )
        .unwrap()
        .into_inner()
    }

    #[test]
    fn capsule_is_destination_bound_and_preserves_identity() {
        let source = DeviceIdentity::generate().unwrap();
        let (request, transport) =
            create_vault_migration_request(VaultType::Simple, 2_000).unwrap();
        let source_secret = source.secret_string();
        let capsule = build_vault_migration_capsule(
            &request,
            1_000,
            &source_secret,
            vec![vault_blob(VaultType::Simple)],
            None,
            vec![],
        )
        .unwrap();
        let payload = open_vault_migration_capsule(&request, &capsule, 1_001, &transport).unwrap();
        assert_eq!(
            payload.device_identity_secret(),
            source.secret_string().as_str()
        );
        assert_eq!(payload.vault_blobs().len(), 1);
    }

    #[test]
    fn capsule_rejects_expiry_and_mixed_vault_types() {
        let source = DeviceIdentity::generate().unwrap();
        let (request, _) = create_vault_migration_request(VaultType::Simple, 2_000).unwrap();
        assert!(
            build_vault_migration_capsule(
                &request,
                2_001,
                &source.secret_string(),
                vec![],
                None,
                vec![],
            )
            .is_err()
        );
        assert!(
            build_vault_migration_capsule(
                &request,
                1_000,
                &source.secret_string(),
                vec![vault_blob(VaultType::Sentinel)],
                None,
                vec![],
            )
            .is_err()
        );
    }

    #[test]
    fn capsule_rejects_wrong_request_origin_nonce_and_tampering() {
        let source = DeviceIdentity::generate().unwrap();
        let (request, transport) =
            create_vault_migration_request(VaultType::Simple, 2_000).unwrap();
        let capsule = build_vault_migration_capsule(
            &request,
            1_000,
            &source.secret_string(),
            vec![vault_blob(VaultType::Simple)],
            None,
            vec![],
        )
        .unwrap();

        let mut wrong_origin: serde_json::Value = serde_json::from_str(&request).unwrap();
        wrong_origin["targetOrigin"] = serde_json::json!(SENTINEL_ORIGIN);
        assert!(vault_migration_request_type(&wrong_origin.to_string(), 1_000).is_err());

        let (other_request, _) = create_vault_migration_request(VaultType::Simple, 2_000).unwrap();
        assert!(open_vault_migration_capsule(&other_request, &capsule, 1_001, &transport).is_err());

        let tampered = capsule.replacen("AGE ENCRYPTED FILE", "AGE TAMPERED FILE", 1);
        assert!(open_vault_migration_capsule(&request, &tampered, 1_001, &transport).is_err());
    }

    #[test]
    fn capsule_preserves_only_encrypted_auxiliary_state() {
        let source = DeviceIdentity::generate().unwrap();
        let (request, transport) =
            create_vault_migration_request(VaultType::Sentinel, 2_000).unwrap();
        let source_secret = source.secret_string();
        let auth_snapshot = r#"{"providers":[],"activeVaultStoreId":null}"#.to_owned();
        let delivery =
            r#"{"storeId":"store-1","deviceId":"device-1","deliveryJson":"ciphertext"}"#.to_owned();
        let capsule = build_vault_migration_capsule(
            &request,
            1_000,
            &source_secret,
            vec![vault_blob(VaultType::Sentinel)],
            Some(auth_snapshot.clone()),
            vec![delivery.clone()],
        )
        .unwrap();
        assert!(!capsule.contains(source_secret.as_str()));
        assert!(!capsule.contains(&auth_snapshot));
        assert!(!capsule.contains(&delivery));

        let payload = open_vault_migration_capsule(&request, &capsule, 1_001, &transport).unwrap();
        assert_eq!(payload.auth_snapshot_json(), Some(auth_snapshot.as_str()));
        assert_eq!(payload.sentinel_share_deliveries(), &[delivery]);
    }
}
