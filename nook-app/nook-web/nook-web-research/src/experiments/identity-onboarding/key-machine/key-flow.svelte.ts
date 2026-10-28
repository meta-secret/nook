import {
  KeyState,
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
  /** Remote identities merged into the local one. */
  merged = $state<readonly IdentityFixture[]>([])
  /** Remote identities joined and kept separate. */
  separate = $state<readonly IdentityFixture[]>([])
  providerHolds = $state<ProviderHolds>(ProviderHolds.Identities)
  passkeyFit = $state<PasskeyFit>(PasskeyFit.Opens)
  synced = $state(false)

  go(to: KeyState): void {
    this.current = to
    if (!this.visited.includes(to)) this.visited = [...this.visited, to]
  }

  reset(): void {
    this.current = KeyState.Empty
    this.visited = [KeyState.Empty]
    this.hasLocal = false
    this.chosen = work
    this.merged = []
    this.separate = []
    this.synced = false
  }

  /** Every key that opens the local identity: its own passkey, plus the keys
   * of every identity merged into it. */
  localKeys(): readonly KeyFixture[] {
    return [thisBrowserPasskey, ...this.merged.flatMap((identity) => identity.keys)]
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
