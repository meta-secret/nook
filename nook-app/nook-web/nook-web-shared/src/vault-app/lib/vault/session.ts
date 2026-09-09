import { NativeVaultStorageFailure } from '$lib/runtime/storage-failure'
import { err as storageErr, ok as storageOk } from 'neverthrow'

import { BrowserIdentityHandoffKind } from '$lib/vault/identity-handoff'
import type { SessionActionsContext } from '$lib/vault/action-contexts'
import {
  JoinEnrollmentState,
  SentinelGenesisPhase,
  SentinelVaultUnlockState,
  set_vault_session_locked,
} from '$app-wasm'
import { VaultType } from '$lib/vault/architecture-model'
import { browserLogRuntime } from '$lib/runtime/log'
import { SentinelUnlockActions } from '$lib/vault/sentinel-unlock'
import { LocalLoginPreparationState } from '$lib/vault/state/provider.svelte'

const log = browserLogRuntime.createLogger('vault-session')

type VaultSessionReset = {
  readonly resetManager: boolean
}

type UnlockedSessionClearRequest = {
  readonly resetManager: boolean
}

/** Owns browser orchestration for one session context. */
export class VaultSessionActions {
  constructor(private readonly state: SessionActionsContext) {}

  resetVaultSessionState({ resetManager }: VaultSessionReset): void {
    const state = this.state
    if (resetManager && state.hasManager) {
      void state
        .enqueueStorage(async () => {
          const admittedManager = state.admitManager()
          if (admittedManager.isErr()) return storageErr(admittedManager.error)
          try {
            return storageOk(await admittedManager.value.reset_vault_session())
          } catch (nativeFailure) {
            return storageErr(new NativeVaultStorageFailure(nativeFailure))
          }
        })
        .then((reset) => {
          if (reset.isErr()) log.warn('vault session reset could not complete')
        })
    }
    state.passwordEntries = []
    state.clearSelectedPasswordEntry()
    state.loginPasswordPrompt = false
    state.loginDeviceKeysCapable = true
    state.sentinelCeremonyPrompt = false
    state.sentinelUnlockStatus = SentinelVaultUnlockState.NotSentinel
    state.sentinelUnlockRequest = ''
    state.sentinelUnlockSession.free()
    state.sentinelUnlockSession =
      SentinelUnlockActions.inactiveSentinelUnlockSession()
    for (const delivery of state.sentinelStoredDeliveries) delivery.free()
    state.sentinelStoredDeliveries = []
    for (const delivery of state.sentinelGenesisDeliveries) delivery.free()
    state.sentinelGenesisDeliveries = []
    for (const participant of state.sentinelGenesisParticipants) {
      participant.free()
    }
    state.sentinelGenesisParticipants = []
    state.sentinelGenesisParticipantCount = 0
    state.sentinelGenesisPhase = SentinelGenesisPhase.Inactive
    state.sentinelGenesisRequest = ''
    state.clearSentinelGenesisStore()
    state.sharedJoinerIdentity = ''
    state.sharedGrantInstructions = ''
  }

  markVaultUnlocked() {
    const state = this.state
    const manager = state.admitManager()
    if (manager.isErr()) return storageErr(manager.error)
    const handoff = state.externalIdentityHandoff
    if (handoff.kind === BrowserIdentityHandoffKind.Adopted) {
      const required = handoff.adoption.requiresConnect(manager.value)
      if (required.isErr()) return storageErr(required.error)
      if (!required.value) {
        const confirmed = handoff.adoption.afterVerifiedConnect(manager.value)
        if (confirmed.isErr()) return storageErr(confirmed.error)
        state.externalIdentityHandoff = { kind: BrowserIdentityHandoffKind.Inactive }
      }
    }
    try {
      set_vault_session_locked(false)
    } catch (failure) {
      return storageErr(new NativeVaultStorageFailure(failure))
    }
    state.isAuthenticated = true
    state.awaitingJoinApproval = false
    state.sessionExpiredByIdle = false
    state.refreshVaultArchitectureFromManager()
    log.info('vault session unlocked')
    void state.publishExtensionEventLogUpdate()
    return storageOk(undefined)
  }

  clearUnlockedSession({ resetManager }: UnlockedSessionClearRequest): void {
    const state = this.state
    state.localLoginPreparation = LocalLoginPreparationState.Idle
    state.secretPageGeneration += 1
    state.stopIdleSessionTracking()
    state.stopVaultSync()
    state.isAuthenticated = false
    for (const secret of state.secrets) secret.free()
    state.secrets = []
    state.secretTotal = 0
    state.secretPageOffset = 0
    state.secretPageRequestOffset = 0
    state.secretQuery = ''
    state.clearSecretTypeFilter()
    state.pendingJoins = []
    state.vaultMembers = []
    state.clearProjectionConflicts()
    state.joinEnrollmentPrompt = JoinEnrollmentState.None
    state.enrollSecretsKey = ''
    state.enrollMembersKey = ''
    state.sharedJoinerIdentity = ''
    state.sharedGrantInstructions = ''
    state.settingsOpen = false
    state.enrollmentCode = ''
    state.errorMsg = ''
    const wasSentinel = state.vaultArchitecture.vault_type === VaultType.Sentinel
    const resetVaultSessionStateArgs: Parameters<
      VaultSessionActions['resetVaultSessionState']
    >[0] = { resetManager }
    this.resetVaultSessionState(resetVaultSessionStateArgs)
    if (wasSentinel) {
      state.sentinelCeremonyPrompt = true
      state.sentinelUnlockStatus = SentinelVaultUnlockState.CeremonyRequired
    }
  }
}
