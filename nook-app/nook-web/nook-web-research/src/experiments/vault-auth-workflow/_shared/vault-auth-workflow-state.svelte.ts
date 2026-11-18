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

interface SelectedVaultPathRequest {
  name: string
  path: SelectedVaultPathKind
}

class AwaitingVaultName {
  readonly step = 0
  readonly path = VaultPath.Undecided
  respond(name: string): AwaitingVaultKind {
    return AwaitingVaultKind.admitName(name)
  }
}
class AwaitingVaultKind {
  readonly step = 1
  readonly path = VaultPath.Undecided
  private constructor(private readonly name: string) {}
  static admitName(name: string): AwaitingVaultKind {
    if (!name.trim()) throw new Error('Vault presentation requires a name')
    return new AwaitingVaultKind(name)
  }
  choose(path: SelectedVaultPathKind): SelectedVaultPath {
    const request: SelectedVaultPathRequest = { name: this.name, path }
    return SelectedVaultPath.select(request)
  }
  back(): AwaitingVaultName {
    return new AwaitingVaultName()
  }
}
type SelectedVaultPathKind = VaultPath.Simple | VaultPath.Sentinel
class SelectedVaultPath {
  readonly step = 2
  private readonly name: string
  readonly path: SelectedVaultPathKind
  private constructor(request: SelectedVaultPathRequest) {
    this.name = request.name
    this.path = request.path
  }
  static select(request: SelectedVaultPathRequest): SelectedVaultPath {
    // Admission retains the existing presentation requirement before path choice.
    AwaitingVaultKind.admitName(request.name)
    return new SelectedVaultPath(request)
  }
  back(): AwaitingVaultKind {
    return AwaitingVaultKind.admitName(this.name)
  }
}
class AwaitingExistingVault {
  readonly step = 0
  readonly path = VaultPath.Undecided
  identify(): IdentifiedExistingVault {
    return IdentifiedExistingVault.identify(this)
  }
}
class IdentifiedExistingVault {
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
type VaultAuthPresentation =
  | AwaitingVaultName
  | AwaitingVaultKind
  | SelectedVaultPath
  | AwaitingExistingVault
  | IdentifiedExistingVault

export class VaultAuthWorkflowState {
  private current = $state<VaultAuthPresentation>(new AwaitingVaultName())
  vaultName = $state('')
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
  continueAfterName(): void {
    if (this.current instanceof AwaitingVaultName && this.vaultName.trim())
      this.current = this.current.respond(this.vaultName)
  }

  choose(path: SelectedVaultPathKind): void {
    if (this.current instanceof AwaitingVaultKind)
      this.current = this.current.choose(path)
  }

  back(): void {
    if ('back' in this.current) this.current = this.current.back()
  }

  identifyExisting(): void {
    if (this.current instanceof AwaitingExistingVault)
      this.current = this.current.identify()
  }

  launch(ui: SentinelUi): SentinelLaunch {
    return { ui, vaultName: this.vaultName.trim() }
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
    this.vaultName = ''
    this.current =
      next === Presence.Existing
        ? new AwaitingExistingVault()
        : new AwaitingVaultName()
  }
}
