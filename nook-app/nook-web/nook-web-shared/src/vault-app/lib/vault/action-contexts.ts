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
  | "requireExistingVaultRecovery"
  | "githubPat"
  | "githubRepo"
  | "hasActiveVaultStore"
  | "icloudOAuthBusy"
  | "icloudOAuthPreparing"
  | "icloudOAuthReady"
  | "localFolderDraft"
  | "configureLocalFolder"
  | "requireLocalFolderConfig"
  | "localFolderBackupSupported"
  | "localVaultCatalog"
  | "localVaults"
  | "localVaultPresent"
  | "loginRequiresExistingVault"
  | "loginSetup"
  | "oauthFileDraft"
  | "configureOauthFile"
  | "requireOauthFileConfig"
  | "oauthSetupSelection"
  | "selectOauthSetupPreset"
  | "openActiveVault"
  | "providers"
  | "providersLoaded"
  | "requireActiveVaultStoreId"
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
  | "requireManager"
  | "remoteVaultRecoveryState"
>;

interface SharedStorageActionsContext {
  enqueueStorage<T>(operation: () => T | Promise<T>): Promise<T>;
  t(request: TranslationRequest): string;
}

type ProviderPersistenceOptions = { readonly replace: boolean };
export type VaultStorageArguments = [
  mode: string,
  credential: string,
  repository: string,
];

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
    argsOverride?: VaultStorageArguments,
  ): Promise<VaultAccessStatus>;
  clearUnlockedSession(resetManager?: boolean): void;
  connectAndSyncStagedProvider(): Promise<void>;
  dismissSuccess(): void;
  ensureProviderSaved(): Promise<boolean>;
  flushRemoteEventOutboxNow(request: EventOutboxRequest): Promise<void>;
  handleRemoteVaultAssessStatus(
    accessStatus: VaultAccessStatus,
  ): Promise<boolean>;
  loadDb(): Promise<void>;
  persistProviders(options: ProviderPersistenceOptions): Promise<void>;
  resetVaultSessionState(resetManager?: boolean): void;
  refreshPasswordEntriesList(): Promise<boolean>;
  showSuccess(message: string): void;
  stageStagedProviderSyncIssue(args: VaultStorageArguments): Promise<boolean>;
  stagedRemoteStorageArgs(): StagedRemoteStorage;
  syncProviderById(request: ProviderSyncRequest): Promise<void>;
  wasmStorageArgs(): [string, string, string];
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
  | "requireActiveVaultStoreId"
  | "requireManager"
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
  | "isPasswordBusy"
  | "joinEnrollmentPrompt"
  | "loginPasswordPrompt"
  | "loginDeviceKeysCapable"
  | "hasManager"
  | "requireManager"
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

type SyncProviderPersistenceOptions = { readonly replace: boolean };

type StorageTimeoutRace<T> = {
  readonly promise: Promise<T>;
  readonly label: string;
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
  applyVaultSyncResult(result: NookVaultSyncResult): void;
  clearPendingSyncConflict(): void;
  clearLocalFolderMultipleVaultsIssue(): void;
  clearSyncingProvider(): void;
  stopScheduledSync(): boolean;
  clearUnlockedSession(resetManager?: boolean): void;
  beginAddProvider(): void;
  beginProviderSetup(request: ProviderSetupRequest): void;
  openAdmin(accordion: AdminAccordionSection): void;
  ensureOAuthTokensFresh(): Promise<void>;
  ensureProviderSavedAfterConflict(
    conflict: NookSyncConflictReview,
  ): Promise<string>;
  finishStagedProviderConnectAfterConflict(
    conflict: NookSyncConflictReview,
  ): void;
  hasRemoteCredentials(): boolean;
  hydrateMultiDeviceState(): Promise<void>;
  initDeviceIdentity(): Promise<void>;
  loadDb(): Promise<void>;
  persistProviders(options: SyncProviderPersistenceOptions): Promise<void>;
  providerWasmArgs(provider: StorageProvider): [string, string, string];
  raceStorageTimeout<T>(request: StorageTimeoutRace<T>): Promise<T>;
  assessVaultConnectStatus(
    args?: VaultStorageArguments,
  ): Promise<VaultAccessStatus>;
  refreshLocalVaultCatalog(): Promise<void>;
  refreshPasswordEntriesList(): Promise<boolean>;
  refreshReplacementConflicts(): Promise<void>;
  refreshSecretsFromSession(): Promise<void>;
  runFanOutSyncAfterLocalSave(): Promise<void>;
  runFanOutSyncToProviders(visibility: ProviderSyncVisibility): Promise<void>;
  flushRemoteEventOutboxNow(request: EventOutboxRequest): Promise<void>;
  removeProvider(providerId: string): Promise<void>;
  ensureProviderSaved(): Promise<boolean>;
  showSuccess(message: string): void;
  stagedProviderLabel(): string;
  stagedRemoteStorageArgs(): StagedRemoteStorage;
  stageSyncConflict(conflict: NookPendingSyncConflict): void;
  stopVaultSync(): void;
  syncActiveVaultStoreIdToAuth(): Promise<void>;
  syncFromStorage(freshness: ProviderSyncFreshness): Promise<void>;
  syncFromSyncProviders(request: SyncFromProvidersRequest): Promise<void>;
  syncProviderById(request: ProviderSyncRequest): Promise<void>;
  updateProviderSyncMetadata(
    request: ProviderSyncMetadataRequest,
  ): Promise<void>;
  wasmStorageArgs(): [string, string, string];
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
  Pick<VaultSessionState, "hasManager" | "requireManager"> & {
    architectureSecretCreationAllowed: boolean;
    enqueueStorage<T>(operation: () => T | Promise<T>): Promise<T>;
    replaceVaultArchitecture(architecture: VaultArchitecture): void;
  };

export type SessionActionsContext = Pick<VaultRuntimeState, "errorMsg"> &
  Pick<VaultUiState, "settingsOpen"> &
  Pick<VaultProviderState, "localLoginPreparation" | "vaultArchitecture"> &
  Pick<
    VaultSessionState,
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
    | "requireManager"
    | "passwordEntries"
    | "pendingJoins"
    | "selectedPasswordEntry"
    | "selectPasswordEntry"
    | "sessionExpiredByIdle"
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
    enqueueStorage<T>(operation: () => T | Promise<T>): Promise<T>;
    publishExtensionEventLogUpdate(): Promise<void>;
    refreshVaultArchitectureFromManager(): void;
    resetVaultSessionState(resetManager?: boolean): void;
    stopIdleSessionTracking(): void;
    stopVaultSync(): void;
  };

export type UiActionsContext = Pick<
  VaultRuntimeState,
  "errorMsg" | "isSaving"
> &
  Pick<VaultSessionState, "hasManager" | "requireManager"> &
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
    enqueueStorage<T>(operation: () => T | Promise<T>): Promise<T>;
    refreshDeviceState(): Promise<void>;
    refreshLocalVaultCatalog(): Promise<void>;
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
