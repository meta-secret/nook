import { VaultProviderState } from './provider.svelte'
import { VaultRuntimeState } from './runtime.svelte'
import { VaultSecretsState } from './secrets.svelte'
import { VaultSentinelState } from './sentinel.svelte'
import { VaultSessionState } from './session.svelte'
import { VaultSyncState } from './sync.svelte'
import { VaultUiState } from './ui.svelte'

function delegateState(
  target: object,
  state: object,
  keys: readonly PropertyKey[],
): void {
  for (const key of keys) {
    Object.defineProperty(target, key, {
      enumerable: true,
      get: () => {
        const value = Reflect.get(state, key)
        return typeof value === 'function' ? value.bind(state) : value
      },
      set: (value: unknown) => Reflect.set(state, key, value),
    })
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
  'clearActiveVaultStore',
  'selectedLoginVault',
  'selectLoginVault',
  'hasSelectedLoginVaultStore',
  'clearSelectedLoginVaultStore',
  'localVaultPresent',
  'localLoginPrepared',
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
  'isSyncing',
  'manualProviderSync',
  'manualProviderSyncRunning',
  'clearSyncingProvider',
  'isFanOutSyncing',
  'replacementConflicts',
  'securityConflicts',
  'syncConflictReview',
  'syncConflictRequiresDecision',
  'stageSyncConflict',
  'clearPendingSyncConflict',
  'localFolderHealth',
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
  constructor() {
    delegateState(this, new VaultRuntimeState(), runtimeKeys)
    delegateState(this, new VaultUiState(), uiKeys)
    delegateState(this, new VaultProviderState(), providerKeys)
    delegateState(this, new VaultSessionState(), sessionKeys)
    delegateState(this, new VaultSecretsState(), secretsKeys)
    delegateState(this, new VaultSentinelState(), sentinelKeys)
    delegateState(this, new VaultSyncState(), syncKeys)
  }
}

type VaultStateSlicesConstructor = new () => VaultStateSlicesBase &
  VaultStateSliceFields

export const VaultStateSlices =
  VaultStateSlicesBase as VaultStateSlicesConstructor
