//! In-memory session mutations shared by WASM and integration tests.

use crate::errors::{SessionError, SessionResult};
use crate::{
    Database, SecretType, SecretValue, StoredRecordPayload, VaultCrypto, VaultMetaState,
    validate_secret_data, validate_secret_id,
};

/// Replacement payload for [`replace_secret`].
pub struct ReplaceSecretInput<'a> {
    pub old_id: &'a str,
    pub new_id: &'a str,
    pub secret_type: SecretType,
    pub data_yaml: &'a str,
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
        let (_, payload) = state
            .secrets
            .get(&SecretId::from_vault_record("secret_TMypl8K0w9Y"))
            .expect("replacement");
        assert!(payload.as_str().contains("BEGIN AGE ENCRYPTED FILE"));
        assert!(!payload.as_str().contains("new-password"));
        Ok(())
    }
}
