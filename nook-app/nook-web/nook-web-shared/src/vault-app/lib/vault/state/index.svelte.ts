import { VaultProviderState } from "./provider.svelte";
import { VaultRuntimeState } from "./runtime.svelte";
import { VaultSecretsState } from "./secrets.svelte";
import { VaultSentinelState } from "./sentinel.svelte";
import { VaultSessionState } from "./session.svelte";
import { VaultSyncState } from "./sync.svelte";
import { VaultUiState } from "./ui.svelte";

type VaultStateSlice =
  | VaultRuntimeState
  | VaultUiState
  | VaultProviderState
  | VaultSessionState
  | VaultSecretsState
  | VaultSentinelState
  | VaultSyncState;

type VaultStateDelegation<State extends VaultStateSlice> = {
  readonly target: VaultStateSlicesImplementation;
  readonly state: State;
  readonly keys: readonly (keyof State)[];
};

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
  "devicesAccessIdentityProtectionOpen",
  "devicesAccessIdentityTransitionPending",
  "settingsAccordionSection",
  "adminAccordionSection",
  "helpOpen",
] as const satisfies readonly (keyof VaultUiState)[];

const providerKeys = [
  "providers",
  "providersLoaded",
  "localVaults",
  "localVaultCatalog",
  "activeVault",
  "openActiveVault",
  "hasActiveVaultStore",
  "clearActiveVaultStore",
  "selectedLoginVault",
  "selectLoginVault",
  "hasSelectedLoginVaultStore",
  "clearSelectedLoginVaultStore",
  "localVaultPresent",
  "localLoginPreparation",
  "loginSetup",
  "activateLoginSetup",
  "clearLoginSetup",
  "loginRequiresExistingVault",
  "recoveryDiscovery",
  "recordExistingVaultRecovery",
  "clearExistingVaultRecoverySummary",
  "addProviderOpen",
  "storageMode",
  "githubPat",
  "githubRepo",
  "oauthFileDraft",
  "configureOauthFile",
  "clearOauthFile",
  "localFolderDraft",
  "configureLocalFolder",
  "clearLocalFolder",
  "localFolderBackupSupported",
  "vaultArchitecture",
  "draftDeviceMode",
  "draftVaultType",
  "draftReplicationType",
  "oauthSetupSelection",
  "selectOauthSetupPreset",
  "clearOauthSetupPreset",
  "clearIdentityProviderSession",
  "googleOAuthBusy",
  "icloudOAuthPreparing",
  "icloudOAuthReady",
  "icloudOAuthBusy",
] as const satisfies readonly (keyof VaultProviderState)[];

const sessionKeys = [
  "externalIdentityHandoff",
  "managerSession",
  "hasManager",
  "admitManager",
  "openManager",
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
  "loginDeviceKeysCapable",
  "remoteVaultRecoveryState",
  "isPasswordBusy",
  "passwordError",
  "enrollmentCode",
  "prefillEnrollmentCode",
  "enrollmentFromUrlPending",
  "loginEnrollmentCode",
  "passwordEntries",
  "selectedPasswordEntry",
  "selectPasswordEntry",
  "clearSelectedPasswordEntry",
  "activeEnrollmentEntry",
  "beginEnrollmentEntry",
  "clearActiveEnrollmentEntry",
  "clearManager",
] as const satisfies readonly (keyof VaultSessionState)[];

const secretsKeys = [
  "secrets",
  "secretTotal",
  "secretPageOffset",
  "secretPageSize",
  "secretQuery",
  "secretTypeFilter",
  "clearSecretTypeFilter",
] as const satisfies readonly (keyof VaultSecretsState)[];

const sentinelKeys = [
  "sentinelGenesisPhase",
  "sentinelGenesisRequest",
  "sentinelGenesisParticipantCount",
  "sentinelGenesisParticipants",
  "sentinelGenesisDeliveries",
  "sentinelGenesisTarget",
  "selectSentinelGenesisStore",
  "clearSentinelGenesisStore",
  "sentinelCeremonyPrompt",
  "sentinelUnlockStatus",
  "sentinelUnlockRequest",
  "sentinelUnlockSession",
  "sentinelStoredDeliveries",
] as const satisfies readonly (keyof VaultSentinelState)[];

const syncKeys = [
  "lastSync",
  "markSynced",
  "isSyncing",
  "manualProviderSync",
  "manualProviderSyncRunning",
  "beginManualProviderSync",
  "clearSyncingProvider",
  "isFanOutSyncing",
  "replacementConflicts",
  "securityConflicts",
  "replaceProjectionConflicts",
  "clearProjectionConflicts",
  "stageSecurityConflictForTesting",
  "stageContentSyncConflictForTesting",
  "stageStoreIdSyncConflictForTesting",
  "syncConflictReview",
  "syncConflictRequiresDecision",
  "stageSyncConflict",
  "clearPendingSyncConflict",
  "localFolderHealth",
  "reportLocalFolderMultipleVaults",
  "clearLocalFolderMultipleVaultsIssue",
] as const satisfies readonly (keyof VaultSyncState)[];

type VaultStateSliceFields = VaultRuntimeState &
  VaultUiState &
  VaultProviderState &
  VaultSessionState &
  VaultSecretsState &
  VaultSentinelState &
  VaultSyncState;

type VaultDelegatedValue = VaultStateSliceFields[keyof VaultStateSliceFields];
type VaultDelegatedArguments = never[];
type VaultDelegatedCallable = (
  ...args: VaultDelegatedArguments
) => VaultDelegatedValue;

function isVaultDelegatedCallable<DelegatedStateValue>(
  value: DelegatedStateValue,
): value is DelegatedStateValue & VaultDelegatedCallable {
  return typeof value === "function";
}

class VaultStateSlicesImplementation {
  declare browserLocale: VaultRuntimeState["browserLocale"];
  declare clientPolicy: VaultRuntimeState["clientPolicy"];
  declare runtimeConfig: VaultRuntimeState["runtimeConfig"];
  declare locale: VaultRuntimeState["locale"];
  declare translations: VaultRuntimeState["translations"];
  declare errorMsg: VaultRuntimeState["errorMsg"];
  declare successMsg: VaultRuntimeState["successMsg"];
  declare isVerifying: VaultRuntimeState["isVerifying"];
  declare isSaving: VaultRuntimeState["isSaving"];
  declare isInitializing: VaultRuntimeState["isInitializing"];

  declare settingsOpen: VaultUiState["settingsOpen"];
  declare settingsSection: VaultUiState["settingsSection"];
  declare devicesAccessIdentityProtectionOpen: VaultUiState["devicesAccessIdentityProtectionOpen"];
  declare devicesAccessIdentityTransitionPending: VaultUiState["devicesAccessIdentityTransitionPending"];
  declare settingsAccordionSection: VaultUiState["settingsAccordionSection"];
  declare adminAccordionSection: VaultUiState["adminAccordionSection"];
  declare helpOpen: VaultUiState["helpOpen"];

  declare providers: VaultProviderState["providers"];
  declare providersLoaded: VaultProviderState["providersLoaded"];
  declare localVaults: VaultProviderState["localVaults"];
  declare readonly localVaultCatalog: VaultProviderState["localVaultCatalog"];
  declare readonly activeVault: VaultProviderState["activeVault"];
  declare openActiveVault: VaultProviderState["openActiveVault"];
  declare readonly hasActiveVaultStore: VaultProviderState["hasActiveVaultStore"];
  declare clearActiveVaultStore: VaultProviderState["clearActiveVaultStore"];
  declare readonly selectedLoginVault: VaultProviderState["selectedLoginVault"];
  declare selectLoginVault: VaultProviderState["selectLoginVault"];
  declare readonly hasSelectedLoginVaultStore: VaultProviderState["hasSelectedLoginVaultStore"];
  declare clearSelectedLoginVaultStore: VaultProviderState["clearSelectedLoginVaultStore"];
  declare localVaultPresent: VaultProviderState["localVaultPresent"];
  declare localLoginPreparation: VaultProviderState["localLoginPreparation"];
  declare readonly loginSetup: VaultProviderState["loginSetup"];
  declare activateLoginSetup: VaultProviderState["activateLoginSetup"];
  declare clearLoginSetup: VaultProviderState["clearLoginSetup"];
  declare loginRequiresExistingVault: VaultProviderState["loginRequiresExistingVault"];
  declare readonly recoveryDiscovery: VaultProviderState["recoveryDiscovery"];
  declare recordExistingVaultRecovery: VaultProviderState["recordExistingVaultRecovery"];
  declare clearExistingVaultRecoverySummary: VaultProviderState["clearExistingVaultRecoverySummary"];
  declare addProviderOpen: VaultProviderState["addProviderOpen"];
  declare storageMode: VaultProviderState["storageMode"];
  declare githubPat: VaultProviderState["githubPat"];
  declare githubRepo: VaultProviderState["githubRepo"];
  declare readonly oauthFileDraft: VaultProviderState["oauthFileDraft"];
  declare configureOauthFile: VaultProviderState["configureOauthFile"];
  declare clearOauthFile: VaultProviderState["clearOauthFile"];
  declare readonly localFolderDraft: VaultProviderState["localFolderDraft"];
  declare configureLocalFolder: VaultProviderState["configureLocalFolder"];
  declare clearLocalFolder: VaultProviderState["clearLocalFolder"];
  declare localFolderBackupSupported: VaultProviderState["localFolderBackupSupported"];
  declare vaultArchitecture: VaultProviderState["vaultArchitecture"];
  declare draftDeviceMode: VaultProviderState["draftDeviceMode"];
  declare draftVaultType: VaultProviderState["draftVaultType"];
  declare draftReplicationType: VaultProviderState["draftReplicationType"];
  declare readonly oauthSetupSelection: VaultProviderState["oauthSetupSelection"];
  declare selectOauthSetupPreset: VaultProviderState["selectOauthSetupPreset"];
  declare clearOauthSetupPreset: VaultProviderState["clearOauthSetupPreset"];
  declare clearIdentityProviderSession: VaultProviderState["clearIdentityProviderSession"];
  declare googleOAuthBusy: VaultProviderState["googleOAuthBusy"];
  declare icloudOAuthPreparing: VaultProviderState["icloudOAuthPreparing"];
  declare icloudOAuthReady: VaultProviderState["icloudOAuthReady"];
  declare icloudOAuthBusy: VaultProviderState["icloudOAuthBusy"];

  declare externalIdentityHandoff: VaultSessionState["externalIdentityHandoff"];
  declare readonly managerSession: VaultSessionState["managerSession"];
  declare readonly hasManager: VaultSessionState["hasManager"];
  declare admitManager: VaultSessionState["admitManager"];
  declare openManager: VaultSessionState["openManager"];
  declare deviceProtectionStatus: VaultSessionState["deviceProtectionStatus"];
  declare deviceProtectionLockedStatus: VaultSessionState["deviceProtectionLockedStatus"];
  declare isAuthenticated: VaultSessionState["isAuthenticated"];
  declare sessionExpiredByIdle: VaultSessionState["sessionExpiredByIdle"];
  declare deviceId: VaultSessionState["deviceId"];
  declare devicePublicKey: VaultSessionState["devicePublicKey"];
  declare pendingJoins: VaultSessionState["pendingJoins"];
  declare vaultMembers: VaultSessionState["vaultMembers"];
  declare enrollSecretsKey: VaultSessionState["enrollSecretsKey"];
  declare enrollMembersKey: VaultSessionState["enrollMembersKey"];
  declare sharedJoinerIdentity: VaultSessionState["sharedJoinerIdentity"];
  declare sharedGrantInstructions: VaultSessionState["sharedGrantInstructions"];
  declare joinEnrollmentPrompt: VaultSessionState["joinEnrollmentPrompt"];
  declare awaitingJoinApproval: VaultSessionState["awaitingJoinApproval"];
  declare loginPasswordPrompt: VaultSessionState["loginPasswordPrompt"];
  declare loginDeviceKeysCapable: VaultSessionState["loginDeviceKeysCapable"];
  declare remoteVaultRecoveryState: VaultSessionState["remoteVaultRecoveryState"];
  declare isPasswordBusy: VaultSessionState["isPasswordBusy"];
  declare passwordError: VaultSessionState["passwordError"];
  declare enrollmentCode: VaultSessionState["enrollmentCode"];
  declare prefillEnrollmentCode: VaultSessionState["prefillEnrollmentCode"];
  declare enrollmentFromUrlPending: VaultSessionState["enrollmentFromUrlPending"];
  declare loginEnrollmentCode: VaultSessionState["loginEnrollmentCode"];
  declare passwordEntries: VaultSessionState["passwordEntries"];
  declare selectedPasswordEntry: VaultSessionState["selectedPasswordEntry"];
  declare selectPasswordEntry: VaultSessionState["selectPasswordEntry"];
  declare clearSelectedPasswordEntry: VaultSessionState["clearSelectedPasswordEntry"];
  declare readonly activeEnrollmentEntry: VaultSessionState["activeEnrollmentEntry"];
  declare beginEnrollmentEntry: VaultSessionState["beginEnrollmentEntry"];
  declare clearActiveEnrollmentEntry: VaultSessionState["clearActiveEnrollmentEntry"];
  declare clearManager: VaultSessionState["clearManager"];

  declare secrets: VaultSecretsState["secrets"];
  declare secretTotal: VaultSecretsState["secretTotal"];
  declare secretPageOffset: VaultSecretsState["secretPageOffset"];
  declare secretPageSize: VaultSecretsState["secretPageSize"];
  declare secretQuery: VaultSecretsState["secretQuery"];
  declare secretTypeFilter: VaultSecretsState["secretTypeFilter"];
  declare clearSecretTypeFilter: VaultSecretsState["clearSecretTypeFilter"];

  declare sentinelGenesisPhase: VaultSentinelState["sentinelGenesisPhase"];
  declare sentinelGenesisRequest: VaultSentinelState["sentinelGenesisRequest"];
  declare sentinelGenesisParticipantCount: VaultSentinelState["sentinelGenesisParticipantCount"];
  declare sentinelGenesisParticipants: VaultSentinelState["sentinelGenesisParticipants"];
  declare sentinelGenesisDeliveries: VaultSentinelState["sentinelGenesisDeliveries"];
  declare readonly sentinelGenesisTarget: VaultSentinelState["sentinelGenesisTarget"];
  declare selectSentinelGenesisStore: VaultSentinelState["selectSentinelGenesisStore"];
  declare clearSentinelGenesisStore: VaultSentinelState["clearSentinelGenesisStore"];
  declare sentinelCeremonyPrompt: VaultSentinelState["sentinelCeremonyPrompt"];
  declare sentinelUnlockStatus: VaultSentinelState["sentinelUnlockStatus"];
  declare sentinelUnlockRequest: VaultSentinelState["sentinelUnlockRequest"];
  declare sentinelUnlockSession: VaultSentinelState["sentinelUnlockSession"];
  declare sentinelStoredDeliveries: VaultSentinelState["sentinelStoredDeliveries"];

  declare readonly lastSync: VaultSyncState["lastSync"];
  declare markSynced: VaultSyncState["markSynced"];
  declare isSyncing: VaultSyncState["isSyncing"];
  declare readonly manualProviderSync: VaultSyncState["manualProviderSync"];
  declare readonly manualProviderSyncRunning: VaultSyncState["manualProviderSyncRunning"];
  declare beginManualProviderSync: VaultSyncState["beginManualProviderSync"];
  declare clearSyncingProvider: VaultSyncState["clearSyncingProvider"];
  declare isFanOutSyncing: VaultSyncState["isFanOutSyncing"];
  declare readonly replacementConflicts: VaultSyncState["replacementConflicts"];
  declare readonly securityConflicts: VaultSyncState["securityConflicts"];
  declare replaceProjectionConflicts: VaultSyncState["replaceProjectionConflicts"];
  declare clearProjectionConflicts: VaultSyncState["clearProjectionConflicts"];
  declare stageSecurityConflictForTesting: VaultSyncState["stageSecurityConflictForTesting"];
  declare stageContentSyncConflictForTesting: VaultSyncState["stageContentSyncConflictForTesting"];
  declare stageStoreIdSyncConflictForTesting: VaultSyncState["stageStoreIdSyncConflictForTesting"];
  declare readonly syncConflictReview: VaultSyncState["syncConflictReview"];
  declare readonly syncConflictRequiresDecision: VaultSyncState["syncConflictRequiresDecision"];
  stageSyncConflict(
    value: Parameters<VaultSyncState["stageSyncConflict"]>[0],
  ): ReturnType<VaultSyncState["stageSyncConflict"]> {
    void value;
    throw new Error("Vault state delegate was not initialized");
  }
  declare clearPendingSyncConflict: VaultSyncState["clearPendingSyncConflict"];
  declare readonly localFolderHealth: VaultSyncState["localFolderHealth"];
  declare reportLocalFolderMultipleVaults: VaultSyncState["reportLocalFolderMultipleVaults"];
  declare clearLocalFolderMultipleVaultsIssue: VaultSyncState["clearLocalFolderMultipleVaultsIssue"];

  private delegateState<State extends VaultStateSlice>({
    target,
    state,
    keys,
  }: VaultStateDelegation<State>): void {
    for (const key of keys) {
      const definePropertyArgs: Parameters<typeof Object.defineProperty>[2] = {
        enumerable: true,
        get: () => {
          const value = state[key];
          if (!isVaultDelegatedCallable(value)) return value;
          return (...args: VaultDelegatedArguments): VaultDelegatedValue =>
            value.apply(state, args);
        },
        set: (value: State[keyof State]) => Reflect.set(state, key, value),
      };
      Object.defineProperty(target, key, definePropertyArgs);
    }
  }

  constructor(runtimeState: VaultRuntimeState) {
    const delegateStateArgs: VaultStateDelegation<VaultRuntimeState> = {
      target: this,
      state: runtimeState,
      keys: runtimeKeys,
    };
    this.delegateState(delegateStateArgs);
    const delegateStateArgs2: VaultStateDelegation<VaultUiState> = {
      target: this,
      state: new VaultUiState(),
      keys: uiKeys,
    };
    this.delegateState(delegateStateArgs2);
    const delegateStateArgs3: VaultStateDelegation<VaultProviderState> = {
      target: this,
      state: new VaultProviderState(),
      keys: providerKeys,
    };
    this.delegateState(delegateStateArgs3);
    const delegateStateArgs4: VaultStateDelegation<VaultSessionState> = {
      target: this,
      state: new VaultSessionState(),
      keys: sessionKeys,
    };
    this.delegateState(delegateStateArgs4);
    const delegateStateArgs5: VaultStateDelegation<VaultSecretsState> = {
      target: this,
      state: new VaultSecretsState(),
      keys: secretsKeys,
    };
    this.delegateState(delegateStateArgs5);
    const delegateStateArgs6: VaultStateDelegation<VaultSentinelState> = {
      target: this,
      state: new VaultSentinelState(),
      keys: sentinelKeys,
    };
    this.delegateState(delegateStateArgs6);
    const delegateStateArgs7: VaultStateDelegation<VaultSyncState> = {
      target: this,
      state: new VaultSyncState(),
      keys: syncKeys,
    };
    this.delegateState(delegateStateArgs7);
  }
}

type VaultStateSlicesConstructor = {
  new (runtimeState: VaultRuntimeState): VaultStateSlicesImplementation;
};

export const VaultStateSlices: VaultStateSlicesConstructor =
  VaultStateSlicesImplementation;
