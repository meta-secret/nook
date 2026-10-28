import {
  KeyState,
  StateGroup,
  machine,
  PasskeyFit,
  ProviderHolds,
  thisBrowserPasskey,
  work,
  type IdentityFixture,
  type KeyFixture,
} from './machine'

/** The prototype's state: where the machine is, what it has seen, and the
 * simulator's answers for the provider and the passkey. */
export class KeyFlow {
  current = $state<KeyState>(KeyState.Empty)
  visited = $state<readonly KeyState[]>([KeyState.Empty])
  /** A local identity exists on this browser. */
  hasLocal = $state(false)
  localName = $state('Personal')
  provider = $state('Google Drive')
  /** The remote identity the user is acting on. */
  chosen = $state<IdentityFixture>(work)
  /** Remote identities joined and kept separate. */
  separate = $state<readonly IdentityFixture[]>([])
  providerHolds = $state<ProviderHolds>(ProviderHolds.Identities)
  passkeyFit = $state<PasskeyFit>(PasskeyFit.Opens)
  synced = $state(false)
  /** The user checked the provider's identities with a passkey. */
  remoteChecked = $state(false)

  /** The path taken, and where in it the screen is. */
  history = $state<readonly KeyState[]>([KeyState.Empty])
  cursor = $state(0)

  /** Move along a transition; a new step from the middle of the path drops
   * the steps ahead of it. */
  go(to: KeyState): void {
    this.history = [...this.history.slice(0, this.cursor + 1), to]
    this.cursor = this.history.length - 1
    this.show(to)
  }

  canBack(): boolean {
    return this.cursor > 0
  }

  canForward(): boolean {
    return this.cursor < this.history.length - 1
  }

  back(): void {
    if (!this.canBack()) return
    this.cursor -= 1
    this.showAtCursor()
  }

  forward(): void {
    if (!this.canForward()) return
    this.cursor += 1
    this.showAtCursor()
  }

  /** Jump to any state from the map, with the context it needs: the local
   * and remote groups have a local identity, the import group has none. */
  jump(to: KeyState): void {
    const group = machine.find((node) => node.state === to)?.group
    this.hasLocal = group === StateGroup.Local || group === StateGroup.Remote
    if (to === KeyState.Empty || to === KeyState.CreateIdentity) this.hasLocal = false
    this.go(to)
  }

  private showAtCursor(): void {
    const state = this.history.at(this.cursor)
    if (state) this.show(state)
  }

  private show(state: KeyState): void {
    this.current = state
    if (!this.visited.includes(state)) this.visited = [...this.visited, state]
  }

  reset(): void {
    this.current = KeyState.Empty
    this.history = [KeyState.Empty]
    this.cursor = 0
    this.visited = [KeyState.Empty]
    this.hasLocal = false
    this.chosen = work
    this.separate = []
    this.synced = false
    this.remoteChecked = false
  }

  /** A freshly created identity has one key: this browser's passkey. */
  localKeys(): readonly KeyFixture[] {
    return [thisBrowserPasskey]
  }

  local(): IdentityFixture {
    return {
      id: 'idn_local',
      name: this.localName || 'Personal',
      words: 'spoon-river-calm',
      keys: this.localKeys(),
    }
  }

  /** The chosen remote identity with this browser's key added, once joined. */
  joined(): IdentityFixture {
    return { ...this.chosen, keys: [...this.chosen.keys, thisBrowserPasskey] }
  }
}
