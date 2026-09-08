#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_raw_numeric_api_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(raw_numeric_public_api))]
#![allow(
    clippy::missing_errors_doc,
    clippy::missing_panics_doc,
    clippy::uninlined_format_args
)]
mod auth;
mod crypto;
mod errors;
mod secrets;
mod sync;
mod vault;

pub(crate) use auth::{
    device_key_protection, enrollment, extension_identity_handoff, multi_device, password_envelope,
    website_login_save,
};
pub(crate) use crypto::{vault_crypto, vault_epoch_crypto};
pub use device_access::{
    DEVICE_ACCESS_PROFILE_VERSION, DEVICE_ACCESS_PROVIDER_LABEL_MAX_CHARS,
    DeviceAccessIdentityObservation, DeviceAccessIdentityState, DeviceAccessProfile,
    DeviceAccessProfileDecodeResult, DeviceAccessProfileTransitionError,
    DeviceAccessProfileVersion, DeviceAccessProtectionKind, DeviceAccessProviderLabelError,
    IdentityVaultAppGrant, IdentityVaultAppGrantKind, IdentityVaultLinks,
    IdentityVaultLinksRequest, PasskeyAccessProfile, PasskeyAuthenticatorAttachment,
    PasskeyBackupState, PasskeyBrowserObservation, PasskeyCreatedAtEvidence,
    PasskeyCreationCeremony, PasskeyKeeperKind, PasskeyLastUsedAtEvidence, PasskeyObservedBrowser,
    PasskeyObservedPlatform, PasskeyTransport, VerifiedVaultAccess,
};
pub(crate) use secrets::{
    apple_passwords_import, authenticator, authenticator_issuer_hosts, bip39, bitwarden_import,
    chrome_passwords_import, credit_card, dashlane_import, google_authenticator_import,
    import_support, keepassxc_import, keeper_import, lastpass_import, onepassword_import,
    passkey_authenticator, password, proton_pass_import, secret_types, secret_view, session,
};
pub(crate) use sync::{
    sync_provider_credentials, sync_provider_store, validation, vault_sync, vault_sync_conflict,
    vault_sync_session, vault_sync_state, vault_sync_store,
};
pub use vault::domain_numbers::*;
pub(crate) use vault::{
    database, device_access, vault_access_diagnostics, vault_architecture, vault_client_policy,
    vault_connect, vault_event_session, vault_format, vault_ids, vault_runtime_policy,
    vault_search_catalog, vault_security, vault_sentinel_genesis, vault_sentinel_onboarding,
    vault_sentinel_unlock, vault_session, vault_session_cache, vault_wire,
};

pub use apple_passwords_import::{
    ApplePasswordsCsvInput, ApplePasswordsExportInput, ApplePasswordsImportError,
    ApplePasswordsImportPlan,
};
pub use authenticator::{
    AuthenticatorSecret, BackupCodeApplication, BackupCodeAttachMode, BackupCodeInput,
    BackupCodePersistenceVerification, MAX_AUTHENTICATOR_BACKUP_CODE_LEN,
    MAX_AUTHENTICATOR_BACKUP_CODES, OtpauthPreview, TotpAlgorithm, TotpCode, TotpDigits,
    TotpPeriod, TotpRemainingSeconds, TotpSecret, TotpUnixSeconds,
};
pub use authenticator_issuer_hosts::{
    AuthenticatorIssuerHosts, AuthenticatorIssuerHostsError, AuthenticatorWebsiteHostRequest,
};
pub use bip39::{
    Bip39EnglishWordList, Bip39Mnemonic, Bip39MnemonicInput, Bip39MnemonicWordCount, Bip39Word,
    Bip39WordJoinRequest, Bip39WordSequenceExpectedCount, Bip39WordSequenceRequest,
    Bip39WordSequenceValidation, Bip39WordSuggestionLimit, Bip39WordSuggestionRequest, Bip39Words,
};
pub use bitwarden_import::{BitwardenExport, BitwardenImportError, BitwardenImportPlan};
pub use chrome_passwords_import::{
    ChromePasswordsCsvInput, ChromePasswordsImportError, ChromePasswordsImportPlan,
};
pub use credit_card::CreditCardSecret;
pub use dashlane_import::{DashlaneExport, DashlaneImportError, DashlaneImportPlan};
pub use database::Database;
pub use device_key_protection::{
    AwaitingPasskeyAssertion, DeviceIdentityProtection, DeviceKeyProtectionSetup,
    DeviceKeyProtectionVersion, PasskeyAssertionRequest, PasskeyDeviceIdentityMaterial,
    PasskeyDeviceProtectionMode, PasskeyIdentityUnlock, PasskeyProtectionInput,
    PasskeyRecordMetadata, PasskeyRecoveryInput, PasskeyRecoveryRequest, PasskeyRegistration,
    PasskeyRegistrationInput, PasskeyRegistrationOutcome, PasskeyRegistrationPrfOutput,
    PasskeyRegistrationResolution, WebAuthnCredentialId, WebAuthnPrfInput, WebAuthnPrfOutput,
    WebAuthnUserHandle, WrappedDeviceIdentity,
};
pub use enrollment::{
    CheckedEnrollmentEnvelope, CheckedEnrollmentIssuance, DecryptedEnrollmentPayload,
    EnrollmentCodeEnvelope, EnrollmentEntryLabel, EnrollmentIssuance, EnrollmentIssueInput,
    EnrollmentLinkInput, EnrollmentProvider, EnrollmentProviderDataRef, EnrollmentState,
    OAuthAccountIdentity, OAuthRefreshCredential, OAuthRemoteFile, OAuthTokenExpiry,
    PersonalCredentialTransfer, PersonalEnrollmentProvider, PersonalEnrollmentProviderData,
    SharedEnrollmentProvider, SharedEnrollmentProviderData, SharedProviderGrant,
    TypedEnrollmentProvider,
};
pub use errors::{
    DatabaseError, DeviceKeyProtectionError, EnrollmentError, EventError, EventResult,
    ExtensionIdentityHandoffError, MultiDeviceError, PasswordError, SecretPayloadError,
    SessionError, ValidationError, VaultCryptoError, VaultEpochError, VaultError, VaultFormatError,
    VaultRecoveryErrorKind, VaultResult, VaultSyncError, classify_vault_recovery_error,
};
pub use extension_identity_handoff::{
    ExtensionIdentityHandoffMaterial, ExtensionIdentityHandoffOpen, ExtensionIdentityHandoffSeal,
    HandoffEventLog, HandoffSigningSeedChoice, HandoffSigningSeedSelection,
};
pub use google_authenticator_import::{
    GoogleAuthenticatorImportError, GoogleAuthenticatorImportPlan,
    GoogleAuthenticatorMigrationInput, GoogleAuthenticatorMigrationQrCodeCount,
};
pub use import_support::{SecretImportSourceRecordCount, SecretImportUnsupportedRecordCount};
pub use keepassxc_import::{KeePassXcCsvInput, KeePassXcImportError, KeePassXcImportPlan};
pub use keeper_import::{KeeperCsvInput, KeeperImportError, KeeperImportPlan};
pub use lastpass_import::{LastPassCsvInput, LastPassImportError, LastPassImportPlan};
pub use nook_app_common::i18n_keys;
pub use nook_app_common::{
    AppLocale, get_translation_catalog, lookup_translation, merge_translation_catalogs,
    parse_app_locale, resolve_app_locale_from_tag, resolve_app_locale_from_tags,
    resolve_error_message, resolve_translation_catalog, translate, translate_from_catalog,
    translate_with_replacements,
};
pub use nook_auth2::{
    LOCAL_IDENTITY_KEYRING_VERSION, LocalIdentityKeyring, LocalIdentityKeyringEntry,
    SentinelUnlockPolicy, SentinelUnlockQuorum, SentinelUnlockReadiness, SentinelUnlockRejection,
    SentinelUnlockRequest, SentinelUnlockResponse, SentinelUnlockSession, SentinelUnlockStatus,
    SentinelUnlockVersion,
};
#[cfg(feature = "mock-passkey")]
pub use nook_auth2::{
    MemoryPasskeyAuthenticator, MockPasskeyAssertion, MockPasskeyAssertionRequest,
    MockPasskeyError, MockPasskeyRegistration, MockPasskeyRegistrationRequest, MockPasskeyResult,
    MockPasskeyUserAuthorization, StoredMockPasskey,
};
pub use nook_companion_core::{
    AuthenticationApprovalRequirement, AuthenticationOutcomeDecision,
    AuthenticationOutcomeElapsedMilliseconds, AuthenticationOutcomeObservation,
    AuthenticationOutcomeTimeoutMilliseconds, AuthenticationOutcomeVerdict,
    AuthenticationPageObservation, AuthenticationPageObservations,
    AuthenticationPilotPresentationCapability, AuthenticationSavedLoginCapability,
    AuthenticationWorkflowAction, AuthenticationWorkflowKind, AuthenticationWorkflowMatch,
    AuthenticationWorkflowRuntimeResponse, AuthenticationWorkflowRuntimeResponseDecodeError,
    AuthenticationWorkflowRuntimeResponseWire, AuthenticationWorkflowSnapshot,
    AuthenticationWorkflowSnapshotError, AuthenticationWorkflowSnapshotResponse,
    AuthenticationWorkflowSnapshotResponseDecodeError, AuthenticationWorkflowSnapshotResponseKind,
    AuthenticationWorkflowSnapshotResponseWire, AuthenticationWorkflowStage, BrowserOAuthProvider,
    DEFAULT_OUTCOME_EVIDENCE_TIMEOUT_MS, DEFAULT_SIMPLE_VAULT_URL, LoginContextObservation,
    MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT, MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS,
    OAuthOriginSupport, OAuthOriginUnsupportedReason, PageInputFieldObservation, PageInputType,
    VaultHostPolicyError, WebsiteLoginMatchAvailability, WebsiteLoginMatchAvailabilityKind,
    WebsiteLoginMatchAvailabilityWire, WebsitePasskeyProposal,
    authentication_form_observation_priority, authentication_page_observations_are_valid,
    belongs_to_sentinel_vault, belongs_to_simple_vault,
    classify_authentication_backup_codes_observation, classify_authentication_outcome,
    classify_authentication_workflow, classify_authentication_workflow_candidates,
    expand_identity_text, extract_backup_code_candidates, has_login_context, is_nook_vault_app_url,
    is_sentinel_vault_hostname, is_simple_vault_hostname, looks_like_email_verification_body,
    looks_like_login_advance_control_label, looks_like_manual_checkpoint_label,
    looks_like_one_time_code_field, looks_like_passkey_control_label, looks_like_username_field,
    matching_sentinel_vault_base_url, nook_vault_app_exclude_match_patterns,
    normalize_simple_vault_base_url, page_has_backup_code_hint, propose_website_passkey,
    sentinel_vault_match_patterns, simple_vault_match_pattern, simple_vault_url,
};
pub use nook_companion_core::{
    AuthenticationFieldCount, AuthenticationPasskeyAccountCount,
    AuthenticationSavedLoginAccountCount, AuthenticationSemanticSubmitControlCount,
    AuthenticationWorkflowCurrentStep, AuthenticationWorkflowObservationIndex,
    AuthenticationWorkflowTotalSteps, ExtensionEventCount, ExtensionSyncProviderCount,
};
pub use onepassword_import::{
    OnePasswordExport, OnePasswordImportError, OnePasswordImportPlan,
    UnsupportedOnePasswordExportVersion,
};
pub use passkey_authenticator::{
    CheckedPasskeyAssertion, CheckedPasskeyRegistration,
    PasskeyAssertionRequest as WebsitePasskeyAssertionRequest, PasskeyAssertionResult,
    PasskeyAuthenticatorError, PasskeyCredentialDescriptor, PasskeyOrigin,
    PasskeyRegistrationRequest, PasskeyRegistrationResult, PasskeyRelyingParty, PasskeyUser,
};
pub use proton_pass_import::{ProtonPassImportError, ProtonPassImportInput, ProtonPassImportPlan};
pub use secret_types::{
    ApiKeySecret, FILE_ATTACHMENT_MAX_BYTES, FileAttachmentByteCount, FileAttachmentSecret,
    LoginSecret, PASSKEY_SECRET_VERSION, PasskeyCredentialKey, PasskeyPrivateKeyPkcs8,
    PasskeyPublicKeyCose, PasskeySecret, PasskeySecretVersion, PasskeySignatureCount, SecretRecord,
    SecretType, SecretValue, SecureNoteSecret, SeedPhraseSecret, SeedPhraseSecretRequest,
    StoredRecordPayload, StoredSecretRecord,
};
pub use secret_view::{
    ApiKeySecretForm, AuthenticatorBackupCodeCount, AuthenticatorGroupKeyRequest,
    AuthenticatorSecretForm, CreditCardSecretForm, FileAttachmentSecretForm, LoginHostMatchRequest,
    LoginSecretForm, LoginSiteHostsError, SecretFormFields, SecretGroupKey, SecretListItem,
    SecretListItemData, SecureNoteSecretForm, SeedPhraseSecretForm, SeedPhraseWordCount,
    WebsiteHost,
};
pub use vault_security::{VaultSecurityRecommendations, assess_vault_security};
pub use vault_sentinel_onboarding::{
    AcceptedSentinelOnboarding, SentinelOnboardingIssuance, SentinelOnboardingPackage,
    SentinelOnboardingRecipient, SentinelOnboardingVersion,
};
pub use vault_sync_conflict::{
    ContentSyncConflict, CurrentVaultReplaceability, ProviderVaultDecision,
    ProviderVaultDecisionProjection, ProviderVaultDecisionReason, ProviderVaultIdentityEligibility,
    ProviderVaultIdentityObservation, ProviderVaultIdentityProjection, StoreIdSyncConflict,
    VaultSyncConflict, VaultSyncConflictKind,
};
pub use vault_sync_state::{
    LocalFolderHealth, LocalFolderMultipleVaultsIssue, ManualProviderSync, SyncConflictReview,
    VaultLastSync, VaultSyncUnixMilliseconds,
};
pub use website_login_save::{
    WebsiteLoginSaveCandidate, WebsiteLoginSaveDecision, WebsiteLoginSaveRequest,
};

pub use nook_auth2::{
    CheckedSentinelGenesisDelivery, CheckedSentinelGenesisResponse, DeviceKeyDerivationIterations,
    EnrollmentKeyDerivationIterations, IdentityControlEpoch, MockPasskeyCredentialCount,
    PasswordCharacterCount, PasswordWorkFactor, ReadySentinelGenesis,
    SentinelGenesisDeliveryRecipient, SentinelGenesisIssued, SentinelGenesisLinkInput,
    SentinelGenesisParticipant, SentinelGenesisParticipantResponse, SentinelGenesisPolicy,
    SentinelGenesisPublicKeyAnnouncement, SentinelGenesisReadiness, SentinelGenesisRejection,
    SentinelGenesisRequest, SentinelGenesisResponder, SentinelGenesisSession,
    SentinelGenesisShareDelivery, SentinelGenesisVersion, SentinelParticipantCount,
    SentinelRecordCount, SentinelShareCount, SentinelShareIndex, SentinelThreshold,
};

pub use auth::vault_meta_actions::{
    EventGraphAuthorizationProjection, EventGraphDeviceAccess, EventGraphDeviceAccessRequest,
    SentinelMemberRecordProjection, SentinelMemberRecordProjectionRequest,
    VaultMetaGraphProjection, VaultMetaOperationApplier, VaultMetaOperationRequest,
};
pub use multi_device::SimpleIdentityGenesisOperationsInput;
pub use nook_auth2::{
    AppId, AppKey, IdentityDirectory, IdentityId, IdentityMember, IdentityRecord,
    IdentitySelection, IdentityVaultDek, IdentityVaultDekEpoch, IdentityVaultDekEpochUpdate,
    IdentityVaultDekReconciliation, IdentityVaultEventId, MemberDekEnvelope, identity_fingerprint,
    identity_vault_genesis_records,
};

pub use multi_device::{
    AuthEnvelopes, AuthRecordIssuance, ConnectAccessStatus, DeviceEnrollment, DeviceIdentity,
    JoinRequest, JoinRequestApproval, JoinRequestDenial, JoinRequestIssuance, MEMBER_RECORD_PREFIX,
    MemberEntry, OpenedSentinelShare, SENTINEL_SHARE_RECORD_PREFIX, SelfRosterSync,
    SentinelKeyReconstruction, SentinelParticipantEntry, SentinelShareEnvelope,
    SentinelShareOpening, SentinelShareVersion, VaultKeys, VaultMember, VaultMetaRecord,
    VaultMetaState, VaultRecordView, assess_connect_access, build_members_records,
    count_sentinel_share_records, create_sentinel_share_records,
    create_sentinel_share_records_for_recipients, device_is_enrolled, encrypt_member_entry,
    ensure_self_in_roster, genesis_members_records, is_sentinel_share_stored_record,
    member_from_identity, member_from_join, parse_sentinel_share_envelope, pending_join_for_device,
    rename_vault_member, replace_member_records, resolve_member_roster, revoke_vault_member,
    roster_add_member, sentinel_share_record_key,
};

pub use nook_event_log::{
    AppendEventInput, CanonicalEventBodyBytes, CheckedRemoteEvent, Ed25519Signature,
    EncryptedSecretPayload, EpochMetadataState, EpochPasswordState, EpochRecord,
    EpochRotationReason, EpochTransition, EventCount, EventGraph, EventGraphVaultArchitecture,
    EventId, EventInsertStatus, EventPendingReason, EventStorageBytes, GenesisImportPayload,
    KeyEpoch, LocalEventStore, ObservedHeads, ProjectedSecret, ProjectedSecretLifecycle,
    ProjectedSecretOrigin, ProjectionEpoch, RemoteEventBatch, RemoteEventLogClassification,
    RemoteEventWrites, SecretFingerprint, SecretReplacementConflict, SecurityConflict,
    SentinelShareIssuedPayload, SigningIdentity, VaultEvent, VaultEventBody,
    VaultEventSchemaVersion, VaultOperation, VaultProjection, build_genesis_import_event,
    concurrent_epoch_rotations_conflict, operation_starts_epoch, parse_event_storage_bytes,
    parse_remote_event_storage_bytes, serialize_event_storage_yaml,
};
pub use password::{MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, PasswordGenerationOptions};
pub use password_envelope::{
    PASSWORD_MIN_LENGTH, PASSWORD_SCRYPT_LOG_N, PasswordEntryIssuance, PasswordEntryResolution,
    PasswordEnvelope, PasswordEnvelopeAttachment, PasswordEnvelopeResolution,
    PasswordEnvelopeRewrap, PasswordEnvelopeVersion, PasswordPolicy, PasswordUnlockEntry,
    VaultUnlock,
};
pub use secrets::SecretRecordSearch;
pub use secrets::secret_fingerprint::SecretEnrichment;
pub use session::{
    EncryptedSecretSession, PlaintextSecretSession, PreparedEncryptedSecretReplacement,
    ReplaceSecretInput, VerifiedAuthenticatorReplacementInput,
};
pub use sync_provider_credentials::{
    AGE_ARMOR_MARKER, ProviderCredentialEncoding, ProviderCredentialStorageAdmission,
};
pub use sync_provider_store::{
    ActiveProviderCredentialDraft, ActiveProviderCredentialsProjection,
    ActiveProviderCredentialsRequest, ActiveProviderLoginSetup, ActiveVaultProviderRows,
    ActiveVaultScope, AuthProvidersSnapshotData, DraftStorageConnection,
    DuplicateProviderSelection, GoogleOAuthTokenInput, ICloudOAuthTokenInput,
    LocalFolderConfigData, LocalProviderRowRequest, ManagerStoreScopeRef, NormalizedAuthSnapshot,
    OAuthAccessTokenRef, OAuthFileConfigData, ProviderEnrollmentRequest, ProviderLabelLabels,
    ProviderRows, ProviderSaveOutcome, ProviderSaveRequest, ProviderSaveSetup,
    ProviderSelectionRequest, ProviderStorageDetailLabels, ProviderSyncCheckpoint,
    ProviderSyncRevision, ProviderSyncRevisionRef, ProviderSyncedVaultVersion, ProviderVaultScope,
    SharedGrantProviderSelection, StagedRemoteConnection, StorageConnectArgs, StorageProviderData,
    StoredGithubPat, StoredGithubRepository, StoredGoogleDriveFolder, StoredICloudShareTarget,
    StoredLocalFolderConfiguration, StoredLocalFolderDirectory, StoredLocalFolderHandle,
    StoredOAuthAccessCredential, StoredOAuthAccountIdentity, StoredOAuthFileConfiguration,
    StoredOAuthRefreshCredential, StoredOAuthRemoteFileId, StoredOAuthRemoteFileName,
    StoredOAuthTokenExpiry, VaultStorageConnection,
};
pub use validation::{
    DEFAULT_DRIVE_BACKUP_NAME, DEFAULT_GITHUB_REPO_NAME, DRIVE_SHARED_FOLDER_REF_PREFIX,
    DRIVE_STORAGE_REF_SEP, DriveBackupName, DriveEventParent, ExistingVaultProviderReadiness,
    GithubPat, GithubPatMask, GithubRepoName, GithubSyncTarget, GoogleDriveFolderId,
    GoogleDriveMode, ICloudEventTarget, ICloudMode, ICloudShareRole, ICloudSharedTarget,
    LocalFolderSyncTarget, OauthAccessToken, OauthFilePreset, OauthFileSyncTarget,
    STORAGE_MODE_GITHUB, STORAGE_MODE_LOCAL, StorageMode, StorageProviderType, SyncProviderTarget,
};
pub use vault::vault_recovery_options::{
    VaultRecoveryDevice, VaultRecoveryOptions, VaultRecoveryPassword,
    VaultRecoveryProjectionRequest, VaultRecoverySummary,
};
pub use vault_access_diagnostics::{
    DiagnosticEpoch, ProjectionDiagnosticInput, VaultAccessDiagnosticRequest,
    VaultAccessDiagnosticsReport, VaultEncryptedPayloadCount, VaultEpochDiagnosticStatus,
    VaultEpochHistoryDiagnostic, VaultEventPayloadAccessDiagnostic, VaultKeyAccessDiagnostic,
    VaultKeyAccessDiagnosticStatus, VaultRecordDecryptabilityStatus, VaultSecretAccessDiagnostic,
};
pub use vault_architecture::{
    DeviceMode, OnboardingType, ProviderJoinerIdentity, ProviderOauthPreset,
    ProviderReplicationCapability, ReplicationType, SentinelConfiguration, SentinelPolicy,
    SharedJoinerIdentityKind, SharedStorageGrantCredential, SharedStorageGrantOutcome,
    SharedStorageGrantRequest, SharedStorageGrantTarget, SharedStorageTargetHint,
    SharedStorageTargetSelection, VaultApplication, VaultArchitecture, VaultConnectIntent,
    VaultType,
};
pub use vault_client_policy::{
    ActiveVaultStore, DeviceIdentityInitializationMode, DeviceProtectionStatus,
    ExternalDeviceIdentityAuthorizationMode, JoinEnrollmentState, ProviderSyncFailureHandling,
    ProviderSyncFreshness, ProviderSyncVisibility, RemoteVaultAssessDecision,
    RemoteVaultRecoveryState, SentinelVaultUnlockState, UnauthenticatedSyncDecision,
    VaultAccessObservation, VaultClientPolicy, VaultConnectGateDecision, VaultConnectProbeDecision,
    VaultEditDecision, VaultStorageSyncDecision, VaultSwitchDecision, VaultSyncTimerStartDecision,
    VaultSyncTimerTickDecision,
};
pub use vault_connect::{
    LoadedVault, UnlockedVault, VaultAccessStatus, VaultContent, VaultContentMetadata,
};
pub use vault_crypto::VaultCrypto;
pub use vault_epoch_crypto::{
    MembersCheckpointHash, SecretEpochReencryption, VaultKeyRotation, VaultMetaRecordRewrap,
    VaultMetaRewrap,
};
pub use vault_event_session::{VaultEventSession, VaultSecurityEpochRotationInput};
pub use vault_format::{
    VaultFormat, VaultFormatDocument, VaultName, VaultNameRef, VaultRecordSet, VaultStoreIdentity,
    VaultStoreIdentityRef, VaultVersionWrite,
};
pub use vault_ids::{
    AUTH_KEY_ID_PREFIX, AuthKeyId, CompactToken, DeviceId, SECRET_ID_PREFIX, STORE_ID_PREFIX,
    SecretId, StoreId,
};
pub use vault_runtime_policy::{
    ClientRunMode, DEFAULT_VAULT_IDLE_TIMEOUT_MS, DEFAULT_VAULT_IDLE_WARNING_MS,
    DEFAULT_VAULT_SYNC_INTERVAL_MS, MIN_VAULT_IDLE_TIMEOUT_MS, MIN_VAULT_SYNC_INTERVAL_MS,
    RuntimeConfigValue, VaultRuntimePolicy,
};
pub use vault_search_catalog::{
    SECRET_SEARCH_CATALOG_BUCKET_COUNT, SearchCatalogBucketPayload, SecretSearchCatalog,
    SecretSearchCatalogChangeCount, SecretSearchCatalogReconcile,
};
pub use vault_sentinel_genesis::{
    SentinelGenesisOutput, SentinelGenesisPhase, StartSentinelGenesisArgs,
};
pub use vault_sentinel_unlock::SentinelUnlockSigning;
pub use vault_session::{
    DEFAULT_SECRET_PAGE_SIZE, MAX_SECRET_PAGE_SIZE, SecretPage, SecretTypeFilter,
    VaultSecretSession, VaultUserRecordBatch,
};
pub use vault_session_cache::VaultProjectionCache;
pub use vault_sync::{
    CommonContentHash, VaultRevision, VaultRevisionStore, VaultSyncAction, VaultSyncComparison,
};
pub use vault_sync_session::{YamlSyncOutcome, YamlSyncReloaded, YamlSyncSession};
pub use vault_sync_store::{
    MemoryVaultStore, PreparedVaultSync, RevisionGuardedWrite, StoreRevision, StoreRevisionRef,
    VaultSyncFanOut, VaultSyncPair,
};
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(
        raw_numeric_public_api,
        reason = "serialization boundary: re-exports the validated digest type owned by nook-auth2"
    )
)]
pub use vault_wire::{
    AgeArmoredCiphertext, DecryptedPlaintext, DeviceIdentitySecret, DevicePublicKey,
    DeviceSigningPublicKey, IsoTimestamp, MemberLabel, OpaqueCiphertext, PasswordEntryId,
    SecretPayloadValidationRequest, SecretPayloadYaml, Sha256Hex, SigningSeedHex, StoredVaultBlob,
    StoredVaultYaml, SymmetricKey, Url64EncodedString, ValidatedSecretPayloadYaml,
};

#[cfg(test)]
mod test_support {
    use crate::{VaultStoreIdentityRef, VaultVersionWrite};

    use crate::{
        DeviceIdentity, SecretId, StoreId, StoredRecordPayload, StoredVaultYaml, VaultKeys,
        VaultRecordSet, VaultResult, VaultUnlock, genesis_members_records,
    };

    pub(crate) fn sample_vault_yaml(
        version: u64,
        store_id: &str,
        armor_line: &str,
    ) -> VaultResult<String> {
        Ok(VaultRecordSet::serialize_yaml_with_unlock(
            &[crate::StoredSecretRecord {
                key: SecretId::from_vault_record("secret_SMypl8K0w9Y"),
                secret_type: None,
                value: StoredRecordPayload::from_trusted(format!(
                    "-----BEGIN AGE ENCRYPTED FILE-----\n{armor_line}\n-----END AGE ENCRYPTED FILE-----"
                )),
            }],
            &VaultUnlock::Keys,
            &[],
            VaultStoreIdentityRef::Assigned(store_id),
            VaultVersionWrite::Version(version.into()),
        )?
        .into_inner())
    }

    pub(crate) fn simple_genesis_projection()
    -> VaultResult<(VaultKeys, DeviceIdentity, StoredVaultYaml)> {
        let keys = crate::VaultKeys::generate()?;
        let identity = DeviceIdentity::generate()?;
        let mut records = vec![identity.auth_record(&keys.secrets_key, &keys.members_key)?];
        records.extend(genesis_members_records(
            &identity,
            &keys.members_key,
            "2026-06-28T00:00:00Z",
        )?);
        let store_id = StoreId::generate()?;
        let yaml = VaultRecordSet::serialize_yaml_with_unlock(
            &records,
            &VaultUnlock::Keys,
            &[],
            VaultStoreIdentityRef::Assigned(store_id.as_str()),
            VaultVersionWrite::Initial,
        )?;
        Ok((keys, identity, yaml))
    }
}
