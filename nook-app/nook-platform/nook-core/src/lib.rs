#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
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
    AuthenticatorGuidEvidence, DEVICE_ACCESS_PROFILE_VERSION,
    DEVICE_ACCESS_PROVIDER_LABEL_MAX_CHARS, DeviceAccessCredentialKind,
    DeviceAccessIdentityObservation, DeviceAccessIdentityState, DeviceAccessProfile,
    DeviceAccessProfileDecodeResult, DeviceAccessProfileTransitionError,
    DeviceAccessProfileVersion, DeviceAccessProtectionKind, DeviceAccessProviderLabelError,
    DeviceCredentialProfile, DiscardedClientEnvironment, IdentityVaultAppGrant,
    IdentityVaultAppGrantKind, IdentityVaultLinks, IdentityVaultLinksRequest, PasskeyAccessProfile,
    PasskeyAuthenticatorAttachment, PasskeyBackupState, PasskeyBrowserObservation,
    PasskeyCreatedAtEvidence, PasskeyCreationCeremony, PasskeyKeeperKind,
    PasskeyLastUsedAtEvidence, PasskeyMetadataUnrecorded, PasskeyObservedBrowser,
    PasskeyObservedPlatform, PasskeyTransport, PersistedDeviceIdentityState, VerifiedVaultAccess,
};
pub use nook_auth2::MemberLabelState;
pub use nook_auth2::RecordTypeDeclaration;
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
    AuthenticatorHostResolution, AuthenticatorIssuerHosts, AuthenticatorIssuerHostsError,
    AuthenticatorWebsiteHostRequest,
};
pub use bip39::UnsupportedMnemonicWordCount;
pub use bip39::{
    Bip39MnemonicWordCount, Bip39WordSequence, Bip39WordSequenceExpectedCount,
    Bip39WordSuggestionLimit, Bip39WordSuggestions,
};
pub use bitwarden_import::{
    BitwardenExport, BitwardenExportAccess, BitwardenImportError, BitwardenImportPlan,
};
pub use chrome_passwords_import::{
    ChromePasswordsCsvInput, ChromePasswordsImportError, ChromePasswordsImportPlan,
};
pub use credit_card::{CreditCardFields, CreditCardSecret};
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
    VaultRecoveryErrorKind, VaultResult, VaultSyncError,
};
pub use extension_identity_handoff::{
    ExtensionIdentityHandoffMaterial, ExtensionIdentityHandoffOpen, ExtensionIdentityHandoffSeal,
    ExtensionIdentityHandoffSealRequest, ExtensionIdentityHandoffSource,
    ExtensionIdentityHandoffSourceBinding, HandoffEventLog, HandoffSigningSeedChoice,
    HandoffSigningSeedSelection, StoredSigningSeed,
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
pub use nook_app_common::{AppLocale, SupportedAppLocale};
pub use nook_auth2::{
    ContextBoundSentinelUnlock, IdentitySigningSeedProtection, KeyringEntryRejection,
    KeyringRejection, LOCAL_IDENTITY_KEYRING_VERSION, LocalIdentityKeyring,
    LocalIdentityKeyringEntry, LocalIdentityProtection, ProtectedIdentityKeyring,
    ProtectedSigningEntry, ProtectedSigningMaterial, RemovedLocalIdentityKey, SentinelUnlockPolicy,
    SentinelUnlockQuorum, SentinelUnlockReadiness, SentinelUnlockRejection, SentinelUnlockRequest,
    SentinelUnlockResponse, SentinelUnlockSession, SentinelUnlockStatus, SentinelUnlockVersion,
    SigningSeedProtection, WrappedAppKeyReplacement,
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
    WebsiteLoginMatchAvailabilityWire, WebsitePasskeyEvidence, WebsitePasskeyProposal,
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
    SecretType, SecretValue, SecureNoteSecret, SeedPhraseSecret, StoredRecordPayload,
    StoredSecretRecord,
};
pub use secret_view::{
    ApiKeySecretForm, AuthenticatorBackupCodeCount, AuthenticatorGroupKeyRequest,
    AuthenticatorSecretForm, CreditCardSecretForm, FileAttachmentSecretForm, LoginHostMatchRequest,
    LoginSecretForm, LoginSiteHostsError, SecretFormFields, SecretGroupKey, SecretListItem,
    SecretListItemData, SecureNoteSecretForm, SeedPhraseSecretForm, SeedPhraseWordCount,
    WebsiteHost, WebsiteHostError,
};
pub use vault_security::{VaultSecurityAssessment, VaultSecurityRecommendations};
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
    DeviceAuthorization, EventGraphAuthorizationProjection, EventGraphDeviceAccess,
    EventGraphDeviceAccessRequest, SentinelMemberRecordProjection,
    SentinelMemberRecordProjectionRequest, VaultMetaGraphProjection, VaultMetaOperationApplier,
    VaultMetaOperationRequest,
};
pub use multi_device::SimpleIdentityGenesisOperationsInput;
pub use nook_auth2::{
    AppId, AppKey, AppKeyIdentityMembership, DirectoryCreationEnrollment, DirectoryLegacyMigration,
    DirectoryLegacyVaultImport, DirectoryMemberSigningUpdate, DirectoryOwnedVaultOpening,
    DirectoryVaultEnrollment, IdentityCreation, IdentityDirectory, IdentityDirectoryRejection,
    IdentityDirectoryResolution, IdentityDirectoryVaultKeys, IdentityId, IdentityLegacyVaultImport,
    IdentityLegacyVaultReconciliation, IdentityMember, IdentityMemberSigningUpdate,
    IdentityMemberVaultGrant, IdentityRecord, IdentityRecordRejection, IdentitySelection,
    IdentityVaultDek, IdentityVaultDekEpoch, IdentityVaultDekEpochUpdate,
    IdentityVaultDekReconciliation, IdentityVaultEventId, IdentityVaultKeyOpening,
    IdentityVaultKeys, LegacyDirectoryBase, LocalIdentityKeyRetirement, MemberDekEnvelope,
    MigratedIdentityDirectory, PreparedLegacyDirectoryMigration, RecoveryRetirement,
    StagedIdentityRebase,
};

pub use multi_device::{
    AuthEnvelopes, AuthRecordIssuance, ConnectAccessStatus, DeviceEnrollment, DeviceIdentity,
    JoinRequest, JoinRequestApproval, JoinRequestDenial, JoinRequestIssuance, MEMBER_RECORD_PREFIX,
    MemberEntry, OpenedSentinelShare, SENTINEL_SHARE_RECORD_PREFIX, SelfRosterSync,
    SentinelKeyReconstruction, SentinelParticipantEntry, SentinelShareEnvelope,
    SentinelShareOpening, SentinelShareVersion, VaultKeys, VaultMember, VaultMetaRecord,
    VaultMetaState, VaultRecordView,
};

pub use nook_event_log::{
    AppendEventInput, CanonicalEventBodyBytes, CheckedRemoteEvent, ConcurrentEpochRotations,
    Ed25519Signature, EncryptedSecretPayload, EpochCheckpoint, EpochMetadataState,
    EpochPasswordState, EpochRecord, EpochRotationReason, EpochTransition, EventCount, EventGraph,
    EventGraphInsert, EventGraphInsertion, EventGraphRejection, EventGraphVaultArchitecture,
    EventId, EventInsertStatus, EventLookup, EventPendingReason, EventStorageBytes,
    GenesisImportPayload, GenesisImportRequest, KeyEpoch, LocalEventAppend,
    LocalEventAppendOutcome, LocalEventBytes, LocalEventStore, LocalEventStoreRejection,
    LocalEventWrite, LocalOutboxRemoval, LocalOutboxRemovalResult, LocalOutboxRemoved,
    LocalOutboxWrite, LocalRemoteUnion, LocalRemoteUnionOutcome, ObservedHeads, ProjectedSecret,
    ProjectedSecretLifecycle, ProjectedSecretOrigin, ProjectionEpoch, RemoteEventBatch,
    RemoteEventLogClassification, RemoteEventWrites, RemoteStoreIdentity, SecretFingerprint,
    SecretReplacementConflict, SecurityConflict, SentinelShareIssuedPayload, SigningIdentity,
    VaultEvent, VaultEventBody, VaultEventSchemaVersion, VaultOperation, VaultProjection,
};
pub use password::{
    MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, PasswordCharacterSet, PasswordGeneration,
    PasswordGenerationOptions,
};
pub use password_envelope::{
    PASSWORD_MIN_LENGTH, PASSWORD_SCRYPT_LOG_N, PasswordEntryIssuance, PasswordEntryResolution,
    PasswordEnvelope, PasswordEnvelopeAttachment, PasswordEnvelopeResolution,
    PasswordEnvelopeRewrap, PasswordEnvelopeVersion, PasswordPolicy, PasswordUnlockEntry,
    VaultUnlock,
};

pub use secrets::SecretRecordFilter;
pub use session::{
    EncryptedSecretSession, PlaintextSecretSession, PreparedEncryptedSecretReplacement,
    ReplaceSecretInput, VerifiedAuthenticatorReplacementInput,
};
pub use sync_provider_credentials::{
    AGE_ARMOR_MARKER, ProviderCredentialEncoding, ProviderCredentialOpening,
    ProviderCredentialRejection, ProviderCredentialStorageAdmission,
};
pub use sync_provider_store::{
    ActiveProviderCredentialDraft, ActiveProviderCredentialsProjection,
    ActiveProviderCredentialsRequest, ActiveProviderLoginSetup, ActiveVaultProviderRows,
    ActiveVaultScope, AuthProvidersSnapshotData, DraftStorageConnection, DuplicateCandidatePolicy,
    DuplicateProviderSelection, DuplicateSyncProvider, EnrollmentAudience, GithubStorageDraft,
    GoogleOAuthTokenInput, ICloudOAuthTokenInput, LegacyAuthProvidersSnapshot,
    LocalFolderConfigData, LocalProviderRowChange, LocalProviderRowOutcome,
    LocalProviderRowRequest, LocalProviderSelection, ManagerStoreScopeRef, NormalizedAuthSnapshot,
    OAuthAccessToken, OAuthAccessTokenRef, OAuthFileConfigData, OAuthRemoteConfigurationUpdate,
    OAuthRemoteStorageReference, OAuthStorageDraft, OAuthStorageReference,
    ProviderEnrollmentRequest, ProviderEventFlushTarget, ProviderId, ProviderLabelLabels,
    ProviderRows, ProviderSaveOutcome, ProviderSaveRequest, ProviderSaveSetup, ProviderSelection,
    ProviderSelectionPolicy, ProviderSelectionRequest, ProviderStorageDetailLabels,
    ProviderSyncCheckpoint, ProviderSyncRevision, ProviderSyncRevisionRef,
    ProviderSyncedVaultVersion, ProviderVaultScope, ProviderWireMigration,
    RemoteEventFlushProviderRequest, SharedGoogleEnrollmentAudience, SharedGrantProviderSelection,
    StagedGithubConnection, StagedOAuthConnection, StagedRemoteConnection, StagedStorageConnection,
    StorageConnectArgs, StorageProviderData, StoredGithubPat, StoredGithubRepository,
    StoredGoogleDriveFolder, StoredICloudShareTarget, StoredLocalFolderConfiguration,
    StoredLocalFolderDirectory, StoredLocalFolderHandle, StoredOAuthAccessCredential,
    StoredOAuthAccountIdentity, StoredOAuthFileConfiguration, StoredOAuthRefreshCredential,
    StoredOAuthRemoteFileId, StoredOAuthRemoteFileName, StoredOAuthTokenExpiry,
    VaultStorageConnection,
};
pub use validation::{
    ConnectionCredentialValidation, DEFAULT_DRIVE_BACKUP_NAME, DEFAULT_GITHUB_REPO_NAME,
    DRIVE_SHARED_FOLDER_REF_PREFIX, DRIVE_STORAGE_REF_SEP, DriveBackupName, DriveEventParent,
    ExistingVaultProviderReadiness, GithubPat, GithubPatMask, GithubRepoName, GithubSyncTarget,
    GoogleDriveFolderId, GoogleDriveMode, ICloudEventTarget, ICloudMode, ICloudShareRole,
    ICloudSharedTarget, LocalFolderSyncTarget, OAuthProviderLabel, OauthAccessToken,
    OauthFilePreset, OauthFileSyncTarget, ProviderCredentialEvidence, ProviderCredentialReadiness,
    ProviderLabel, ProviderTargetKey, STORAGE_MODE_GITHUB, STORAGE_MODE_LOCAL, StorageMode,
    StorageProviderType, SyncProviderTarget, SyncProviderTargetIdentity,
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
    ExternalDeviceIdentityAuthorizationMode, InvalidDeviceProtectionStatus, JoinEnrollmentState,
    ProviderSyncFailureHandling, ProviderSyncFreshness, ProviderSyncVisibility,
    RemoteVaultAssessDecision, RemoteVaultRecoveryState, SentinelVaultUnlockState,
    UnauthenticatedSyncDecision, VaultAccessObservation, VaultClientPolicy,
    VaultConnectGateDecision, VaultConnectProbeDecision, VaultEditDecision, VaultEditMessage,
    VaultEditTranslation, VaultStorageSyncDecision, VaultSwitchDecision,
    VaultSyncTimerStartDecision, VaultSyncTimerTickDecision,
};
pub use vault_connect::{
    LoadedVault, UnlockedVault, UnlockedVaultMaterial, VaultAccessStatus, VaultContent,
    VaultContentMetadata,
};
pub use vault_crypto::VaultCrypto;
pub use vault_epoch_crypto::{
    MembersCheckpointHash, SecretEpochReencryption, VaultKeyRotation, VaultMetaRecordRewrap,
    VaultMetaRewrap,
};
pub use vault_event_session::{
    EventPublicationDestination, VaultEpochRotated, VaultEventAppend, VaultEventAppended,
    VaultEventSession, VaultEventSessionRejection, VaultOutboxFlush, VaultOutboxFlushed,
    VaultSecurityEpochRotationInput,
};
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
    SentinelDeliveryNotPending, SentinelGenesisOutput, SentinelGenesisPhase,
    StartSentinelGenesisArgs,
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
    CompletedVaultFanOut, GuardedVaultWrite, MemoryVaultStore, PreparedVaultSync,
    RejectedVaultFanOut, RejectedVaultSync, RejectedVaultWrite, RevisionGuardedWrite,
    StoreRevision, StoreRevisionRef, SyncedVaultStores, VaultSyncFanOut, VaultSyncPair,
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
    SecretPayloadYaml, Sha256Hex, SigningSeedHex, StoredVaultBlob, StoredVaultYaml, SymmetricKey,
    Url64EncodedString,
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
                secret_type: RecordTypeDeclaration::Undeclared,
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
        records.extend(VaultMember::genesis_members_records(
            GenesisMembersRecordsRequest {
                identity: &identity,
                members_key: &keys.members_key,
                enrolled_at: "2026-06-28T00:00:00Z",
            },
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

pub use nook_auth2::{
    AssessConnectAccessRequest, BuildMembersRecordsRequest, DecryptMemberEntryRequest,
    DeviceIsEnrolledRequest, EncryptMemberEntryRequest, EnsureSelfInRosterRequest,
    GenesisMembersRecordsRequest, IdentityVaultGenesisRecordsRequest, MemberFromIdentityRequest,
    PendingJoinForDeviceRequest, RenameVaultMemberRequest, ReplaceMemberRecordsRequest,
    ResolveMemberRosterRequest, RevokeVaultMemberRequest,
};

pub use nook_auth2::RosterAddMemberRequest;

pub use nook_auth2::{
    CreateSentinelRootShareRecordsForRecipientsRequest,
    CreateSentinelShareRecordsForRecipientsRequest, CreateSentinelShareRecordsRequest,
};

pub use nook_app_common::{
    LookupTranslationRequest, MergeTranslationCatalogsRequest, ResolveErrorMessageRequest,
    ResolveTranslationCatalogRequest, TranslateFromCatalogRequest, TranslateRequest,
    TranslateWithReplacementsRequest, TranslationCatalog,
};

pub use nook_companion_core::AuthenticationControlText;

pub use nook_companion_core::{
    AuthenticationRouteActuation, AuthenticationRouteEvidence, AutocompleteTokenQuery,
    CredentialUpdateRouteEvidence, OneTimeCodeRouteEvidence,
};

pub use nook_companion_core::PasskeyControlMarking;

pub use nook_companion_core::{
    AuthenticationBackupCodesEvidence, AuthenticationEnrollmentObservation,
};

pub use nook_companion_core::BackupCodePageText;

pub use nook_companion_core::{VaultHostObservation, VaultHostPolicy};

pub use vault_client_policy::{
    LoginDeviceKeyAvailability, LoginPasswordPromptUpdate, LoginUnlockAssessment,
    LoginUnlockDecision, PasswordEntryPresence,
};

pub use sync_provider_store::{AuthProviderPersistenceMode, AuthProviderPersistenceRequest};

pub use sync_provider_store::{
    EnrollmentOAuthConfigurationError, EnrollmentOAuthConfigurationRequest,
};

pub use sync_provider_store::{SharedGrantProviderOutcome, SharedGrantProviderRequest};

pub use nook_companion_core::BackupCodeCandidatePresence;

pub use vault_client_policy::{
    AddProviderPromptState, DeviceProtectionReadiness, EditBlockMessageRequest,
    EditBlockReasonRequest, EditsBlockedRequest, ExistingVaultIdentityRecoveryRequiredRequest,
    LocalVaultPresence, ManualSyncHasTargetRequest, ProviderSetupState,
    RemoteVaultAssessDecisionRequest, RemoteVaultCredentialPresence,
    ShouldAutoConnectAfterApprovalRequest, ShouldAutoUnlockRequest,
    ShouldShowLoginVaultPickerRequest, ShouldSyncFromProvidersRequest,
    ShouldUseJoinProviderForConnectRequest, SyncActivityVisibleRequest,
    UnauthenticatedSyncDecisionRequest, VaultAuthenticationState, VaultConnectProbeDecisionRequest,
    VaultExistenceRequirement, VaultFanOutSyncState, VaultIdleExpiration, VaultJoinApprovalWait,
    VaultPasswordActivity, VaultPasswordPromptState, VaultProviderSyncState, VaultSaveActivity,
    VaultSecretCreationPermission, VaultSelectionState, VaultSessionLockIntent,
    VaultStorageSyncDecisionRequest, VaultSwitchTargetRequest, VaultSyncActivity, VaultSyncChange,
    VaultSyncConflict, VaultSyncIntent, VaultSyncPermission, VaultSyncTimerStartDecisionRequest,
    VaultSyncTimerTickDecisionRequest, VaultVerificationState,
};

pub use device_access::DeviceSessionLockState;
pub use vault_connect::VaultGenesisIntent;
pub use vault_runtime_policy::RuntimeTestCapabilityExposure;
pub use vault_sync_session::YamlSyncBacking;

pub use vault_architecture::{
    SentinelPolicyDraft, SentinelPolicyDraftAdmission, SentinelPolicyDraftEvaluation,
};

pub use nook_companion_core::ImportedExtensionEventLog;
