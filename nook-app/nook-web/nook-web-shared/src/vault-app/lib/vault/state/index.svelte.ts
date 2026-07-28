import { VaultProviderState } from "./provider.svelte";
import { VaultRuntimeState } from "./runtime.svelte";
import { VaultSecretsState } from "./secrets.svelte";
import { VaultSentinelState } from "./sentinel.svelte";
import { VaultSessionState } from "./session.svelte";
import { VaultSyncState } from "./sync.svelte";
import { VaultUiState } from "./ui.svelte";

function delegateState(
  target: object,
  state: object,
  keys: readonly PropertyKey[],
): void {
  for (const key of keys) {
    Object.defineProperty(target, key, {
      enumerable: true,
      get: () => Reflect.get(state, key),
      set: (value: unknown) => Reflect.set(state, key, value),
    });
  }
}

const runtimeKeys = [
  "browserLocale",
  "clientPolicy",
  "runtimeConfig",
  "locale",
  "translations",
  "errorMsg",
  "successMsg",
  "isVerifying",
  "isSaving",
  "isInitializing",
] as const satisfies readonly (keyof VaultRuntimeState)[];

const uiKeys = [
  "settingsOpen",
  "settingsSection",
  "settingsAccordionSection",
  "adminAccordionSection",
  "helpOpen",
] as const satisfies readonly (keyof VaultUiState)[];

const providerKeys = [
  "providers",
  "providersLoaded",
  "localVaults",
  "activeVaultStoreId",
  "selectedLoginVaultStoreId",
  "localVaultPresent",
  "localLoginPrepared",
  "loginSetupType",
  "loginRequiresExistingVault",
  "existingVaultRecoverySummary",
  "addProviderOpen",
  "storageMode",
  "githubPat",
  "githubRepo",
  "oauthFile",
  "localFolder",
  "localFolderBackupSupported",
  "vaultArchitecture",
  "draftDeviceMode",
  "draftVaultType",
  "draftReplicationType",
  "oauthSetupPreset",
  "googleOAuthBusy",
  "icloudOAuthPreparing",
  "icloudOAuthReady",
  "icloudOAuthBusy",
] as const satisfies readonly (keyof VaultProviderState)[];

const sessionKeys = [
  "manager",
  "deviceProtectionStatus",
  "deviceProtectionLockedStatus",
  "isAuthenticated",
  "sessionExpiredByIdle",
  "deviceId",
  "devicePublicKey",
  "pendingJoins",
  "vaultMembers",
  "enrollSecretsKey",
  "enrollMembersKey",
  "sharedJoinerIdentity",
  "sharedGrantInstructions",
  "joinEnrollmentPrompt",
  "awaitingJoinApproval",
  "loginPasswordPrompt",
  "remoteVaultRecoveryState",
  "isPasswordBusy",
  "passwordError",
  "enrollmentCode",
  "prefillEnrollmentCode",
  "enrollmentFromUrlPending",
  "loginEnrollmentCode",
  "passwordEntries",
  "selectedPasswordEntryId",
  "activeEnrollmentEntryId",
] as const satisfies readonly (keyof VaultSessionState)[];

const secretsKeys = [
  "secrets",
  "secretTotal",
  "secretPageOffset",
  "secretPageSize",
  "secretQuery",
  "secretTypeFilter",
] as const satisfies readonly (keyof VaultSecretsState)[];

const sentinelKeys = [
  "sentinelGenesisPhase",
  "sentinelGenesisRequest",
  "sentinelGenesisParticipantCount",
  "sentinelGenesisParticipants",
  "sentinelGenesisDeliveries",
  "sentinelGenesisStoreId",
  "sentinelCeremonyPrompt",
  "sentinelUnlockStatus",
  "sentinelUnlockRequest",
  "sentinelUnlockSession",
  "sentinelStoredDeliveries",
] as const satisfies readonly (keyof VaultSentinelState)[];

const syncKeys = [
  "lastSyncedAt",
  "isSyncing",
  "syncingProviderId",
  "isFanOutSyncing",
  "replacementConflicts",
  "securityConflicts",
  "pendingSyncConflict",
  "localFolderMultipleVaultsIssue",
] as const satisfies readonly (keyof VaultSyncState)[];

type VaultStateSliceFields = VaultRuntimeState &
  VaultUiState &
  VaultProviderState &
  VaultSessionState &
  VaultSecretsState &
  VaultSentinelState &
  VaultSyncState;

class VaultStateSlicesBase {
  constructor() {
    delegateState(this, new VaultRuntimeState(), runtimeKeys);
    delegateState(this, new VaultUiState(), uiKeys);
    delegateState(this, new VaultProviderState(), providerKeys);
    delegateState(this, new VaultSessionState(), sessionKeys);
    delegateState(this, new VaultSecretsState(), secretsKeys);
    delegateState(this, new VaultSentinelState(), sentinelKeys);
    delegateState(this, new VaultSyncState(), syncKeys);
  }
}

type VaultStateSlicesConstructor = new () => VaultStateSlicesBase &
  VaultStateSliceFields;

export const VaultStateSlices =
  VaultStateSlicesBase as VaultStateSlicesConstructor;
