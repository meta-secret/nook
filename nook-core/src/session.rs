//! In-memory session mutations shared by WASM and integration tests.

use crate::errors::{SessionError, SessionResult};
use crate::{
    Database, SecretType, SecretValue, VaultCrypto, validate_secret_data, validate_secret_id,
};
use std::collections::HashMap;

/// Replacement payload for [`replace_secret`].
pub struct ReplaceSecretInput<'a> {
    pub old_id: &'a str,
    pub new_id: &'a str,
    pub secret_type: SecretType,
    pub data_yaml: &'a str,
}

/// Atomically replace one vault item with another (new id + payload).
///
/// Updates the plaintext session (`Database`), armored ciphertext cache, and type
/// map. Callers must persist storage once after this returns.
#[allow(clippy::implicit_hasher)]
pub fn replace_secret(
    db: &mut Database,
    armored: &mut HashMap<String, String>,
    secret_types: &mut HashMap<String, SecretType>,
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

    let typed_value = SecretValue::from_yaml(input.secret_type, input.data_yaml)?;
    db.remove(&old_id);
    db.insert(new_id.clone(), typed_value);

    armored.remove(&old_id);
    secret_types.remove(&old_id);

    let encrypted = crypto.encrypt_value(input.data_yaml)?;
    armored.insert(new_id.clone(), encrypted);
    secret_types.insert(new_id, input.secret_type);
    Ok(())
}
