#![allow(
    clippy::missing_errors_doc,
    clippy::missing_panics_doc,
    clippy::uninlined_format_args
)]

mod bip39;
mod database;
mod i18n;
mod multi_device;
mod password;
mod password_envelope;
mod secret_types;
mod session;
mod validation;
mod vault_crypto;
mod vault_format;
mod vault_ids;
mod vault_sync;

pub use bip39::validate_bip39_mnemonic;
pub use database::Database;
pub use i18n::{get_translation_catalog, translate};
pub use secret_types::{
    ApiKeySecret, LoginSecret, SecretRecord, SecretType, SecretValue, SecureNoteSecret,
    SeedPhraseSecret, StoredSecretRecord,
};

pub use multi_device::{
    AuthEnvelopes, ConnectAccessStatus, DeviceIdentity, JoinRequest, MEMBER_RECORD_PREFIX,
    MemberEntry, VaultKeys, VaultMember, approve_join_request, assess_connect_access, auth_record,
    build_members_records, create_join_request_record, dec_auth_id, dec_auth_id_from_public_key,
    deny_join_request, device_is_enrolled, encrypt_for_recipient, encrypt_member_entry,
    enroll_device_with_dec, enroll_device_with_keys, ensure_self_in_roster,
    explain_connect_blocked, generate_dec, generate_id, generate_symmetric_key,
    generate_vault_keys, genesis_auth_record, genesis_dec_record, genesis_members_records,
    is_auth_id, is_auth_stored_record, is_dec_stored_record, is_device_id, is_join_stored_record,
    is_members_stored_record, is_reserved_device_label, is_vault_meta_record, join_record_key,
    list_join_requests, member_from_identity, member_from_join, member_stored_key,
    merge_remote_join_records, parse_auth_envelopes, parse_join_request, pending_join_for_device,
    rename_vault_member, replace_member_records, resolve_dec, resolve_dek, resolve_member_roster,
    resolve_members_key, resolve_secrets_key, revoke_vault_member, roster_add_member,
    user_stored_records, vault_has_multi_device_records,
};

pub use password::{MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, PasswordOptions, generate_password};
pub use password_envelope::{
    LEGACY_PASSWORD_ENTRY_LABEL, PASSWORD_MIN_LENGTH, PASSWORD_SCRYPT_LOG_N, PasswordEnvelope,
    PasswordUnlockEntry, VaultUnlock, attach_password_envelope, create_password_entry,
    resolve_keys_from_entry, resolve_keys_from_password, verify_password, verify_password_entry,
};
pub use session::{ReplaceSecretInput, replace_secret};
pub use validation::{
    DEFAULT_DRIVE_VAULT_FILE_NAME, DEFAULT_GITHUB_REPO_NAME, DRIVE_STORAGE_REF_SEP,
    STORAGE_MODE_GITHUB, STORAGE_MODE_LOCAL, StorageMode, filter_secrets, format_drive_storage_ref,
    parse_drive_storage_ref, validate_connect, validate_drive_vault_file_name, validate_github_pat,
    validate_github_repo_name, validate_oauth_access_token, validate_secret_data,
    validate_storage_mode,
};
pub use vault_crypto::VaultCrypto;
pub use vault_format::{
    VaultFormat, deserialize_stored, deserialize_stored_yaml_with_unlock, detect_stored_format,
    read_vault_password_entries, read_vault_store_id, read_vault_unlock, read_vault_version,
    serialize_stored, serialize_stored_yaml_with_unlock,
};
pub use vault_ids::{
    AUTH_KEY_ID_PREFIX, SECRET_ID_PREFIX, STORE_ID_PREFIX, auth_key_digest, format_auth_key_id,
    format_secret_id, format_store_id, generate_secret_id, generate_store_id, is_auth_key_id,
    is_compact_token, normalize_auth_key_id, normalize_secret_id_for_write, normalize_store_id,
    validate_secret_id, validate_store_id,
};
pub use vault_sync::{VaultRevision, VaultSyncAction, compare_vault_sync, read_vault_revision};
