import { VaultProviderState } from './provider.svelte'
import { VaultRuntimeState } from './runtime.svelte'
import { VaultSecretsState } from './secrets.svelte'
import { VaultSentinelState } from './sentinel.svelte'
import { VaultSessionState } from './session.svelte'
import { VaultSyncState } from './sync.svelte'
import { VaultUiState } from './ui.svelte'

type VaultStateSlice =
  | VaultRuntimeState
  | VaultUiState
  | VaultProviderState
  | VaultSessionState
  | VaultSecretsState
  | VaultSentinelState
  | VaultSyncState

type VaultStateDelegation<State extends VaultStateSlice> = {
  readonly target: VaultStateSlicesBase
  readonly state: State
  readonly keys: readonly (keyof State)[]
}

function delegateState<State extends VaultStateSlice>({
  target,
  state,
  keys,
}: VaultStateDelegation<State>): void {
  for (const key of keys) {
    const definePropertyArgs: Parameters<typeof Object.defineProperty>[2] = {
      enumerable: true,
      get: () => {
        const value = Reflect.get(state, key)
        return typeof value === 'function' ? value.bind(state) : value
      },
      set: (value: State[keyof State]) => Reflect.set(state, key, value),
    }
    Object.defineProperty(target, key, definePropertyArgs)
  }
}

const runtimeKeys = [
  'browserLocale',
  'clientPolicy',
  'runtimeConfig',
  'locale',
  'translations',
  'errorMsg',
  'successMsg',
  'isVerifying',
  'isSaving',
  'isInitializing',
] as const satisfies readonly (keyof VaultRuntimeState)[]

const uiKeys = [
  'settingsOpen',
  'settingsSection',
  'devicesAccessIdentityProtectionOpen',
  'settingsAccordionSection',
  'adminAccordionSection',
  'helpOpen',
] as const satisfies readonly (keyof VaultUiState)[]

const providerKeys = [
  'providers',
  'providersLoaded',
  'localVaults',
  'localVaultCatalog',
  'activeVault',
  'openActiveVault',
  'hasActiveVaultStore',
  'requireActiveVaultStoreId',
  'clearActiveVaultStore',
  'selectedLoginVault',
  'selectLoginVault',
  'hasSelectedLoginVaultStore',
  'clearSelectedLoginVaultStore',
  'localVaultPresent',
  'localLoginPreparation',
  'loginSetup',
  'activateLoginSetup',
  'clearLoginSetup',
  'loginRequiresExistingVault',
  'recoveryDiscovery',
  'recordExistingVaultRecovery',
  'requireExistingVaultRecovery',
  'clearExistingVaultRecoverySummary',
  'addProviderOpen',
  'storageMode',
  'githubPat',
  'githubRepo',
  'oauthFileDraft',
  'configureOauthFile',
  'requireOauthFileConfig',
  'clearOauthFile',
  'localFolderDraft',
  'configureLocalFolder',
  'requireLocalFolderConfig',
  'clearLocalFolder',
  'localFolderBackupSupported',
  'vaultArchitecture',
  'draftDeviceMode',
  'draftVaultType',
  'draftReplicationType',
  'oauthSetupSelection',
  'selectOauthSetupPreset',
  'clearOauthSetupPreset',
  'clearIdentityProviderSession',
  'googleOAuthBusy',
  'icloudOAuthPreparing',
  'icloudOAuthReady',
  'icloudOAuthBusy',
] as const satisfies readonly (keyof VaultProviderState)[]

const sessionKeys = [
  'managerSession',
  'hasManager',
  'requireManager',
  'openManager',
  'deviceProtectionStatus',
  'deviceProtectionLockedStatus',
  'isAuthenticated',
  'sessionExpiredByIdle',
  'deviceId',
  'devicePublicKey',
  'pendingJoins',
  'vaultMembers',
  'enrollSecretsKey',
  'enrollMembersKey',
  'sharedJoinerIdentity',
  'sharedGrantInstructions',
  'joinEnrollmentPrompt',
  'awaitingJoinApproval',
  'loginPasswordPrompt',
  'loginDeviceKeysCapable',
  'remoteVaultRecoveryState',
  'isPasswordBusy',
  'passwordError',
  'enrollmentCode',
  'prefillEnrollmentCode',
  'enrollmentFromUrlPending',
  'loginEnrollmentCode',
  'passwordEntries',
  'selectedPasswordEntry',
  'selectPasswordEntry',
  'clearSelectedPasswordEntry',
  'activeEnrollmentEntry',
  'beginEnrollmentEntry',
  'clearActiveEnrollmentEntry',
  'clearManager',
] as const satisfies readonly (keyof VaultSessionState)[]

const secretsKeys = [
  'secrets',
  'secretTotal',
  'secretPageOffset',
  'secretPageSize',
  'secretQuery',
  'secretTypeFilter',
  'clearSecretTypeFilter',
] as const satisfies readonly (keyof VaultSecretsState)[]

const sentinelKeys = [
  'sentinelGenesisPhase',
  'sentinelGenesisRequest',
  'sentinelGenesisParticipantCount',
  'sentinelGenesisParticipants',
  'sentinelGenesisDeliveries',
  'sentinelGenesisTarget',
  'selectSentinelGenesisStore',
  'clearSentinelGenesisStore',
  'sentinelCeremonyPrompt',
  'sentinelUnlockStatus',
  'sentinelUnlockRequest',
  'sentinelUnlockSession',
  'sentinelStoredDeliveries',
] as const satisfies readonly (keyof VaultSentinelState)[]

const syncKeys = [
  'lastSync',
  'markSynced',
  'isSyncing',
  'manualProviderSync',
  'manualProviderSyncRunning',
  'beginManualProviderSync',
  'clearSyncingProvider',
  'isFanOutSyncing',
  'replacementConflicts',
  'securityConflicts',
  'replaceProjectionConflicts',
  'clearProjectionConflicts',
  'stageSecurityConflictForTesting',
  'stageContentSyncConflictForTesting',
  'stageStoreIdSyncConflictForTesting',
  'syncConflictReview',
  'syncConflictRequiresDecision',
  'stageSyncConflict',
  'clearPendingSyncConflict',
  'localFolderHealth',
  'reportLocalFolderMultipleVaults',
  'clearLocalFolderMultipleVaultsIssue',
] as const satisfies readonly (keyof VaultSyncState)[]

type VaultStateSliceFields = VaultRuntimeState &
  VaultUiState &
  VaultProviderState &
  VaultSessionState &
  VaultSecretsState &
  VaultSentinelState &
  VaultSyncState

class VaultStateSlicesBase {
  constructor(runtimeState: VaultRuntimeState) {
    const delegateStateArgs: VaultStateDelegation<VaultRuntimeState> = {
      target: this,
      state: runtimeState,
      keys: runtimeKeys,
    }
    delegateState(delegateStateArgs)
    const delegateStateArgs2: VaultStateDelegation<VaultUiState> = {
      target: this,
      state: new VaultUiState(),
      keys: uiKeys,
    }
    delegateState(delegateStateArgs2)
    const delegateStateArgs3: VaultStateDelegation<VaultProviderState> = {
      target: this,
      state: new VaultProviderState(),
      keys: providerKeys,
    }
    delegateState(delegateStateArgs3)
    const delegateStateArgs4: VaultStateDelegation<VaultSessionState> = {
      target: this,
      state: new VaultSessionState(),
      keys: sessionKeys,
    }
    delegateState(delegateStateArgs4)
    const delegateStateArgs5: VaultStateDelegation<VaultSecretsState> = {
      target: this,
      state: new VaultSecretsState(),
      keys: secretsKeys,
    }
    delegateState(delegateStateArgs5)
    const delegateStateArgs6: VaultStateDelegation<VaultSentinelState> = {
      target: this,
      state: new VaultSentinelState(),
      keys: sentinelKeys,
    }
    delegateState(delegateStateArgs6)
    const delegateStateArgs7: VaultStateDelegation<VaultSyncState> = {
      target: this,
      state: new VaultSyncState(),
      keys: syncKeys,
    }
    delegateState(delegateStateArgs7)
  }
}

type VaultStateSlicesConstructor = {
  new (
    runtimeState: VaultRuntimeState,
  ): VaultStateSlicesBase & VaultStateSliceFields
}

export const VaultStateSlices =
  VaultStateSlicesBase as VaultStateSlicesConstructor
