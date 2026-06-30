#![allow(
    clippy::missing_errors_doc,
    clippy::missing_panics_doc,
    clippy::uninlined_format_args
)]

mod bip39;
mod database;
mod errors;
mod event_canonical;
mod i18n;
mod multi_device;
mod password;
mod password_envelope;
mod secret_types;
mod secret_view;
mod session;
mod validation;
mod vault_connect;
mod vault_crypto;
mod vault_epoch;
mod vault_epoch_crypto;
mod vault_event;
mod vault_event_builder;
mod vault_event_graph;
mod vault_event_session;
mod vault_event_store;
mod vault_format;
mod vault_ids;
mod vault_import;
mod vault_projection;
mod vault_session;
mod vault_session_cache;
mod vault_signing;
mod vault_sync;
mod vault_sync_session;
mod vault_sync_store;
mod vault_wire;

pub use bip39::validate_bip39_mnemonic;
pub use database::Database;
pub use errors::{
    DatabaseError, EventError, MultiDeviceError, PasswordError, SecretPayloadError, SessionError,
    ValidationError, VaultCryptoError, VaultEpochError, VaultError, VaultFormatError, VaultResult,
    VaultSyncError,
};
pub use i18n::{get_translation_catalog, translate};
pub use secret_types::{
    ApiKeySecret, LoginSecret, SecretRecord, SecretType, SecretValue, SecureNoteSecret,
    SeedPhraseSecret, StoredRecordPayload, StoredSecretRecord,
};
pub use secret_view::build_secret_yaml;

pub use multi_device::{
    AuthEnvelopes, ConnectAccessStatus, DeviceIdentity, JoinRequest, MEMBER_RECORD_PREFIX,
    MemberEntry, VaultKeys, VaultMember, approve_join_request, assess_connect_access, auth_record,
    build_members_records, create_join_request_record, dec_auth_id, dec_auth_id_from_public_key,
    deny_join_request, device_is_enrolled, encrypt_for_recipient, encrypt_member_entry,
    enroll_device_with_dec, enroll_device_with_keys, ensure_self_in_roster,
    explain_connect_blocked, generate_dec, generate_id, generate_symmetric_key,
    generate_vault_keys, genesis_auth_record, genesis_dec_record, genesis_members_records,
    is_auth_id, is_auth_stored_record, is_dec_stored_record, is_join_stored_record,
    is_members_stored_record, is_reserved_device_label, is_vault_meta_record, join_record_key,
    list_join_requests, member_from_identity, member_from_join, member_stored_key,
    merge_remote_join_records, parse_auth_envelopes, parse_join_request, pending_join_for_device,
    rename_vault_member, replace_member_records, resolve_dec, resolve_dek, resolve_member_roster,
    resolve_members_key, resolve_secrets_key, revoke_vault_member, roster_add_member,
    user_stored_records, vault_has_multi_device_records,
};

pub use event_canonical::{
    Ed25519Signature, EventId, canonical_json_bytes, canonicalize_json, event_id_from_body_bytes,
    format_ed25519_signature, parse_ed25519_signature, sha256_hex, sign_body,
    verify_body_signature,
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
    DriveVaultFileName, GithubPat, GithubRepoName, OauthAccessToken, STORAGE_MODE_GITHUB,
    STORAGE_MODE_LOCAL, StorageMode, filter_secrets, format_drive_storage_ref,
    format_sync_provider_cache_ref, parse_drive_storage_ref, validate_connect,
    validate_drive_vault_file_name, validate_github_pat, validate_github_repo_name,
    validate_oauth_access_token, validate_secret_data, validate_storage_mode,
};
pub use vault_connect::{
    LoadedVault, VaultAccessStatus, access_status_for_vault_content, apply_member_records,
    capture_vault_unlock_from_content, content_requires_genesis, load_stored_vault,
};
pub use vault_crypto::VaultCrypto;
pub use vault_epoch::{
    EpochRecord, EpochRotationReason, KeyEpoch, concurrent_epoch_rotations_conflict,
    operation_starts_epoch,
};
pub use vault_epoch_crypto::{
    members_checkpoint_hash_from_roster, reencrypt_user_secrets_for_epoch,
    rewrap_vault_meta_for_epoch, rotate_vault_keys_with_secrets,
};
pub use vault_event::{
    EncryptedSecretPayload, VaultEvent, VaultEventBody, VaultEventSchemaVersion, VaultOperation,
    build_genesis_import_event,
};
pub use vault_event_builder::{
    AppendEventInput, ObservedHeads, build_signed_event, encrypted_secret_from_armored,
    parents_from_heads,
};
pub use vault_event_graph::{EventGraph, EventInsertStatus, EventPendingReason};
pub use vault_event_session::VaultEventSession;
pub use vault_event_store::{LocalEventStore, union_remote_events, union_remote_events_and_heads};
pub use vault_format::{
    VaultFormat, current_vault_schema_version, deserialize_stored,
    deserialize_stored_yaml_with_unlock, detect_stored_format, read_vault_password_entries,
    read_vault_schema_version, read_vault_store_id, read_vault_unlock, read_vault_version,
    serialize_stored, serialize_stored_yaml_with_unlock,
};
pub use vault_ids::{
    AUTH_KEY_ID_PREFIX, AuthKeyId, CompactToken, DeviceId, SECRET_ID_PREFIX, STORE_ID_PREFIX,
    SecretId, StoreId, auth_key_digest, format_auth_key_id, format_secret_id, format_store_id,
    generate_secret_id, generate_store_id, is_auth_key_id, is_compact_token, is_device_id,
    normalize_auth_key_id, normalize_secret_id_for_write, normalize_store_id, validate_secret_id,
    validate_store_id,
};
pub use vault_import::{
    KeyEpochId, VaultHashContext, secrets_from_import_event, stored_vault_to_import_event,
    verify_stored_vault_import,
};
pub use vault_projection::{
    ProjectedSecret, SecretReplacementConflict, SecurityConflict, VaultProjection,
    assert_projection_permutation_invariant, project_vault,
};
pub use vault_session::apply_user_records_to_armored_session;
pub use vault_session_cache::hydrate_keys_from_projection_yaml;
pub use vault_signing::SigningIdentity;
pub use vault_sync::{VaultRevision, VaultSyncAction, compare_vault_sync, read_vault_revision};
pub use vault_sync_session::{YamlSyncOutcome, YamlSyncReloaded, reconcile_yaml_sync};
pub use vault_sync_store::{
    MemoryVaultStore, fan_out_sync, reconcile_vault_stores, resolve_conflict_keep_local,
    resolve_conflict_keep_remote,
};
pub use vault_wire::{
    AgeArmoredCiphertext, DecryptedPlaintext, DeviceIdentitySecret, DevicePublicKey,
    DeviceSigningPublicKey, IsoTimestamp, MemberLabel, OpaqueCiphertext, PasswordEntryId,
    SecretPayloadYaml, SessionJsonl, Sha256Hex, SigningSeedHex, StoredVaultBlob, StoredVaultJsonl,
    StoredVaultYaml, SymmetricKey, Url64EncodedString,
};
