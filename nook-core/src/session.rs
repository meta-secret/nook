//! In-memory session mutations shared by WASM and integration tests.

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
) -> Result<(), String> {
    let old_id = validate_secret_id(input.old_id)?;
    let new_id = validate_secret_id(input.new_id)?;
    if old_id == new_id {
        return Err("Replacement id must differ from the item being replaced.".to_owned());
    }
    validate_secret_data(input.data_yaml)?;
    if !db.list().iter().any(|record| record.id == old_id) {
        return Err(format!("Secret {old_id} not found."));
    }
    if db.list().iter().any(|record| record.id == new_id) {
        return Err(format!("Secret {new_id} already exists."));
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
