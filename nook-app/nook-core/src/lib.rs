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

pub(crate) use auth::{
    authentication_workflow, device_key_protection, enrollment, extension_identity_handoff,
    multi_device, password_envelope,
};
pub(crate) use crypto::{event_canonical, vault_crypto, vault_epoch_crypto, vault_signing};
pub(crate) use secrets::{
    apple_passwords_import, authenticator, authenticator_issuer_hosts, bip39, bitwarden_import,
    chrome_passwords_import, google_authenticator_import, lastpass_import, onepassword_import,
    passkey_authenticator, password, proton_pass_import, secret_fingerprint, secret_types,
    secret_view, session,
};
pub(crate) use sync::{
    sync_provider_credentials, sync_provider_store, validation, vault_sync, vault_sync_conflict,
    vault_sync_session, vault_sync_store,
};
pub(crate) use vault::{
    database, vault_access_diagnostics, vault_architecture, vault_client_policy, vault_connect,
    vault_epoch, vault_event, vault_event_builder, vault_event_graph, vault_event_session,
    vault_event_store, vault_format, vault_ids, vault_projection, vault_runtime_policy,
    vault_security, vault_sentinel_genesis, vault_sentinel_onboarding, vault_sentinel_unlock,
    vault_session, vault_session_cache, vault_wire,
};

pub use apple_passwords_import::{
    ApplePasswordsImportError, ApplePasswordsImportPlan, plan_apple_passwords_import,
};
pub use authentication_workflow::{
    AuthenticationPageObservation, AuthenticationWorkflowAction, AuthenticationWorkflowKind,
    AuthenticationWorkflowSnapshot, AuthenticationWorkflowStage, classify_authentication_workflow,
    classify_authentication_workflow_candidates,
};
pub use authenticator::{
    AuthenticatorSecret, TotpAlgorithm, TotpCode, TotpDigits, TotpPeriod, TotpSecret,
    authenticator_setup_key_changed,
};
pub use authenticator_issuer_hosts::{
    mapped_host_for_issuer, normalize_issuer_lookup_key, resolve_authenticator_website_host,
};
pub use bip39::{
    bip39_english_wordlist, infer_bip39_mnemonic_length, is_bip39_word_sequence_valid,
    is_known_bip39_word, join_bip39_words, parse_bip39_words, suggest_bip39_words,
    validate_bip39_mnemonic,
};
pub use bitwarden_import::{
    BitwardenImportError, BitwardenImportPlan, plan_bitwarden_import,
    plan_bitwarden_import_with_password,
};
pub use chrome_passwords_import::{
    ChromePasswordsImportError, ChromePasswordsImportPlan, plan_chrome_passwords_import,
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
    resolve_passkey_registration, resolve_passkey_registration_for_mode,
    serialize_wrapped_device_identity, unlock_passkey_device_identity,
    unwrap_device_identity_with_pin, wrap_device_identity_with_pin,
};
pub use enrollment::{
    DecryptedEnrollmentPayload, EnrollmentCodeEnvelope, EnrollmentIssueInput, EnrollmentProvider,
    EnrollmentState, PersonalCredentialTransfer, PersonalEnrollmentProvider,
    PersonalEnrollmentProviderData, SharedEnrollmentProvider, SharedEnrollmentProviderData,
    SharedProviderGrant, TypedEnrollmentProvider, build_enrollment_link,
    decrypt_enrollment_payload, encrypt_enrollment_payload, normalize_enrollment_code,
    parse_enrollment_envelope, peek_enrollment_entry_id, peek_enrollment_entry_label,
    peek_enrollment_issued_at,
};
pub use errors::{
    DatabaseError, DeviceKeyProtectionError, EnrollmentError, EventError,
    ExtensionIdentityHandoffError, MultiDeviceError, PasswordError, SecretPayloadError,
    SessionError, ValidationError, VaultCryptoError, VaultEpochError, VaultError, VaultFormatError,
    VaultRecoveryErrorKind, VaultResult, VaultSyncError, classify_vault_recovery_error,
};
pub use extension_identity_handoff::{
    ExtensionIdentityHandoffMaterial, open_extension_identity_handoff,
    seal_extension_identity_handoff,
};
pub use google_authenticator_import::{
    GoogleAuthenticatorImportError, GoogleAuthenticatorImportPlan, plan_google_authenticator_import,
};
pub use i18n::{
    get_translation_catalog, lookup_translation, merge_translation_catalogs, parse_app_locale,
    resolve_app_locale_from_tag, resolve_app_locale_from_tags, resolve_translation_catalog,
    translate, translate_from_catalog,
};
pub use lastpass_import::{LastPassImportError, LastPassImportPlan, plan_lastpass_import};
#[cfg(feature = "mock-passkey")]
pub use nook_auth2::{
    MemoryPasskeyAuthenticator, MockPasskeyAssertion, MockPasskeyAssertionRequest,
    MockPasskeyError, MockPasskeyRegistration, MockPasskeyRegistrationRequest, MockPasskeyResult,
    MockPasskeyUserAuthorization, StoredMockPasskey,
};
pub use nook_auth2::{
    SentinelUnlockPolicy, SentinelUnlockRequest, SentinelUnlockResponse, SentinelUnlockSession,
    SentinelUnlockStatus, add_sentinel_unlock_response, finalize_sentinel_unlock,
    sentinel_unlock_request, sentinel_unlock_status,
};
pub use onepassword_import::{
    OnePasswordImportError, OnePasswordImportPlan, plan_onepassword_import,
};
pub use passkey_authenticator::{
    PasskeyAssertionRequest as WebsitePasskeyAssertionRequest, PasskeyAssertionResult,
    PasskeyAuthenticatorError, PasskeyCredentialDescriptor, PasskeyRegistrationRequest,
    PasskeyRegistrationResult, PasskeyRelyingParty, PasskeyUser, assert_website_passkey,
    create_website_passkey, validate_website_passkey_origin,
};
pub use proton_pass_import::{
    ProtonPassImportError, ProtonPassImportPlan, plan_proton_pass_import,
};
pub use secret_fingerprint::{
    SecretFingerprint, enrich_secret, secret_fingerprint, secret_identity_fingerprint,
};
pub use secret_types::{
    ApiKeySecret, FILE_ATTACHMENT_MAX_BYTES, FileAttachmentSecret, LoginSecret,
    PASSKEY_SECRET_VERSION, PasskeyCredentialKey, PasskeyPrivateKeyPkcs8, PasskeyPublicKeyCose,
    PasskeySecret, SecretRecord, SecretType, SecretValue, SecureNoteSecret, SeedPhraseSecret,
    StoredRecordPayload, StoredSecretRecord,
};
pub use secret_view::{
    ApiKeySecretForm, AuthenticatorSecretForm, FileAttachmentSecretForm, LoginSecretForm,
    SecretFormFields, SecretListItem, SecretListItemData, SecureNoteSecretForm,
    SeedPhraseSecretForm, authenticator_group_key, build_secret_yaml, build_secret_yaml_from_form,
    hostname_from_url, login_host_matches_origin, resolve_entity_group_keys,
};
pub use vault_security::{VaultSecurityRecommendations, assess_vault_security};
pub use vault_sentinel_onboarding::{
    AcceptedSentinelOnboarding, SentinelOnboardingPackage, accept_sentinel_onboarding_package,
    create_sentinel_onboarding_package, decode_sentinel_onboarding_package,
    encode_sentinel_onboarding_package,
};
pub use vault_sync_conflict::{
    ContentSyncConflict, StoreIdSyncConflict, VaultSyncConflict, VaultSyncConflictKind,
};

pub use nook_auth2::{
    SentinelGenesisIssued, SentinelGenesisParticipant, SentinelGenesisParticipantResponse,
    SentinelGenesisPolicy, SentinelGenesisPublicKeyAnnouncement, SentinelGenesisRequest,
    SentinelGenesisSession, SentinelGenesisShareDelivery, accept_sentinel_genesis_share_delivery,
    add_sentinel_genesis_participant_payload, add_sentinel_genesis_participant_payload_with_label,
    add_sentinel_genesis_public_key_announcement, add_sentinel_genesis_response,
    build_sentinel_genesis_participant_response_link, build_sentinel_genesis_request_link,
    finalize_sentinel_genesis_shares, normalize_sentinel_genesis_participant_payload,
    normalize_sentinel_genesis_request, sentinel_genesis_participant_fingerprint,
    sentinel_genesis_request,
};

pub use multi_device::sentinel_member_records_from_public_roster;
pub use multi_device::{
    AuthEnvelopes, ConnectAccessStatus, DeviceIdentity, JoinRequest, MEMBER_RECORD_PREFIX,
    MemberEntry, OpenedSentinelShare, SENTINEL_SHARE_RECORD_PREFIX, SentinelParticipantEntry,
    SentinelShareEnvelope, VaultKeys, VaultMember, VaultMetaRecord, VaultMetaState,
    apply_vault_meta_operation, approve_join_request, assess_connect_access, auth_record,
    build_members_records, count_sentinel_share_records, create_join_request_record,
    create_join_request_record_with_signing_key, create_sentinel_share_records,
    create_sentinel_share_records_for_recipients, dec_auth_id, dec_auth_id_from_public_key,
    deny_join_request, device_is_enrolled, encrypt_for_recipient, encrypt_member_entry,
    enroll_device_with_dec, enroll_device_with_keys, ensure_self_in_roster,
    event_graph_has_active_device_access, explain_connect_blocked, generate_dec, generate_id,
    generate_symmetric_key, generate_vault_keys, genesis_auth_record, genesis_dec_record,
    genesis_members_records, is_auth_id, is_auth_stored_record, is_dec_stored_record,
    is_join_stored_record, is_members_stored_record, is_reserved_device_label,
    is_sentinel_share_stored_record, is_vault_meta_record, join_record_key, list_join_requests,
    materialize_vault_meta_from_graph, member_from_identity, member_from_join, member_stored_key,
    merge_remote_join_records, open_sentinel_share_for_identity, parse_auth_envelopes,
    parse_join_request, parse_sentinel_share_envelope, pending_join_for_device,
    reconstruct_sentinel_vault_keys, reconstruct_sentinel_vault_keys_from_opened,
    rename_vault_member, replace_member_records, resolve_dec, resolve_dek, resolve_member_roster,
    resolve_members_key, resolve_secrets_key, revoke_vault_member, roster_add_member,
    sentinel_share_record_key, user_stored_records, vault_has_multi_device_records,
};

pub use event_canonical::{
    Ed25519Signature, EventId, canonical_json_bytes, canonicalize_json, event_id_from_body_bytes,
    format_ed25519_signature, parse_ed25519_signature, sha256_hex, sign_body,
    verify_body_signature,
};
pub use password::{MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, PasswordOptions, generate_password};
pub use password_envelope::{
    PASSWORD_MIN_LENGTH, PASSWORD_SCRYPT_LOG_N, PasswordEnvelope, PasswordUnlockEntry, VaultUnlock,
    attach_password_envelope, attach_password_envelope_with_work_factor, create_password_entry,
    create_password_entry_with_work_factor, is_vault_password_long_enough,
    is_vault_password_recommended_length, resolve_keys_from_entry, resolve_keys_from_password,
    vault_password_min_length, vault_password_recommended_min_length, verify_password,
    verify_password_entry,
};
pub use session::{ReplaceSecretInput, replace_encrypted_secret, replace_secret};
pub use sync_provider_credentials::{
    AGE_ARMOR_MARKER, is_sealed_credential, open_provider_credentials, seal_provider_credentials,
    seal_provider_credentials_for_public_key,
};
pub use sync_provider_store::{
    AuthProvidersSnapshotData, LocalFolderConfigData, NormalizedAuthSnapshot, OAuthFileConfigData,
    ProviderLabelLabels, ProviderStorageDetailLabels, StorageConnectArgs, StorageProviderData,
    active_vault_providers, bind_google_drive_shared_folder, draft_storage_args,
    enrollment_provider_for_architecture, enrollment_provider_for_architecture_with_storage_target,
    enrollment_provider_onboarding_type, ensure_local_provider_row, find_duplicate_sync_provider,
    first_compatible_provider_id, google_oauth_tokens_to_config, icloud_oauth_tokens_to_config,
    local_provider_for_active_vault, localize_provider_label, migrate_provider_fields,
    normalize_auth_snapshot, oauth_remote_storage_ref, provider_label_by_id,
    provider_onboarding_type, provider_replication_capability_for_row, provider_storage_detail,
    provider_supports_replication, provider_target_key, providers_visible_while_device_locked,
    seed_provider_from_legacy_storage, set_google_drive_provider_mode, set_icloud_provider_mode,
    staged_remote_storage_args, storage_args_for_provider, sync_providers_for_active_vault,
    update_oauth_remote_ref, update_provider_sync_metadata, validate_provider_row_replication,
    vault_storage_args,
};
pub use validation::{
    DEFAULT_DRIVE_BACKUP_NAME, DEFAULT_GITHUB_REPO_NAME, DRIVE_SHARED_FOLDER_REF_PREFIX,
    DRIVE_STORAGE_REF_SEP, DriveBackupName, DriveEventParent, GithubPat, GithubPatMask,
    GithubRepoName, GithubSyncTarget, GoogleDriveFolderId, GoogleDriveMode, ICloudEventTarget,
    ICloudMode, ICloudShareRole, ICloudSharedTarget, LocalFolderSyncTarget, OauthAccessToken,
    OauthFilePreset, OauthFileSyncTarget, STORAGE_MODE_GITHUB, STORAGE_MODE_LOCAL, StorageMode,
    StorageProviderType, SyncProviderTarget, filter_secrets, format_drive_storage_ref,
    format_drive_storage_ref_raw, format_sync_provider_cache_ref, has_provider_credentials,
    mask_github_pat, normalize_google_drive_folder_ref, parse_drive_storage_ref,
    staged_provider_default_label, storage_mode_for_provider, sync_provider_default_label,
    sync_provider_target_key, validate_connect, validate_drive_backup_name, validate_github_pat,
    validate_github_repo_name, validate_oauth_access_token, validate_secret_data,
    validate_storage_mode,
};
pub use vault_access_diagnostics::{
    VaultAccessDiagnosticsReport, VaultEpochDiagnosticStatus, VaultEpochHistoryDiagnostic,
    VaultEventPayloadAccessDiagnostic, VaultKeyAccessDiagnostic, VaultKeyAccessDiagnosticStatus,
    VaultRecordDecryptabilityStatus, VaultSecretAccessDiagnostic, diagnose_vault_access,
};
pub use vault_architecture::{
    DeviceMode, OnboardingType, ProviderReplicationCapability, ReplicationType, SentinelPolicy,
    SharedJoinerIdentityKind, SharedStorageGrantOutcome, SharedStorageGrantRequest,
    VaultApplication, VaultArchitecture, VaultConnectIntent, VaultType,
    prepare_shared_storage_grant, provider_replication_capability,
    validate_architecture_for_provider, validate_provider_replication,
};
pub use vault_client_policy::{
    JoinEnrollmentState, RemoteVaultAssessDecision, UnauthenticatedSyncDecision, VaultClientPolicy,
    VaultEditBlockReason,
};
pub use vault_connect::{
    LoadedVault, UnlockedVault, VaultAccessStatus, VaultContentMetadata,
    access_status_for_vault_content, apply_member_records, capture_vault_unlock_from_content,
    content_requires_genesis, load_sentinel_vault, load_sentinel_vault_from_opened,
    load_stored_vault, unlock_stored_vault,
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
    EncryptedSecretPayload, GenesisImportPayload, SecretFingerprintAssignment,
    SentinelShareIssuedPayload, VaultEvent, VaultEventBody, VaultEventSchemaVersion,
    VaultOperation, build_genesis_import_event, parse_event_storage_bytes,
    parse_remote_event_storage_bytes, serialize_event_storage_yaml,
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
pub use vault_projection::{
    ProjectedSecret, SecretReplacementConflict, SecurityConflict, VaultProjection,
    assert_projection_permutation_invariant, project_vault,
};
pub use vault_runtime_policy::{
    ClientRunMode, DEFAULT_VAULT_IDLE_TIMEOUT_MS, DEFAULT_VAULT_IDLE_WARNING_MS,
    DEFAULT_VAULT_SYNC_INTERVAL_MS, MIN_VAULT_IDLE_TIMEOUT_MS, MIN_VAULT_SYNC_INTERVAL_MS,
    VaultRuntimePolicy,
};
pub use vault_sentinel_genesis::{
    SentinelGenesisOutput, create_sentinel_genesis_public_key_announcement,
    finalize_sentinel_genesis, respond_to_sentinel_genesis_request, sentinel_genesis_operations,
    start_sentinel_genesis,
};
pub use vault_sentinel_unlock::{respond_to_sentinel_unlock_request, start_sentinel_unlock};
pub use vault_session::{
    DEFAULT_SECRET_PAGE_SIZE, MAX_SECRET_PAGE_SIZE, SecretPage,
    apply_user_records_to_armored_session, apply_user_records_to_encrypted_session,
    decrypt_encrypted_secret, query_encrypted_secrets,
};
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
