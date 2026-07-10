#![allow(
    clippy::missing_errors_doc,
    clippy::missing_panics_doc,
    clippy::uninlined_format_args
)]

mod auth;
mod crypto;
mod errors;
mod i18n;
mod secrets;
mod sync;
mod vault;

pub(crate) use auth::{device_key_protection, enrollment, multi_device, password_envelope};
pub(crate) use crypto::{event_canonical, vault_crypto, vault_epoch_crypto, vault_signing};
pub(crate) use secrets::{bip39, password, secret_types, secret_view, session};
pub(crate) use sync::{
    sync_provider_credentials, sync_provider_store, validation, vault_sync, vault_sync_session,
    vault_sync_store,
};
pub(crate) use vault::{
    database, vault_access_diagnostics, vault_architecture, vault_connect, vault_epoch,
    vault_event, vault_event_builder, vault_event_graph, vault_event_session, vault_event_store,
    vault_format, vault_ids, vault_import, vault_nexus_genesis, vault_nexus_unlock,
    vault_projection, vault_session, vault_session_cache, vault_wire,
};

pub use bip39::{
    bip39_english_wordlist, infer_bip39_mnemonic_length, is_bip39_word_sequence_valid,
    is_known_bip39_word, join_bip39_words, parse_bip39_words, suggest_bip39_words,
    validate_bip39_mnemonic,
};
pub use database::Database;
pub use device_key_protection::{
    DeviceKeyProtectionSetup, PasskeyAssertionRequest, PasskeyDeviceIdentityMaterial,
    PasskeyDeviceProtectionMode, PasskeyRecoveryRequest, PasskeyRegistrationResolution,
    WrappedDeviceIdentity, derive_device_identity_from_passkey_prf,
    deterministic_passkey_prf_input, finish_passkey_device_identity,
    finish_passkey_device_identity_for_mode, finish_passkey_wrapped_device_identity,
    parse_wrapped_device_identity, passkey_assertion_request,
    passkey_derived_device_identity_record, passkey_recovery_request,
    passkey_wrapped_device_identity_record, recover_passkey_device_identity,
    resolve_passkey_registration, serialize_wrapped_device_identity,
    unlock_passkey_device_identity, unwrap_device_identity_with_pin, wrap_device_identity_with_pin,
};
pub use enrollment::{
    DecryptedEnrollmentPayload, EnrollmentCodeEnvelope, EnrollmentIssueInput, EnrollmentProvider,
    build_enrollment_link, decrypt_enrollment_payload, encrypt_enrollment_payload,
    normalize_enrollment_code, parse_enrollment_envelope, peek_enrollment_entry_id,
    peek_enrollment_entry_label, peek_enrollment_issued_at,
};
pub use errors::{
    DatabaseError, DeviceKeyProtectionError, EnrollmentError, EventError, MultiDeviceError,
    PasswordError, SecretPayloadError, SessionError, ValidationError, VaultCryptoError,
    VaultEpochError, VaultError, VaultFormatError, VaultResult, VaultSyncError,
};
pub use i18n::{
    get_translation_catalog, lookup_translation, merge_translation_catalogs, parse_app_locale,
    resolve_app_locale_from_tag, resolve_app_locale_from_tags, resolve_translation_catalog,
    translate, translate_from_catalog,
};
#[cfg(feature = "mock-passkey")]
pub use nook_auth2::{
    MemoryPasskeyAuthenticator, MockPasskeyAssertion, MockPasskeyAssertionRequest,
    MockPasskeyError, MockPasskeyRegistration, MockPasskeyRegistrationRequest, MockPasskeyResult,
    MockPasskeyUserAuthorization, StoredMockPasskey,
};
pub use nook_auth2::{
    NexusUnlockPolicy, NexusUnlockRequest, NexusUnlockResponse, NexusUnlockSession,
    NexusUnlockStatus, add_nexus_unlock_response, finalize_nexus_unlock, nexus_unlock_request,
    nexus_unlock_status,
};
pub use secret_types::{
    ApiKeySecret, LoginSecret, SecretRecord, SecretType, SecretValue, SecureNoteSecret,
    SeedPhraseSecret, StoredRecordPayload, StoredSecretRecord,
};
pub use secret_view::build_secret_yaml;

pub use nook_auth2::{
    NexusGenesisIssued, NexusGenesisParticipant, NexusGenesisParticipantResponse,
    NexusGenesisPolicy, NexusGenesisRequest, NexusGenesisSession, NexusGenesisShareDelivery,
    accept_nexus_genesis_share_delivery, add_nexus_genesis_response, finalize_nexus_genesis_shares,
    nexus_genesis_request,
};

pub use multi_device::nexus_member_records_from_public_roster;
pub use multi_device::{
    AuthEnvelopes, ConnectAccessStatus, DeviceIdentity, JoinRequest, MEMBER_RECORD_PREFIX,
    MemberEntry, NEXUS_SHARE_RECORD_PREFIX, NexusParticipantEntry, NexusShareEnvelope,
    OpenedNexusShare, VaultKeys, VaultMember, VaultMetaRecord, VaultMetaState,
    apply_vault_meta_operation, approve_join_request, assess_connect_access, auth_record,
    build_members_records, count_nexus_share_records, create_join_request_record,
    create_join_request_record_with_signing_key, create_nexus_share_records,
    create_nexus_share_records_for_recipients, dec_auth_id, dec_auth_id_from_public_key,
    deny_join_request, device_is_enrolled, encrypt_for_recipient, encrypt_member_entry,
    enroll_device_with_dec, enroll_device_with_keys, ensure_self_in_roster,
    explain_connect_blocked, generate_dec, generate_id, generate_symmetric_key,
    generate_vault_keys, genesis_auth_record, genesis_dec_record, genesis_members_records,
    is_auth_id, is_auth_stored_record, is_dec_stored_record, is_join_stored_record,
    is_members_stored_record, is_nexus_share_stored_record, is_reserved_device_label,
    is_vault_meta_record, join_record_key, list_join_requests, materialize_vault_meta_from_graph,
    member_from_identity, member_from_join, member_stored_key, merge_remote_join_records,
    nexus_share_record_key, open_nexus_share_for_identity, parse_auth_envelopes,
    parse_join_request, parse_nexus_share_envelope, pending_join_for_device,
    reconstruct_nexus_vault_keys, reconstruct_nexus_vault_keys_from_opened, rename_vault_member,
    replace_member_records, resolve_dec, resolve_dek, resolve_member_roster, resolve_members_key,
    resolve_secrets_key, revoke_vault_member, roster_add_member, user_stored_records,
    vault_has_multi_device_records,
};

pub use event_canonical::{
    Ed25519Signature, EventId, canonical_json_bytes, canonicalize_json, event_id_from_body_bytes,
    format_ed25519_signature, parse_ed25519_signature, sha256_hex, sign_body,
    verify_body_signature,
};
pub use password::{MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, PasswordOptions, generate_password};
pub use password_envelope::{
    LEGACY_PASSWORD_ENTRY_LABEL, PASSWORD_MIN_LENGTH, PASSWORD_SCRYPT_LOG_N, PasswordEnvelope,
    PasswordUnlockEntry, VaultUnlock, attach_password_envelope,
    attach_password_envelope_with_work_factor, create_password_entry,
    create_password_entry_with_work_factor, is_vault_password_long_enough,
    is_vault_password_recommended_length, resolve_keys_from_entry, resolve_keys_from_password,
    vault_password_min_length, vault_password_recommended_min_length, verify_password,
    verify_password_entry,
};
pub use session::{ReplaceSecretInput, replace_secret};
pub use sync_provider_credentials::{
    AGE_ARMOR_MARKER, is_sealed_credential, open_provider_credentials, seal_provider_credentials,
    seal_provider_credentials_for_public_key,
};
pub use sync_provider_store::{
    AuthProvidersSnapshotData, LocalFolderConfigData, NormalizedAuthSnapshot, OAuthFileConfigData,
    ProviderLabelLabels, ProviderStorageDetailLabels, StorageConnectArgs, StorageProviderData,
    draft_storage_args, enrollment_provider_for_architecture,
    enrollment_provider_for_architecture_with_storage_target, ensure_local_provider_row,
    find_duplicate_sync_provider, localize_provider_label, migrate_provider_fields,
    normalize_auth_snapshot, provider_replication_capability_for_row, provider_storage_detail,
    provider_target_key, seed_provider_from_legacy_storage, storage_args_for_provider,
    validate_provider_row_replication, vault_storage_args,
};
pub use validation::{
    DEFAULT_DRIVE_BACKUP_NAME, DEFAULT_GITHUB_REPO_NAME, DRIVE_SHARED_FOLDER_REF_PREFIX,
    DRIVE_STORAGE_REF_SEP, DriveBackupName, DriveEventParent, GithubPat, GithubPatMask,
    GithubRepoName, GithubSyncTarget, LocalFolderSyncTarget, OauthAccessToken, OauthFilePreset,
    OauthFileSyncTarget, STORAGE_MODE_GITHUB, STORAGE_MODE_LOCAL, StorageMode, StorageProviderType,
    SyncProviderTarget, filter_secrets, format_drive_storage_ref, format_drive_storage_ref_raw,
    format_sync_provider_cache_ref, has_provider_credentials, mask_github_pat,
    parse_drive_storage_ref, staged_provider_default_label, storage_mode_for_provider,
    sync_provider_default_label, sync_provider_target_key, validate_connect,
    validate_drive_backup_name, validate_github_pat, validate_github_repo_name,
    validate_oauth_access_token, validate_secret_data, validate_storage_mode,
};
pub use vault_access_diagnostics::{
    VaultAccessDiagnosticsReport, VaultEpochDiagnosticStatus, VaultEpochHistoryDiagnostic,
    VaultEventPayloadAccessDiagnostic, VaultKeyAccessDiagnostic, VaultKeyAccessDiagnosticStatus,
    VaultRecordDecryptabilityStatus, VaultSecretAccessDiagnostic, diagnose_vault_access,
};
pub use vault_architecture::{
    DeviceMode, NexusPolicy, OnboardingType, ProviderReplicationCapability, ReplicationType,
    SharedJoinerIdentityKind, SharedStorageGrantOutcome, SharedStorageGrantRequest,
    VaultArchitecture, VaultType, prepare_shared_storage_grant, provider_replication_capability,
    validate_architecture_for_provider, validate_provider_replication,
};
pub use vault_connect::{
    LoadedVault, VaultAccessStatus, VaultContentMetadata, access_status_for_vault_content,
    apply_member_records, capture_vault_unlock_from_content, content_requires_genesis,
    load_nexus_vault, load_nexus_vault_from_opened, load_stored_vault,
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
    EncryptedSecretPayload, GenesisImportPayload, NexusShareIssuedPayload, VaultEvent,
    VaultEventBody, VaultEventSchemaVersion, VaultOperation, build_genesis_import_event,
    parse_event_storage_bytes, parse_remote_event_storage_bytes, serialize_event_storage_yaml,
};
pub use vault_event_builder::{
    AppendEventInput, ObservedHeads, build_signed_event, encrypted_secret_from_armored,
    parents_from_heads,
};
pub use vault_event_graph::{EventGraph, EventInsertStatus, EventPendingReason};
pub use vault_event_session::VaultEventSession;
pub use vault_event_store::{
    LocalEventStore, RemoteEventLogClassification, classify_remote_event_log,
    remote_event_belongs_to_store, remote_event_store_id, union_remote_events,
    union_remote_events_and_heads,
};
pub use vault_format::{
    VaultFormat, current_vault_schema_version, default_vault_name_for_store_id, deserialize_stored,
    deserialize_stored_yaml_with_unlock, detect_stored_format, read_vault_architecture,
    read_vault_name, read_vault_password_entries, read_vault_schema_version, read_vault_store_id,
    read_vault_unlock, read_vault_version, serialize_stored, serialize_stored_yaml_with_unlock,
    serialize_stored_yaml_with_unlock_and_name,
    serialize_stored_yaml_with_unlock_name_architecture, set_vault_name,
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
pub use vault_nexus_genesis::{
    NexusGenesisOutput, finalize_nexus_genesis, nexus_genesis_operations,
    respond_to_nexus_genesis_request, start_nexus_genesis,
};
pub use vault_nexus_unlock::{respond_to_nexus_unlock_request, start_nexus_unlock};
pub use vault_projection::{
    ProjectedSecret, SecretReplacementConflict, SecurityConflict, VaultProjection,
    assert_projection_permutation_invariant, project_vault,
};
pub use vault_session::apply_user_records_to_armored_session;
pub use vault_session_cache::hydrate_keys_from_projection_yaml;
pub use vault_signing::SigningIdentity;
pub use vault_sync::{
    VaultRevision, VaultSyncAction, compare_vault_sync, compare_vault_sync_with_common,
    read_vault_revision, vault_content_hash,
};
pub use vault_sync_session::{YamlSyncOutcome, YamlSyncReloaded, reconcile_yaml_sync};
pub use vault_sync_store::{
    MemoryVaultStore, RevisionGuardedWrite, fan_out_sync, reconcile_vault_stores,
    reconcile_vault_stores_with_common, resolve_conflict_keep_local, resolve_conflict_keep_remote,
};
pub use vault_wire::{
    AgeArmoredCiphertext, DecryptedPlaintext, DeviceIdentitySecret, DevicePublicKey,
    DeviceSigningPublicKey, IsoTimestamp, MemberLabel, OpaqueCiphertext, PasswordEntryId,
    SecretPayloadYaml, Sha256Hex, SigningSeedHex, StoredVaultBlob, StoredVaultYaml, SymmetricKey,
    Url64EncodedString,
};
