import { VaultAuthStepKey } from './vault-auth-workflow-messages'
import { DemoVaultPresence as Presence } from '../../nook-auth/_shared/nook-auth-state'

export { DemoVaultPresence as Presence } from '../../nook-auth/_shared/nook-auth-state'

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

export interface SentinelLaunch {
  ui: SentinelUi
  vaultName: string
}

export enum VaultAuthExperimentStage {
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  Auth = 'auth',
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  Sentinel = 'sentinel',
}

export class AwaitingVaultName {
  readonly step = 0
  readonly path = VaultPath.Undecided
  respond(name: string): AwaitingVaultKind {
    return AwaitingVaultKind.admitName(name)
  }
}
export class AwaitingVaultKind {
  readonly step = 1
  readonly path = VaultPath.Undecided
  private constructor(private readonly name: string) {}
  static admitName(name: string): AwaitingVaultKind {
    if (!name.trim()) throw new Error('Vault presentation requires a name')
    return new AwaitingVaultKind(name)
  }
  choose(path: SelectedVaultPathKind): SelectedVaultPath {
    return SelectedVaultPath.select({ name: this.name, path })
  }
  back(): AwaitingVaultName {
    return new AwaitingVaultName()
  }
}
type SelectedVaultPathKind = VaultPath.Simple | VaultPath.Sentinel
export class SelectedVaultPath {
  readonly step = 2
  private readonly name: string
  readonly path: SelectedVaultPathKind
  private constructor(request: { name: string; path: SelectedVaultPathKind }) {
    this.name = request.name
    this.path = request.path
  }
  static select(request: {
    name: string
    path: SelectedVaultPathKind
  }): SelectedVaultPath {
    // Admission retains the existing presentation requirement before path choice.
    AwaitingVaultKind.admitName(request.name)
    return new SelectedVaultPath(request)
  }
  back(): AwaitingVaultKind {
    return AwaitingVaultKind.admitName(this.name)
  }
}
export class AwaitingExistingVault {
  readonly step = 0
  readonly path = VaultPath.Undecided
  identify(): IdentifiedExistingVault {
    return IdentifiedExistingVault.identify(this)
  }
}
export class IdentifiedExistingVault {
  readonly step = 1
  readonly path = VaultPath.Undecided
  private constructor(private readonly previous: AwaitingExistingVault) {}
  static identify(previous: AwaitingExistingVault): IdentifiedExistingVault {
    return new IdentifiedExistingVault(previous)
  }
  back(): AwaitingExistingVault {
    return this.previous
  }
}
export type VaultAuthPresentation =
  | AwaitingVaultName
  | AwaitingVaultKind
  | SelectedVaultPath
  | AwaitingExistingVault
  | IdentifiedExistingVault

export class VaultAuthWorkflowState {
  private current = $state<VaultAuthPresentation>(new AwaitingVaultName())
  get phase(): VaultAuthPresentation {
    return this.current
  }
  get presence(): Presence {
    return this.current instanceof AwaitingExistingVault ||
      this.current instanceof IdentifiedExistingVault
      ? Presence.Existing
      : Presence.Empty
  }
  get step(): number {
    return this.current.step
  }
  get path(): VaultPath {
    return this.current.path
  }
  transition(request: {
    previous: VaultAuthPresentation
    next: VaultAuthPresentation
  }): void {
    if (this.current !== request.previous) return
    this.current = request.next
  }
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
    this.current =
      next === Presence.Existing
        ? new AwaitingExistingVault()
        : new AwaitingVaultName()
  }
}
