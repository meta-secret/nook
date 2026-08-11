//! In-memory session mutations shared by WASM and integration tests.

use crate::errors::{SessionError, SessionResult, VaultResult};
use crate::{
    BackupCodeAttachMode, BackupCodePersistenceVerification, Database, SecretType, SecretValue,
    StoredRecordPayload, VaultCrypto, VaultMetaState, validate_secret_data, validate_secret_id,
    verify_persisted_backup_codes,
};

/// Replacement payload for [`replace_secret`].
pub struct ReplaceSecretInput<'a> {
    pub old_id: &'a str,
    pub new_id: &'a str,
    pub secret_type: SecretType,
    pub data_yaml: &'a str,
}

pub struct VerifiedAuthenticatorReplacementInput<'a> {
    pub replacement: ReplaceSecretInput<'a>,
    pub intended_backup_codes: &'a [String],
    pub reviewed_backup_codes: &'a [String],
    pub mode: BackupCodeAttachMode,
}

/// Atomically replace one vault item with another (new id + payload).
///
/// Updates the plaintext session (`Database`) and the typed `secrets` bucket
/// of the session meta state. Callers must persist storage once after this
/// returns.
pub fn replace_secret(
    db: &mut Database,
    state: &mut VaultMetaState,
    crypto: &VaultCrypto,
    input: &ReplaceSecretInput<'_>,
) -> SessionResult<()> {
    let old_id = validate_secret_id(input.old_id)?;
    let new_id = validate_secret_id(input.new_id)?;
    if old_id == new_id {
        return Err(SessionError::ReplacementIdUnchanged);
    }
    validate_secret_data(input.data_yaml)?;
    if !db.list().iter().any(|record| record.id == old_id) {
        return Err(SessionError::SecretNotFound { id: old_id });
    }
    if db.list().iter().any(|record| record.id == new_id) {
        return Err(SessionError::SecretAlreadyExists { id: new_id });
    }

    let typed_value = SecretValue::from_yaml_str(input.secret_type, input.data_yaml)?;
    db.remove_and_zeroize(&old_id);
    db.insert(new_id.clone(), typed_value);

    state.secrets.remove(&old_id);

    let encrypted = crypto.encrypt_value(input.data_yaml)?;
    state.secrets.insert(
        new_id,
        (
            input.secret_type,
            StoredRecordPayload::from_age_armored(encrypted),
        ),
    );
    Ok(())
}

/// Atomically replace one encrypted-session item without hydrating a plaintext database.
pub fn replace_encrypted_secret(
    state: &mut VaultMetaState,
    crypto: &VaultCrypto,
    input: &ReplaceSecretInput<'_>,
) -> SessionResult<()> {
    let old_id = validate_secret_id(input.old_id)?;
    let new_id = validate_secret_id(input.new_id)?;
    if old_id == new_id {
        return Err(SessionError::ReplacementIdUnchanged);
    }
    validate_secret_data(input.data_yaml)?;
    if !state.secrets.contains_key(&old_id) {
        return Err(SessionError::SecretNotFound { id: old_id });
    }
    if state.secrets.contains_key(&new_id) {
        return Err(SessionError::SecretAlreadyExists { id: new_id });
    }

    let mut typed_value = SecretValue::from_yaml_str(input.secret_type, input.data_yaml)?;
    typed_value.zeroize_plaintext();
    let encrypted = crypto.encrypt_value(input.data_yaml)?;
    state.secrets.remove(&old_id);
    state.secrets.insert(
        new_id,
        (
            input.secret_type,
            StoredRecordPayload::from_age_armored(encrypted),
        ),
    );
    Ok(())
}

/// Replace an authenticator only when the projected ciphertext decrypts to the reviewed codes.
pub fn replace_encrypted_authenticator_verified(
    state: &mut VaultMetaState,
    crypto: &VaultCrypto,
    input: &VerifiedAuthenticatorReplacementInput<'_>,
) -> VaultResult<()> {
    let old_id = validate_secret_id(input.replacement.old_id)?;
    let new_id = validate_secret_id(input.replacement.new_id)?;
    let previous_old = state
        .secrets
        .get(&old_id)
        .cloned()
        .ok_or_else(|| SessionError::SecretNotFound { id: old_id.clone() })?;
    if state.secrets.contains_key(&new_id) {
        return Err(SessionError::SecretAlreadyExists { id: new_id }.into());
    }

    let mut projected_state = VaultMetaState::default();
    projected_state.secrets.insert(old_id.clone(), previous_old);
    replace_encrypted_secret(&mut projected_state, crypto, &input.replacement)?;

    let mut projected = crate::decrypt_encrypted_secret(&projected_state.secrets, crypto, &new_id)?;
    let verification = match &projected.data {
        SecretValue::Authenticator(authenticator) => {
            verify_persisted_backup_codes(&BackupCodePersistenceVerification {
                persisted: &authenticator.backup_codes,
                intended: input.intended_backup_codes,
                reviewed: input.reviewed_backup_codes,
                mode: input.mode,
            })
            .map_err(SessionError::from)
        }
        _ => Err(SessionError::Validation(
            crate::ValidationError::AuthenticatorBackupCodesInvalid,
        )),
    };
    projected.zeroize_plaintext();
    verification?;

    let projected_new = projected_state
        .secrets
        .remove(&new_id)
        .ok_or_else(|| SessionError::SecretNotFound { id: new_id.clone() })?;
    state.secrets.remove(&old_id);
    state.secrets.insert(new_id, projected_new);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{SecretId, VaultResult, generate_vault_keys};

    #[test]
    fn encrypted_replace_preserves_validation_and_encrypts_new_payload() -> VaultResult<()> {
        let keys = generate_vault_keys()?;
        let crypto = VaultCrypto::new(&keys.secrets_key)?;
        let old_id = SecretId::from_vault_record("secret_SMypl8K0w9Y");
        let mut state = VaultMetaState::default();
        state.secrets.insert(
            old_id,
            (
                SecretType::Login,
                StoredRecordPayload::from_age_armored(crypto.encrypt_value(
                    "websiteUrl: https://old.example\nusername: old\npassword: old-password\nnotes: ''",
                )?),
            ),
        );

        replace_encrypted_secret(
            &mut state,
            &crypto,
            &ReplaceSecretInput {
                old_id: "secret_SMypl8K0w9Y",
                new_id: "secret_TMypl8K0w9Y",
                secret_type: SecretType::Login,
                data_yaml: "websiteUrl: https://new.example\nusername: new\npassword: new-password\nnotes: ''",
            },
        )?;

        assert!(
            !state
                .secrets
                .contains_key(&SecretId::from_vault_record("secret_SMypl8K0w9Y"))
        );
        let replacement_id = SecretId::from_vault_record("secret_TMypl8K0w9Y");
        let (_, payload) =
            state
                .secrets
                .get(&replacement_id)
                .ok_or(SessionError::SecretNotFound {
                    id: replacement_id.clone(),
                })?;
        assert!(payload.as_str().contains("BEGIN AGE ENCRYPTED FILE"));
        assert!(!payload.as_str().contains("new-password"));
        let projected = crate::decrypt_encrypted_secret(&state.secrets, &crypto, &replacement_id)?;
        let expected = SecretValue::from_yaml_str(
            SecretType::Login,
            "websiteUrl: https://new.example\nusername: new\npassword: new-password\nnotes: ''",
        )?;
        assert_eq!(projected.data, expected);
        Ok(())
    }

    #[test]
    fn verified_authenticator_replace_rolls_back_mismatch_and_commits_exact_codes()
    -> anyhow::Result<()> {
        let keys = generate_vault_keys()?;
        let crypto = VaultCrypto::new(&keys.secrets_key)?;
        let old_id = SecretId::from_vault_record("secret_AuThOld0001");
        let new_id = SecretId::from_vault_record("secret_AuThNew0001");
        let mut authenticator = crate::AuthenticatorSecret::from_otpauth_uri(
            "otpauth://totp/Nook:alice@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Nook",
        )?;
        authenticator.backup_codes = vec!["old-code".to_owned()];
        let old_yaml = SecretValue::Authenticator(authenticator.clone()).to_yaml()?;
        let mut state = VaultMetaState::default();
        state.secrets.insert(
            old_id.clone(),
            (
                SecretType::Authenticator,
                StoredRecordPayload::from_age_armored(crypto.encrypt_value(old_yaml.as_str())?),
            ),
        );

        authenticator.backup_codes = vec!["reviewed-code".to_owned()];
        let replacement_yaml = SecretValue::Authenticator(authenticator).to_yaml()?;
        let intended = vec!["reviewed-code".to_owned()];
        let wrong_reviewed = vec!["wrong-code".to_owned()];
        let mismatch = VerifiedAuthenticatorReplacementInput {
            replacement: ReplaceSecretInput {
                old_id: "secret_AuThOld0001",
                new_id: "secret_AuThNew0001",
                secret_type: SecretType::Authenticator,
                data_yaml: replacement_yaml.as_str(),
            },
            intended_backup_codes: &intended,
            reviewed_backup_codes: &wrong_reviewed,
            mode: BackupCodeAttachMode::Replace,
        };
        assert!(replace_encrypted_authenticator_verified(&mut state, &crypto, &mismatch).is_err());
        assert!(state.secrets.contains_key(&old_id));
        assert!(!state.secrets.contains_key(&new_id));

        let verified = VerifiedAuthenticatorReplacementInput {
            replacement: ReplaceSecretInput {
                old_id: "secret_AuThOld0001",
                new_id: "secret_AuThNew0001",
                secret_type: SecretType::Authenticator,
                data_yaml: replacement_yaml.as_str(),
            },
            intended_backup_codes: &intended,
            reviewed_backup_codes: &intended,
            mode: BackupCodeAttachMode::Replace,
        };
        replace_encrypted_authenticator_verified(&mut state, &crypto, &verified)?;
        let projected = crate::decrypt_encrypted_secret(&state.secrets, &crypto, &new_id)?;
        let SecretValue::Authenticator(projected_authenticator) = projected.data else {
            anyhow::bail!("expected projected authenticator")
        };
        assert_eq!(projected_authenticator.backup_codes, intended);
        Ok(())
    }
}
