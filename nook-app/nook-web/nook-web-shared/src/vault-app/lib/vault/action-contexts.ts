import type {
  NookPendingSyncConflict,
  NookProviderSyncRevision,
  NookRuntimeConfig,
} from "$app-wasm";
import type { NookVaultSyncResult, VaultAccessStatus } from "$lib/nook";
import type { StorageProvider } from "$lib/auth-providers";
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
import type { VaultArchitecture } from "$lib/vault-architecture";
import type {
  AdminAccordionSection,
  SettingsAccordionSection,
  SettingsSection,
} from "$lib/vault/state/ui.svelte";

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
  t(key: string, values?: Record<string, string>): string;
}

interface ProviderActionPorts extends SharedStorageActionsContext {
  readonly activeVaultProviders: StorageProvider[];
  readonly localProvider: LocalProviderLookup;
  readonly syncProviders: StorageProvider[];
  applyActiveProviderCredentials(): void;
  assessVaultConnectStatus(
    argsOverride?: [string, string, string],
  ): Promise<VaultAccessStatus>;
  clearUnlockedSession(resetManager?: boolean): void;
  connectAndSyncStagedProvider(): Promise<void>;
  dismissSuccess(): void;
  ensureProviderSaved(): Promise<boolean>;
  flushRemoteEventOutboxNow(provider?: StorageProvider): Promise<void>;
  handleRemoteVaultAssessStatus(
    accessStatus: VaultAccessStatus,
  ): Promise<boolean>;
  loadDb(): Promise<unknown>;
  persistProviders(options?: { replace?: boolean }): Promise<void>;
  resetVaultSessionState(resetManager?: boolean): void;
  refreshPasswordEntriesList(): Promise<boolean>;
  showSuccess(message: string): void;
  stageStagedProviderSyncIssue(
    args: [string, string, string],
  ): Promise<boolean>;
  stagedRemoteStorageArgs(): StagedRemoteStorage;
  syncProviderById(
    providerId: string,
    options?: { quiet?: boolean; propagateError?: boolean },
  ): Promise<void>;
  wasmStorageArgs(): [string, string, string];
}

export type ProviderActionsContext = ProviderStateFields &
  ProviderRuntimeFields &
  ProviderSessionFields &
  ProviderActionPorts &
  Pick<VaultSyncState, "localFolderHealth">;

type SyncProviderFields = Pick<
  VaultProviderState,
  | "activeVault"
  | "addProviderOpen"
  | "clearLoginSetup"
  | "activateLoginSetup"
  | "localVaultPresent"
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
  | "isAuthenticated"
  | "isPasswordBusy"
  | "joinEnrollmentPrompt"
  | "loginPasswordPrompt"
  | "hasManager"
  | "requireManager"
  | "pendingJoins"
  | "remoteVaultRecoveryState"
  | "sessionExpiredByIdle"
  | "vaultMembers"
>;

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
  | "replacementConflicts"
  | "reportLocalFolderMultipleVaults"
  | "securityConflicts"
  | "syncConflictReview"
> & {
  fanOutSyncChain: Promise<void>;
  isSyncScheduled(): boolean;
  scheduleSync(callback: () => void, intervalMs: number): void;
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
  beginProviderSetup(type: "local-folder"): void;
  ensureOAuthTokensFresh(): Promise<void>;
  ensureProviderSavedAfterConflict(
    conflict: NookPendingSyncConflict,
  ): Promise<string>;
  finishStagedProviderConnectAfterConflict(
    conflict: NookPendingSyncConflict,
  ): void;
  hasRemoteCredentials(): boolean;
  hydrateMultiDeviceState(): Promise<void>;
  initDeviceIdentity(options?: {
    allowPendingAuthorization?: boolean;
  }): Promise<void>;
  loadDb(): Promise<unknown>;
  persistProviders(options?: { replace?: boolean }): Promise<void>;
  providerWasmArgs(provider: StorageProvider): [string, string, string];
  raceStorageTimeout<T>(promise: Promise<T>, label: string): Promise<T>;
  refreshLocalVaultCatalog(): Promise<void>;
  refreshPasswordEntriesList(): Promise<boolean>;
  refreshReplacementConflicts(): Promise<void>;
  refreshSecretsFromSession(): Promise<void>;
  runFanOutSyncAfterLocalSave(): Promise<void>;
  runFanOutSyncToProviders(options?: { quiet?: boolean }): Promise<void>;
  flushRemoteEventOutboxNow(provider?: StorageProvider): Promise<void>;
  removeProvider(providerId: string): Promise<void>;
  ensureProviderSaved(): Promise<boolean>;
  showSuccess(message: string): void;
  stagedProviderLabel(): string;
  stagedRemoteStorageArgs(): StagedRemoteStorage;
  stageSyncConflict(conflict: NookPendingSyncConflict): void;
  stopVaultSync(): void;
  syncActiveVaultStoreIdToAuth(): Promise<void>;
  syncFromStorage(options?: { force?: boolean }): Promise<void>;
  syncFromSyncProviders(options?: {
    quiet?: boolean;
    force?: boolean;
  }): Promise<void>;
  syncProviderById(
    providerId: string,
    options?: { quiet?: boolean; propagateError?: boolean },
  ): Promise<void>;
  updateProviderSyncMetadata(
    providerId: string,
    yaml: string,
    revision: NookProviderSyncRevision,
  ): Promise<void>;
  wasmStorageArgs(): [string, string, string];
}

export type SyncActionsContext = SyncProviderFields &
  SyncRuntimeFields &
  SyncSessionFields &
  SyncStateFields &
  SyncActionPorts &
  Pick<
    VaultUiState,
    "adminAccordionSection" | "settingsOpen" | "settingsSection"
  >;

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
  > & {
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
    refreshDeviceState(): Promise<unknown>;
    refreshLocalVaultCatalog(): Promise<void>;
    stopIdleSessionTracking(): void;
    stopVaultSync(): void;
    t(key: string, values?: Record<string, string>): string;
    waitForStorageChain(): Promise<void>;
  };

export type OpenSettingsArgs = {
  section?: SettingsSection;
  accordion?: SettingsAccordionSection;
};

export type OpenAdminAccordion = AdminAccordionSection;
