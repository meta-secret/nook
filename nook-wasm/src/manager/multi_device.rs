//! Keys-mode multi-device flows.
//!
//! Wraps the join / approve / enroll choreography that the `auth:` /
//! `joins:` / `members:` sections of a keys-mode vault use. None of these
//! methods are reachable when the vault is in password mode — the
//! password-mode counterpart is `connectWithPassword` (`manager::password`).

use super::NookVaultManager;
use crate::NookError;
use crate::conversion::{
    LoadedVault, apply_member_records, load_stored_vault, records_to_armored,
    records_to_secret_types, wasm_iso_timestamp,
};
use crate::storage::indexed_db::save_device_identity_to_indexed_db;
use crate::{NookJoinRequest, NookSecretRecord, NookVaultMember};
use wasm_bindgen::JsError;
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
impl NookVaultManager {
    /// Load or create this browser's device identity (`IndexedDB`).
    pub async fn init_device(&mut self) -> Result<(), JsError> {
        self.ensure_device_identity().await?;
        Ok(())
    }

    pub fn list_pending_joins(&self) -> Result<Vec<NookJoinRequest>, JsError> {
        Ok(self.pending_joins()?)
    }

    /// Pull the latest vault file from storage when it changed; update the active session.
    pub fn list_vault_members(&self) -> Result<Vec<NookVaultMember>, JsError> {
        Ok(self.vault_members()?)
    }

    /// Device B requests access without decrypting the vault (writes join record only).
    pub async fn request_vault_access(
        &mut self,
        storage_mode: String,
        github_pat: String,
        github_repo: String,
        requested_at: String,
    ) -> Result<(), JsError> {
        self.prepare_storage(&storage_mode, &github_pat, &github_repo)
            .await?;
        let identity = self.ensure_device_identity().await?;
        let mut vault_missing = false;
        let content = self.fetch_vault_content(&mut vault_missing).await?;
        if vault_missing || content.trim().is_empty() {
            return Err(NookError::Database("No vault found to join.".to_owned()).into());
        }
        // Fresh join attempt — adopt the remote unlock mode.
        self.capture_vault_unlock(&content);

        let format = nook_core::detect_stored_format(&content)?;
        let mut records = nook_core::deserialize_stored(&content, format)?;

        let auth_id =
            nook_core::SecretId::from_vault_record(nook_core::dec_auth_id(&identity).as_str());
        if records.iter().any(|record| record.key == auth_id) {
            return Err(NookError::Database(
                "This device is already enrolled. Use Connect vault.".to_owned(),
            )
            .into());
        }

        let join_key = nook_core::SecretId::from_vault_record(&nook_core::join_record_key(
            identity.device_id(),
        ));
        records.retain(|record| record.key != join_key);
        records.push(nook_core::create_join_request_record(
            &identity,
            &requested_at,
        )?);

        self.stored_armored = records_to_armored(&records);
        self.secret_types = records_to_secret_types(&records);
        save_device_identity_to_indexed_db(&self.device_id, &self.device_identity_secret).await?;
        let signing = self.ensure_signing_identity().await?;
        let signing_pk = hex::encode(signing.verifying_key().as_bytes());
        self.persist_vault_change(vec![nook_core::VaultOperation::JoinRequested {
            device_id: identity.device_id().clone(),
            encryption_public_key: identity.public_key().clone(),
            signing_public_key: nook_core::DeviceSigningPublicKey::from_trusted(signing_pk),
            label: nook_core::MemberLabel::from_trusted(String::new()),
        }])
        .await?;
        Ok(())
    }

    /// Device B enrolls with out-of-band `secrets_key` and `members_key`, then unlocks the vault.
    pub async fn enroll_and_connect(
        &mut self,
        storage_mode: String,
        github_pat: String,
        github_repo: String,
        secrets_key: String,
        members_key: String,
    ) -> Result<Vec<NookSecretRecord>, JsError> {
        self.prepare_storage(&storage_mode, &github_pat, &github_repo)
            .await?;
        let identity = self.ensure_device_identity().await?;
        let mut vault_missing = false;
        let content = self.fetch_vault_content(&mut vault_missing).await?;
        if vault_missing || content.trim().is_empty() {
            return Err(NookError::Database("No vault found to join.".to_owned()).into());
        }
        // Fresh enrolment — adopt the remote unlock mode.
        self.capture_vault_unlock(&content);

        let format = nook_core::detect_stored_format(&content)?;
        let mut records = nook_core::deserialize_stored(&content, format)?;

        let auth_id =
            nook_core::SecretId::from_vault_record(nook_core::dec_auth_id(&identity).as_str());
        records.retain(|record| record.key != auth_id);
        records.retain(|record| !nook_core::is_members_stored_record(record));
        let parsed_secrets = nook_core::SymmetricKey::parse(&secrets_key)?;
        let parsed_members = nook_core::SymmetricKey::parse(&members_key)?;
        let (auth, members) = nook_core::enroll_device_with_keys(
            &parsed_secrets,
            &parsed_members,
            &identity,
            &wasm_iso_timestamp(),
        )?;
        records.push(auth);
        records.extend(members);

        self.stored_armored = records_to_armored(&records);
        self.secret_types = records_to_secret_types(&records);
        save_device_identity_to_indexed_db(&self.device_id, &self.device_identity_secret).await?;
        self.persist_vault_change(Vec::new()).await?;

        let updated = nook_core::serialize_stored(&records, format)?;
        let LoadedVault {
            jsonl,
            armored,
            secret_types,
            secrets_key: resolved_secrets_key,
            members_key: resolved_members_key,
        } = load_stored_vault(updated.as_str(), &identity)?;
        self.apply_vault_keys(&resolved_secrets_key, &resolved_members_key)?;
        self.decrypted_jsonl = jsonl;
        self.stored_armored = armored;
        self.secret_types = secret_types;
        Ok(self.get_records()?)
    }

    /// Device B publishes a join request record with its public key.
    pub async fn create_join_request(&mut self, requested_at: String) -> Result<(), JsError> {
        let identity = self.device_identity()?;
        let record = nook_core::create_join_request_record(&identity, &requested_at)?;
        self.stored_armored
            .insert(record.key.to_string(), record.value.as_str().to_owned());
        let signing = self.ensure_signing_identity().await?;
        let signing_pk = hex::encode(signing.verifying_key().as_bytes());
        self.persist_vault_change(vec![nook_core::VaultOperation::JoinRequested {
            device_id: identity.device_id().clone(),
            encryption_public_key: identity.public_key().clone(),
            signing_public_key: nook_core::DeviceSigningPublicKey::from_trusted(signing_pk),
            label: nook_core::MemberLabel::from_trusted(String::new()),
        }])
        .await?;
        Ok(())
    }

    /// Device A approves a pending join by encrypting DEC for the requester.
    pub async fn approve_join_request(
        &mut self,
        join_device_id: String,
    ) -> Result<Vec<NookSecretRecord>, JsError> {
        let identity = self.device_identity()?;
        let records = self.stored_records_snapshot();
        let pending = nook_core::list_join_requests(&records);
        let join_device = nook_core::DeviceId::parse(&join_device_id)?;
        let join = pending
            .into_iter()
            .find(|entry| entry.device_id == join_device)
            .ok_or_else(|| NookError::Database("Join request not found.".to_owned()))?;
        let secrets_key = nook_core::SymmetricKey::parse(&self.secrets_key)?;
        let members_key = nook_core::SymmetricKey::parse(&self.members_key)?;
        let (auth_record, join_key, member_records) = nook_core::approve_join_request(
            &secrets_key,
            &members_key,
            &join,
            &identity,
            &records,
        )?;
        self.stored_armored.remove(&join_key);
        self.stored_armored.insert(
            auth_record.key.to_string(),
            auth_record.value.as_str().to_owned(),
        );
        apply_member_records(&mut self.stored_armored, &member_records);
        let envelopes: nook_core::AuthEnvelopes = serde_json::from_str(auth_record.value.as_str())
            .map_err(|e| NookError::Serialization(e.to_string()))?;
        self.persist_vault_change(vec![nook_core::VaultOperation::JoinApproved {
            device_id: join.device_id.clone(),
            encryption_public_key: join.public_key.clone(),
            signing_public_key: nook_core::DeviceSigningPublicKey::from_trusted(String::new()),
            label: nook_core::MemberLabel::from_trusted(String::new()),
            secrets_key_ciphertext: envelopes.secrets_key.clone(),
            members_key_ciphertext: envelopes.members_key.clone(),
        }])
        .await?;
        Ok(self.get_records()?)
    }

    pub async fn deny_join_request(
        &mut self,
        join_device_id: String,
    ) -> Result<Vec<NookSecretRecord>, JsError> {
        let records = self.stored_records_snapshot();
        let join_device = nook_core::DeviceId::parse(&join_device_id)?;
        if !records.iter().any(|record| {
            nook_core::parse_join_request(record.value.as_str())
                .is_ok_and(|join| join.device_id == join_device)
        }) {
            return Err(NookError::Database("Join request not found.".to_owned()).into());
        }
        let updated = nook_core::deny_join_request(&records, &join_device);
        self.stored_armored = records_to_armored(&updated);
        self.secret_types = records_to_secret_types(&updated);
        self.persist_vault_change(vec![nook_core::VaultOperation::JoinDenied {
            device_id: join_device,
        }])
        .await?;
        Ok(self.get_records()?)
    }

    pub async fn rename_vault_member(
        &mut self,
        auth_id: String,
        label: String,
    ) -> Result<(), JsError> {
        let records = self.stored_records_snapshot();
        let parsed_auth_id = nook_core::AuthKeyId::parse(&auth_id)?;
        let members_key = nook_core::SymmetricKey::parse(&self.members_key)?;
        let member_records =
            nook_core::rename_vault_member(&records, &members_key, &parsed_auth_id, &label)?;
        apply_member_records(&mut self.stored_armored, &member_records);
        let roster = nook_core::resolve_member_roster(&records, &members_key)?;
        let device_id = roster
            .iter()
            .find(|member| member.auth_id == parsed_auth_id)
            .map(|member| member.device_id.to_string())
            .unwrap_or_default();
        self.persist_vault_change(vec![nook_core::VaultOperation::MemberRenamed {
            device_id: nook_core::DeviceId::parse(&device_id)?,
            label: nook_core::MemberLabel::from_trusted(label),
        }])
        .await?;
        Ok(())
    }

    pub async fn revoke_vault_member(
        &mut self,
        auth_id: String,
    ) -> Result<Vec<NookSecretRecord>, JsError> {
        let identity = self.device_identity()?;
        let parsed_auth_id = nook_core::AuthKeyId::parse(&auth_id)?;
        let is_self = parsed_auth_id == identity.auth_id();
        let records = self.stored_records_snapshot();
        let members_key = nook_core::SymmetricKey::parse(&self.members_key)?;
        let device_id = nook_core::resolve_member_roster(&records, &members_key)
            .ok()
            .and_then(|roster| {
                roster
                    .iter()
                    .find(|member| member.auth_id == parsed_auth_id)
                    .map(|member| member.device_id.to_string())
            })
            .unwrap_or_default();
        let updated = nook_core::revoke_vault_member(&records, &members_key, &parsed_auth_id)?;
        self.stored_armored = records_to_armored(&updated);
        self.secret_types = records_to_secret_types(&updated);

        if is_self {
            self.persist_vault_change(Vec::new()).await?;
            self.secrets_key.clear();
            self.members_key.clear();
            self.crypto = None;
            self.decrypted_jsonl.clear();
            return Ok(Vec::new());
        }

        self.ensure_event_log_ready().await?;
        self.rotate_security_epoch(nook_core::VaultOperation::DeviceRevoked {
            device_id: nook_core::DeviceId::parse(&device_id)?,
        })
        .await?;

        Ok(self.get_records()?)
    }

    /// Device B self-enrolls when it already holds `secrets_key` and `members_key` out-of-band.
    pub async fn enroll_with_keys(
        &mut self,
        secrets_key: String,
        members_key: String,
    ) -> Result<Vec<NookSecretRecord>, JsError> {
        let identity = self.device_identity()?;
        let parsed_secrets = nook_core::SymmetricKey::parse(&secrets_key)?;
        let parsed_members = nook_core::SymmetricKey::parse(&members_key)?;
        let (auth, members) = nook_core::enroll_device_with_keys(
            &parsed_secrets,
            &parsed_members,
            &identity,
            &wasm_iso_timestamp(),
        )?;
        self.apply_vault_keys(&secrets_key, &members_key)?;
        self.stored_armored
            .insert(auth.key.to_string(), auth.value.as_str().to_owned());
        for member in members {
            self.stored_armored
                .insert(member.key.to_string(), member.value.as_str().to_owned());
        }
        self.persist_vault_change(Vec::new()).await?;
        Ok(self.get_records()?)
    }

    /// Back-compat alias — `members_key` must equal `secrets_key` (legacy test path only).
    pub async fn enroll_with_dec(&mut self, dec: String) -> Result<Vec<NookSecretRecord>, JsError> {
        self.enroll_with_keys(dec.clone(), dec).await
    }
}
