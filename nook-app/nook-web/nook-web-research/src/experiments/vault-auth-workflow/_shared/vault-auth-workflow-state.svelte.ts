import { VaultAuthStepKey } from './vault-auth-workflow-messages'

export enum Presence {
  Empty = 'empty',
  Existing = 'existing',
}

export enum VaultPath {
  Undecided = 'undecided',
  Simple = 'simple',
  Sentinel = 'sentinel',
}

export enum SentinelUi {
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  CardStack = 'card-stack',
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  Terminal = 'terminal',
}

export enum VaultAuthExperimentStage {
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  Auth = 'auth',
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  Sentinel = 'sentinel',
}

class VaultAuthWorkflowState {
  presence = $state<Presence>(Presence.Empty)
  step = $state(0)
  path = $state<VaultPath>(VaultPath.Undecided)

  get steps(): VaultAuthStepKey[] {
    if (this.presence === Presence.Existing) {
      return [
        VaultAuthStepKey.UnlockExistingVault,
        VaultAuthStepKey.ConfirmVaultIdentity,
        VaultAuthStepKey.UnlockWithPasskey,
      ]
    }
    if (this.path === VaultPath.Simple) {
      return [
        VaultAuthStepKey.NameVault,
        VaultAuthStepKey.ChooseVaultKind,
        VaultAuthStepKey.CreateLocally,
      ]
    }
    if (this.path === VaultPath.Sentinel) {
      return [
        VaultAuthStepKey.NameVault,
        VaultAuthStepKey.ChooseVaultKind,
        VaultAuthStepKey.ChooseSentinelInterface,
        VaultAuthStepKey.InitializeDevice,
      ]
    }
    return [
      VaultAuthStepKey.NameVault,
      VaultAuthStepKey.ChooseVaultKind,
      VaultAuthStepKey.CreateOrConfigure,
    ]
  }

  setPresence(next: Presence): void {
    this.presence = next
    this.step = 0
    this.path = VaultPath.Undecided
  }

  continueAfterName(vaultName: string): void {
    if (vaultName.trim()) this.step = 1
  }

  choose(path: VaultPath.Simple | VaultPath.Sentinel): void {
    this.path = path
    this.step = 2
  }

  goBack(): void {
    if (this.presence === Presence.Empty && this.step === 1) {
      this.path = VaultPath.Undecided
      this.step = 0
      return
    }
    if (this.presence === Presence.Empty && this.step === 2) {
      this.path = VaultPath.Undecided
      this.step = 1
      return
    }
    if (this.step > 0) this.step -= 1
  }
}

export function createVaultAuthWorkflowState(): VaultAuthWorkflowState {
  return new VaultAuthWorkflowState()
}
