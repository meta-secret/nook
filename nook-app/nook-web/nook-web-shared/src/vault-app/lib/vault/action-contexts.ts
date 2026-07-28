import type { SvelteDate } from "svelte/reactivity";
import type { NookPendingSyncConflict, NookRuntimeConfig } from "$app-wasm";
import type { NookVaultSyncResult, VaultAccessStatus } from "$lib/nook";
import type { StorageProvider } from "$lib/auth-providers";
import type { VaultProviderState } from "$lib/vault/state/provider.svelte";
import type { VaultRuntimeState } from "$lib/vault/state/runtime.svelte";
import type { VaultSessionState } from "$lib/vault/state/session.svelte";

type ProviderStateFields = Pick<
  VaultProviderState,
  | "activeVaultStoreId"
  | "addProviderOpen"
  | "existingVaultRecoverySummary"
  | "githubPat"
  | "githubRepo"
  | "icloudOAuthBusy"
  | "icloudOAuthPreparing"
  | "icloudOAuthReady"
  | "localFolder"
  | "localVaultPresent"
  | "loginRequiresExistingVault"
  | "loginSetupType"
  | "oauthFile"
  | "oauthSetupPreset"
  | "providers"
  | "providersLoaded"
  | "selectedLoginVaultStoreId"
  | "storageMode"
>;

type ProviderRuntimeFields = Pick<
  VaultRuntimeState,
  "errorMsg" | "isVerifying"
>;

type ProviderSessionFields = Pick<
  VaultSessionState,
  "isAuthenticated" | "manager"
>;

interface SharedStorageActionsContext {
  enqueueStorage<T>(operation: () => T | Promise<T>): Promise<T>;
  t(key: string, values?: Record<string, string>): string;
}

interface ProviderActionPorts extends SharedStorageActionsContext {
  readonly activeVaultProviders: StorageProvider[];
  readonly localProvider: StorageProvider | undefined;
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
  showSuccess(message: string): void;
  stageStagedProviderSyncIssue(
    args: [string, string, string],
  ): Promise<boolean>;
  stagedRemoteStorageArgs(): [string, string, string] | undefined;
  syncProviderById(
    providerId: string,
    options?: { quiet?: boolean; propagateError?: boolean },
  ): Promise<void>;
  wasmStorageArgs(): [string, string, string];
}

export type ProviderActionsContext = ProviderStateFields &
  ProviderRuntimeFields &
  ProviderSessionFields &
  ProviderActionPorts & {
    localFolderMultipleVaultsIssue:
      | {
          message: string;
        }
      | undefined;
  };

type SyncProviderFields = Pick<
  VaultProviderState,
  | "activeVaultStoreId"
  | "localVaultPresent"
  | "loginSetupType"
  | "providers"
  | "selectedLoginVaultStoreId"
>;

type SyncRuntimeFields = Pick<
  VaultRuntimeState,
  "errorMsg" | "isSaving" | "isVerifying"
>;

type SyncSessionFields = Pick<
  VaultSessionState,
  | "awaitingJoinApproval"
  | "isAuthenticated"
  | "isPasswordBusy"
  | "joinEnrollmentPrompt"
  | "manager"
  | "pendingJoins"
  | "remoteVaultRecoveryState"
  | "vaultMembers"
>;

interface SyncStateFields {
  fanOutSyncChain: Promise<void>;
  isSyncing: boolean;
  lastSyncedAt: SvelteDate | undefined;
  localFolderMultipleVaultsIssue:
    | {
        providerId: string;
        providerLabel: string;
        storeIds: string[];
        message: string;
      }
    | undefined;
  pendingSyncConflict: NookPendingSyncConflict | undefined;
  replacementConflicts: Array<{
    oldSecretId: string;
    candidates: Array<{ eventId: string; secretId: string }>;
  }>;
  securityConflicts: Array<{ events: string[]; reasons: string[] }>;
  syncingProviderId: string | undefined;
  syncTimer: ReturnType<typeof setInterval> | undefined;
}

interface SyncActionPorts extends SharedStorageActionsContext {
  readonly deviceProtectionReady: boolean;
  readonly runtimeConfig: NookRuntimeConfig;
  readonly syncBlocked: boolean;
  readonly syncProviders: StorageProvider[];
  applyVaultSyncResult(result: NookVaultSyncResult): void;
  clearPendingSyncConflict(): void;
  clearUnlockedSession(resetManager?: boolean): void;
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
  runFanOutSyncToProviders(options?: { quiet?: boolean }): Promise<void>;
  showSuccess(message: string): void;
  stagedProviderLabel(): string;
  stagedRemoteStorageArgs(): [string, string, string] | undefined;
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
    revision: string | undefined,
  ): Promise<void>;
  wasmStorageArgs(): [string, string, string];
}

export type SyncActionsContext = SyncProviderFields &
  SyncRuntimeFields &
  SyncSessionFields &
  SyncStateFields &
  SyncActionPorts;
