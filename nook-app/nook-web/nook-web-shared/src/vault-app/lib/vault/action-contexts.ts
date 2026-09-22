import type {
  ProviderSyncMetadataUpdateOutcome,
  StagedProviderConflictOutcome,
  VaultSynchronizationResult,
} from "$lib/vault/sync.svelte";
import type { ActiveVaultAuthSyncOutcome } from "$lib/vault/local-login";
import type { ProviderSyncOutcome } from "$lib/vault/provider-sync.svelte";
import type { Result } from "neverthrow";
import type { VaultStorageFailure } from "$lib/runtime/storage-failure";
import type { OAuthFailure } from "$lib/auth/oauth-failure";
import type { NookStorageConnectArgs } from "$app-wasm";
export type { NookStorageConnectArgs } from "$app-wasm";
import type {
  NookPendingSyncConflict,
  NookProviderSyncRevision,
  NookRuntimeConfig,
  NookSyncConflictReview,
  ProviderSyncFailureHandling,
  ProviderSyncFreshness,
  ProviderSyncVisibility,
} from "$app-wasm";
import type { NookVaultSyncResult, VaultAccessStatus } from "$lib/nook";
import type {
  ProviderSetupRequest,
  StorageProvider,
} from "$lib/auth/providers";
import type {
  ProviderRemovalOutcome,
  ProviderPersistenceOutcome,
  ProviderSaveOutcome,
} from "$lib/vault/providers.svelte";
import type {
  LocalVaultCatalog,
  LocalProviderLookup,
  StagedRemoteStorage,
  VaultProviderState,
} from "$lib/vault/state/provider.svelte";
import type { VaultRuntimeState } from "$lib/vault/state/runtime.svelte";
import type { VaultSecretsState } from "$lib/vault/state/secrets.svelte";
import type { VaultSentinelState } from "$lib/vault/state/sentinel.svelte";
import type { VaultSessionState } from "$lib/vault/state/session.svelte";
import type { VaultSyncState } from "$lib/vault/state/sync.svelte";
import type { VaultUiState } from "$lib/vault/state/ui.svelte";
import type { VaultArchitecture } from "$lib/vault/architecture-model";
import type { TranslationRequest } from "$lib/vault/translation";
import type {
  AdminAccordionSection,
  SettingsAccordionSection,
  SettingsSection,
} from "$lib/vault/state/ui.svelte";
import type { EventOutboxRequest } from "$lib/vault/sync-operation-state";
import type { NookLocalVaultEntry, NookPasswordEntrySummary } from "$app-wasm";

export type LocalVaultCatalogRefreshSnapshot = {
  readonly vaults: readonly NookLocalVaultEntry[];
  readonly activeVaultPresent: boolean;
};

export type PasswordEntriesRefreshSnapshot = {
  readonly entries: readonly NookPasswordEntrySummary[];
};

export type SecretPageRefreshSnapshot = {
  readonly displayedSecretCount: number;
  readonly totalSecretCount: number;
  readonly pageOffset: number;
  readonly query: string;
};

export type ProjectionConflictRefreshSnapshot = {
  readonly replacementConflictCount: number;
  readonly securityConflictCount: number;
};

export type DeviceIdentityInitializationSnapshot = {
  readonly deviceId: string;
  readonly devicePublicKey: string;
};

export enum OAuthTokenFreshnessKind {
  NotConfigured = "not-configured",
  AlreadyFresh = "already-fresh",
  Refreshed = "refreshed",
}

export type OAuthTokenFreshnessOutcome =
  | { readonly kind: OAuthTokenFreshnessKind.NotConfigured }
  | { readonly kind: OAuthTokenFreshnessKind.AlreadyFresh }
  | { readonly kind: OAuthTokenFreshnessKind.Refreshed };

export enum RosterHydrationKind {
  Skipped = "skipped",
  Hydrated = "hydrated",
}

export type RosterHydrationOutcome =
  | { readonly kind: RosterHydrationKind.Skipped }
  | {
      readonly kind: RosterHydrationKind.Hydrated;
      readonly pendingJoinCount: number;
      readonly vaultMemberCount: number;
      readonly passwordEntryCount: number;
    };

export enum EventOutboxFlushKind {
  Unavailable = "unavailable",
  LocalFolderSynchronized = "local-folder-synchronized",
  RemoteOutboxFlushed = "remote-outbox-flushed",
}

export type EventOutboxFlushOutcome =
  | { readonly kind: EventOutboxFlushKind.Unavailable }
  | {
      readonly kind: EventOutboxFlushKind.LocalFolderSynchronized;
      readonly outcome: ProviderSyncOutcome;
    }
  | {
      readonly kind: EventOutboxFlushKind.RemoteOutboxFlushed;
      readonly requestKind: EventOutboxRequest["kind"];
    };

export type LocalSaveFanOutOutcome = {
  readonly publishedEventRecordCount: number;
  readonly outboxFlushes: readonly EventOutboxFlushOutcome[];
};

export enum VaultSyncApplicationKind {
  AuthenticatedRosterApplied = "authenticated-roster-applied",
  AutoConnectScheduled = "auto-connect-scheduled",
  AutoConnectNotRequired = "auto-connect-not-required",
  JoinApprovalMarkedPending = "join-approval-marked-pending",
  UnauthenticatedUpdateIgnored = "unauthenticated-update-ignored",
}

export type VaultSyncApplicationOutcome = {
  readonly kind: VaultSyncApplicationKind;
};

export type ExtensionEventLogPublicationSnapshot = {
  readonly vaultStoreId: string;
  readonly publishedRecordCount: number;
};

export type VaultArchitectureRefreshSnapshot = {
  readonly deviceMode: VaultArchitecture["device_mode"];
  readonly vaultType: VaultArchitecture["vault_type"];
  readonly replicationType: VaultArchitecture["replication_type"];
};

type ProviderStateFields = Pick<
  VaultProviderState,
  | "activeVault"
  | "addProviderOpen"
  | "clearExistingVaultRecoverySummary"
  | "clearLocalFolder"
  | "clearLoginSetup"
  | "clearOauthFile"
  | "clearOauthSetupPreset"
  | "activateLoginSetup"
  | "recoveryDiscovery"
  | "recordExistingVaultRecovery"
  | "githubPat"
  | "githubRepo"
  | "hasActiveVaultStore"
  | "icloudOAuthBusy"
  | "icloudOAuthPreparing"
  | "icloudOAuthReady"
  | "localFolderDraft"
  | "configureLocalFolder"
  | "localFolderBackupSupported"
  | "localVaultCatalog"
  | "localVaults"
  | "localVaultPresent"
  | "loginRequiresExistingVault"
  | "loginSetup"
  | "oauthFileDraft"
  | "configureOauthFile"
  | "oauthSetupSelection"
  | "selectOauthSetupPreset"
  | "openActiveVault"
  | "providers"
  | "providersLoaded"
  | "hasSelectedLoginVaultStore"
  | "selectedLoginVault"
  | "selectLoginVault"
  | "storageMode"
>;

type ProviderRuntimeFields = Pick<
  VaultRuntimeState,
  "clientPolicy" | "errorMsg" | "isVerifying"
>;

type ProviderSessionFields = Pick<
  VaultSessionState,
  | "isAuthenticated"
  | "joinEnrollmentPrompt"
  | "hasManager"
  | "admitManager"
  | "remoteVaultRecoveryState"
>;

interface SharedStorageActionsContext {
  enqueueStorage<T, E = VaultStorageFailure>(
    operation: () => Result<T, E> | Promise<Result<T, E>>,
  ): Promise<Result<T, E | VaultStorageFailure>>;
  t(request: TranslationRequest): string;
}

type ProviderPersistenceOptions = {
  readonly replace: boolean;
  readonly providers?: StorageProvider[];
};

export type ProviderSyncRequest = {
  readonly providerId: string;
  readonly visibility: ProviderSyncVisibility;
  readonly failureHandling: ProviderSyncFailureHandling;
};

interface ProviderActionPorts extends SharedStorageActionsContext {
  readonly activeVaultProviders: StorageProvider[];
  readonly localProvider: LocalProviderLookup;
  readonly syncProviders: StorageProvider[];
  applyActiveProviderCredentials(): void;
  assessVaultConnectStatus(
    argsOverride?: NookStorageConnectArgs,
  ): Promise<Result<VaultAccessStatus, VaultStorageFailure>>;
  clearUnlockedSession(resetManager?: boolean): void;
  connectAndSyncStagedProvider(): Promise<void>;
  dismissSuccess(): void;
  ensureProviderSaved(): Promise<
    Result<ProviderSaveOutcome, VaultStorageFailure>
  >;
  flushRemoteEventOutboxNow(
    request: EventOutboxRequest,
  ): Promise<Result<EventOutboxFlushOutcome, VaultStorageFailure>>;
  handleRemoteVaultAssessStatus(
    accessStatus: VaultAccessStatus,
  ): Promise<boolean>;
  loadDb(): Promise<void>;
  persistProviders(
    options: ProviderPersistenceOptions,
  ): Promise<Result<ProviderPersistenceOutcome, VaultStorageFailure>>;
  resetVaultSessionState(resetManager?: boolean): void;
  refreshPasswordEntriesList(): Promise<
    Result<PasswordEntriesRefreshSnapshot, OAuthFailure | VaultStorageFailure>
  >;
  showSuccess(message: string): void;
  stageStagedProviderSyncIssue(
    args: NookStorageConnectArgs,
  ): Promise<Result<StagedProviderConflictOutcome, VaultStorageFailure>>;
  stagedRemoteStorageArgs(): StagedRemoteStorage;
  syncProviderById(
    request: ProviderSyncRequest,
  ): Promise<Result<ProviderSyncOutcome, VaultStorageFailure | OAuthFailure>>;
  wasmStorageArgs(): NookStorageConnectArgs;
}

export type ProviderActionsContext = ProviderStateFields &
  ProviderRuntimeFields &
  ProviderSessionFields &
  ProviderActionPorts &
  Pick<VaultSyncState, "localFolderHealth">;

export type ActiveProviderCredentialsContext = Pick<
  ProviderActionsContext,
  | "clearLocalFolder"
  | "clearOauthFile"
  | "configureLocalFolder"
  | "configureOauthFile"
  | "githubPat"
  | "githubRepo"
  | "localFolderDraft"
  | "localVaultPresent"
  | "loginSetup"
  | "oauthFileDraft"
  | "storageMode"
  | "syncProviders"
>;

export type ProviderSaveContext = Pick<
  ProviderActionsContext,
  | "activeVault"
  | "addProviderOpen"
  | "applyActiveProviderCredentials"
  | "clearLoginSetup"
  | "configureOauthFile"
  | "enqueueStorage"
  | "errorMsg"
  | "githubPat"
  | "githubRepo"
  | "hasActiveVaultStore"
  | "hasManager"
  | "isAuthenticated"
  | "localFolderDraft"
  | "loginRequiresExistingVault"
  | "loginSetup"
  | "oauthFileDraft"
  | "oauthSetupSelection"
  | "persistProviders"
  | "providers"
  | "admitManager"
  | "selectedLoginVault"
  | "storageMode"
  | "t"
>;

type SyncProviderFields = Pick<
  VaultProviderState,
  | "activeVault"
  | "addProviderOpen"
  | "clearIdentityProviderSession"
  | "clearLoginSetup"
  | "activateLoginSetup"
  | "clearSelectedLoginVaultStore"
  | "localVaultPresent"
  | "localVaults"
  | "loginSetup"
  | "providers"
  | "openActiveVault"
  | "selectLoginVault"
>;

type SyncRuntimeFields = Pick<
  VaultRuntimeState,
  "clientPolicy" | "errorMsg" | "isSaving" | "isVerifying"
>;

type SyncSessionFields = Pick<
  VaultSessionState,
  | "awaitingJoinApproval"
  | "deviceId"
  | "deviceProtectionLockedStatus"
  | "deviceProtectionStatus"
  | "devicePublicKey"
  | "isAuthenticated"
  | "sessionEpoch"
  | "isPasswordBusy"
  | "joinEnrollmentPrompt"
  | "loginPasswordPrompt"
  | "loginDeviceKeysCapable"
  | "hasManager"
  | "admitManager"
  | "passwordEntries"
  | "pendingJoins"
  | "remoteVaultRecoveryState"
  | "sessionExpiredByIdle"
  | "vaultMembers"
>;

type SyncScheduleRequest = {
  readonly callback: () => void;
  readonly intervalMs: number;
};

type SyncStateFields = Pick<
  VaultSyncState,
  | "beginManualProviderSync"
  | "clearLocalFolderMultipleVaultsIssue"
  | "clearSyncingProvider"
  | "isFanOutSyncing"
  | "isSyncing"
  | "localFolderHealth"
  | "manualProviderSync"
  | "markSynced"
  | "clearProjectionConflicts"
  | "replacementConflicts"
  | "replaceProjectionConflicts"
  | "reportLocalFolderMultipleVaults"
  | "securityConflicts"
  | "syncConflictReview"
> & {
  fanOutSyncChain: Promise<void>;
  isSyncScheduled(): boolean;
  scheduleSync(request: SyncScheduleRequest): void;
};

type SyncProviderPersistenceOptions = ProviderPersistenceOptions;

type StorageTimeoutRace<T, E> = {
  readonly promise: Promise<Result<T, E>>;
  readonly releaseLateValue: (value: T) => void;
};

export type SyncFromProvidersRequest = {
  readonly visibility: ProviderSyncVisibility;
  readonly freshness: ProviderSyncFreshness;
};

type ProviderSyncMetadataRequest = {
  readonly providerId: string;
  readonly yaml: string;
  readonly revision: NookProviderSyncRevision;
};

interface SyncActionPorts extends SharedStorageActionsContext {
  readonly deviceProtectionReady: boolean;
  readonly runtimeConfig: NookRuntimeConfig;
  readonly syncBlocked: boolean;
  readonly syncProviders: StorageProvider[];
  applyVaultSyncResult(
    result: NookVaultSyncResult,
  ): Result<VaultSyncApplicationOutcome, VaultStorageFailure>;
  clearPendingSyncConflict(): void;
  clearLocalFolderMultipleVaultsIssue(): void;
  clearSyncingProvider(): void;
  stopScheduledSync(): boolean;
  clearUnlockedSession(resetManager?: boolean): void;
  beginAddProvider(): void;
  beginProviderSetup(request: ProviderSetupRequest): void;
  openAdmin(accordion: AdminAccordionSection): void;
  ensureOAuthTokensFresh(): Promise<
    Result<OAuthTokenFreshnessOutcome, OAuthFailure | VaultStorageFailure>
  >;
  ensureProviderSavedAfterConflict(
    conflict: NookSyncConflictReview,
  ): Promise<Result<string, VaultStorageFailure>>;
  finishStagedProviderConnectAfterConflict(
    conflict: NookSyncConflictReview,
  ): void;
  hasRemoteCredentials(): boolean;
  hydrateMultiDeviceState(): Promise<
    Result<RosterHydrationOutcome, OAuthFailure | VaultStorageFailure>
  >;
  initDeviceIdentity(): Promise<
    Result<DeviceIdentityInitializationSnapshot, VaultStorageFailure>
  >;
  loadDb(): Promise<void>;
  persistProviders(
    options: SyncProviderPersistenceOptions,
  ): Promise<Result<ProviderPersistenceOutcome, VaultStorageFailure>>;
  providerWasmArgs(provider: StorageProvider): NookStorageConnectArgs;
  raceStorageTimeout<T, E = VaultStorageFailure>(
    request: StorageTimeoutRace<T, E>,
  ): Promise<Result<T, E | VaultStorageFailure>>;
  assessVaultConnectStatus(
    args?: NookStorageConnectArgs,
  ): Promise<Result<VaultAccessStatus, VaultStorageFailure>>;
  refreshLocalVaultCatalog(): Promise<
    Result<LocalVaultCatalog, VaultStorageFailure>
  >;
  refreshPasswordEntriesList(): Promise<
    Result<PasswordEntriesRefreshSnapshot, OAuthFailure | VaultStorageFailure>
  >;
  refreshReplacementConflicts(): Promise<
    Result<ProjectionConflictRefreshSnapshot, VaultStorageFailure>
  >;
  refreshSecretsFromSession(): Promise<
    Result<SecretPageRefreshSnapshot, VaultStorageFailure>
  >;
  runFanOutSyncAfterLocalSave(): Promise<
    Result<LocalSaveFanOutOutcome, VaultStorageFailure>
  >;
  runFanOutSyncToProviders(
    visibility: ProviderSyncVisibility,
  ): Promise<VaultSynchronizationResult>;
  flushRemoteEventOutboxNow(
    request: EventOutboxRequest,
  ): Promise<Result<EventOutboxFlushOutcome, VaultStorageFailure>>;
  removeProvider(
    providerId: string,
  ): Promise<Result<ProviderRemovalOutcome, VaultStorageFailure>>;
  ensureProviderSaved(): Promise<
    Result<ProviderSaveOutcome, VaultStorageFailure>
  >;
  showSuccess(message: string): void;
  stagedProviderLabel(): string;
  stagedRemoteStorageArgs(): StagedRemoteStorage;
  stageSyncConflict(conflict: NookPendingSyncConflict): void;
  stopVaultSync(): void;
  syncActiveVaultStoreIdToAuth(): Promise<
    Result<ActiveVaultAuthSyncOutcome, VaultStorageFailure>
  >;
  syncFromStorage(
    freshness: ProviderSyncFreshness,
  ): Promise<VaultSynchronizationResult>;
  syncFromSyncProviders(
    request: SyncFromProvidersRequest,
  ): Promise<VaultSynchronizationResult>;
  syncProviderById(
    request: ProviderSyncRequest,
  ): Promise<Result<ProviderSyncOutcome, VaultStorageFailure | OAuthFailure>>;
  updateProviderSyncMetadata(
    request: ProviderSyncMetadataRequest,
  ): Promise<Result<ProviderSyncMetadataUpdateOutcome, VaultStorageFailure>>;
  wasmStorageArgs(): NookStorageConnectArgs;
}

export type SyncActionsContext = SyncProviderFields &
  SyncRuntimeFields &
  SyncSessionFields &
  SyncStateFields &
  SyncActionPorts;

export type ArchitectureActionsContext = Pick<
  VaultProviderState,
  | "draftDeviceMode"
  | "draftReplicationType"
  | "draftVaultType"
  | "vaultArchitecture"
> &
  Pick<VaultSessionState, "hasManager" | "admitManager"> & {
    errorMsg: string;
    t(request: TranslationRequest): string;
    architectureSecretCreationAllowed: boolean;
    enqueueStorage<T, E = VaultStorageFailure>(
      operation: () => Result<T, E> | Promise<Result<T, E>>,
    ): Promise<Result<T, E | VaultStorageFailure>>;
    replaceVaultArchitecture(architecture: VaultArchitecture): void;
  };

export type SessionActionsContext = Pick<VaultRuntimeState, "errorMsg"> &
  Pick<VaultUiState, "settingsOpen"> &
  Pick<VaultProviderState, "localLoginPreparation" | "vaultArchitecture"> &
  Pick<
    VaultSessionState,
    | "externalIdentityHandoff"
    | "awaitingJoinApproval"
    | "clearSelectedPasswordEntry"
    | "enrollmentCode"
    | "enrollMembersKey"
    | "enrollSecretsKey"
    | "isAuthenticated"
    | "joinEnrollmentPrompt"
    | "loginPasswordPrompt"
    | "loginDeviceKeysCapable"
    | "hasManager"
    | "admitManager"
    | "passwordEntries"
    | "pendingJoins"
    | "selectedPasswordEntry"
    | "selectPasswordEntry"
    | "sessionExpiredByIdle"
    | "sessionEpoch"
    | "sharedGrantInstructions"
    | "sharedJoinerIdentity"
    | "vaultMembers"
  > &
  Pick<
    VaultSecretsState,
    | "secretPageOffset"
    | "clearSecretTypeFilter"
    | "secretQuery"
    | "secretTotal"
    | "secretTypeFilter"
    | "secrets"
  > &
  Pick<
    VaultSentinelState,
    | "sentinelCeremonyPrompt"
    | "clearSentinelGenesisStore"
    | "sentinelGenesisDeliveries"
    | "sentinelGenesisParticipantCount"
    | "sentinelGenesisParticipants"
    | "sentinelGenesisPhase"
    | "sentinelGenesisRequest"
    | "sentinelGenesisTarget"
    | "selectSentinelGenesisStore"
    | "sentinelStoredDeliveries"
    | "sentinelUnlockRequest"
    | "sentinelUnlockSession"
    | "sentinelUnlockStatus"
  > &
  Pick<VaultSyncState, "clearProjectionConflicts"> & {
    secretPageGeneration: number;
    secretPageRequestOffset: number;
    enqueueStorage<T, E = VaultStorageFailure>(
      operation: () => Result<T, E> | Promise<Result<T, E>>,
    ): Promise<Result<T, E | VaultStorageFailure>>;
    publishExtensionEventLogUpdate(): Promise<
      Result<ExtensionEventLogPublicationSnapshot, VaultStorageFailure>
    >;
    refreshVaultArchitectureFromManager(): Result<
      VaultArchitectureRefreshSnapshot,
      VaultStorageFailure
    >;
    resetVaultSessionState(resetManager?: boolean): void;
    stopIdleSessionTracking(): void;
    stopVaultSync(): void;
  };

export type UiActionsContext = Pick<
  VaultRuntimeState,
  "errorMsg" | "isSaving"
> &
  Pick<VaultSessionState, "hasManager" | "admitManager"> &
  Pick<
    VaultUiState,
    | "adminAccordionSection"
    | "helpOpen"
    | "settingsAccordionSection"
    | "settingsOpen"
    | "settingsSection"
  > & {
    localDataDeletionStarted: boolean;
    cancelAddProvider(): void;
    cancelProviderSetup(): void;
    clearUnlockedSession(resetManager?: boolean): void;
    dismissSuccess(): void;
    enqueueStorage<T, E = VaultStorageFailure>(
      operation: () => Result<T, E> | Promise<Result<T, E>>,
    ): Promise<Result<T, E | VaultStorageFailure>>;
    refreshDeviceState(): Promise<VaultSynchronizationResult>;
    refreshLocalVaultCatalog(): Promise<
      Result<LocalVaultCatalog, VaultStorageFailure>
    >;
    stopIdleSessionTracking(): void;
    stopVaultSync(): void;
    t(request: TranslationRequest): string;
    waitForStorageChain(): Promise<void>;
  };

export type SettingsNavigationRequest = {
  readonly section: SettingsSection;
  readonly accordion: SettingsAccordionSection;
};

export type OpenAdminAccordion = AdminAccordionSection;
