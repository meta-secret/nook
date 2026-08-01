import type { SessionActionsContext } from "$lib/vault/action-contexts";
import {
  JoinEnrollmentState,
  SentinelGenesisPhase,
  SentinelVaultUnlockState,
  setVaultSessionLocked,
} from "$app-wasm";
import { VaultType } from "$lib/vault/architecture-model";
import { createLogger } from "$lib/runtime/log";
import { inactiveSentinelUnlockSession } from "$lib/vault/sentinel-unlock";
import { LocalLoginPreparationState } from "$lib/vault/state/provider.svelte";

const log = createLogger("vault-session");

export function resetVaultSessionState(
  state: SessionActionsContext,
  resetManager = true,
): void {
  if (resetManager && state.hasManager) {
    void state
      .enqueueStorage(() => state.requireManager().resetVaultSession())
      .catch(() => {
        // Engine may be tearing down.
      });
  }
  state.passwordEntries = [];
  state.clearSelectedPasswordEntry();
  state.loginPasswordPrompt = false;
  state.loginDeviceKeysCapable = true;
  state.sentinelCeremonyPrompt = false;
  state.sentinelUnlockStatus = SentinelVaultUnlockState.NotSentinel;
  state.sentinelUnlockRequest = "";
  state.sentinelUnlockSession.free();
  state.sentinelUnlockSession = inactiveSentinelUnlockSession();
  for (const delivery of state.sentinelStoredDeliveries) delivery.free();
  state.sentinelStoredDeliveries = [];
  for (const delivery of state.sentinelGenesisDeliveries) delivery.free();
  state.sentinelGenesisDeliveries = [];
  for (const participant of state.sentinelGenesisParticipants) {
    participant.free();
  }
  state.sentinelGenesisParticipants = [];
  state.sentinelGenesisParticipantCount = 0;
  state.sentinelGenesisPhase = SentinelGenesisPhase.Inactive;
  state.sentinelGenesisRequest = "";
  state.clearSentinelGenesisStore();
  state.sharedJoinerIdentity = "";
  state.sharedGrantInstructions = "";
}

export function markVaultUnlocked(state: SessionActionsContext): void {
  setVaultSessionLocked(false);
  state.isAuthenticated = true;
  state.awaitingJoinApproval = false;
  state.sessionExpiredByIdle = false;
  state.refreshVaultArchitectureFromManager();
  log.info("vault session unlocked", { secrets: state.secrets.length });
  void state.publishExtensionEventLogUpdate();
}

export function clearUnlockedSession(
  state: SessionActionsContext,
  resetManager = true,
): void {
  state.localLoginPreparation = LocalLoginPreparationState.Idle;
  state.secretPageGeneration += 1;
  state.stopIdleSessionTracking();
  state.stopVaultSync();
  state.isAuthenticated = false;
  for (const secret of state.secrets) secret.free();
  state.secrets = [];
  state.secretTotal = 0;
  state.secretPageOffset = 0;
  state.secretPageRequestOffset = 0;
  state.secretQuery = "";
  state.clearSecretTypeFilter();
  state.pendingJoins = [];
  state.vaultMembers = [];
  state.clearProjectionConflicts();
  state.joinEnrollmentPrompt = JoinEnrollmentState.None;
  state.enrollSecretsKey = "";
  state.enrollMembersKey = "";
  state.sharedJoinerIdentity = "";
  state.sharedGrantInstructions = "";
  state.settingsOpen = false;
  state.enrollmentCode = "";
  state.errorMsg = "";
  const wasSentinel = state.vaultArchitecture.vault_type === VaultType.Sentinel;
  resetVaultSessionState(state, resetManager);
  if (wasSentinel) {
    state.sentinelCeremonyPrompt = true;
    state.sentinelUnlockStatus = SentinelVaultUnlockState.CeremonyRequired;
  }
}
