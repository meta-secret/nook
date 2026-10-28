import { thisBrowserPasskey, work, type IdentityFixture, type KeyFixture } from '../key-machine/machine'
import { ProviderHolds, RingGroup, RingState, Standing, askingDevices, found, ring } from './ring'

/** The prototype's state: where the ring is, your identity and its keys,
 * the provider and what it holds, and the simulator's answers. */
export class RingFlow {
  current = $state<RingState>(RingState.Start)
  visited = $state<readonly RingState[]>([RingState.Start])
  history = $state<readonly RingState[]>([RingState.Start])
  cursor = $state(0)

  holds = $state<ProviderHolds>(ProviderHolds.Yours)
  /** The sync provider; empty while this browser is the only place. */
  provider = $state('')
  /** Your identity is saved to the provider. */
  saved = $state(false)
  /** The provider's identities, as found when it was connected. */
  onProvider = $state<readonly IdentityFixture[]>([])
  standings = $state<Readonly<Record<string, Standing>>>({})

  /** Your identity exists on this browser. */
  ready = $state(false)
  /** The provider identity you are, when onboarding found you there. */
  selfId = $state('')
  name = $state('Personal')
  words = $state('spoon-river-calm')
  keys = $state<readonly KeyFixture[]>([])
  /** Provider identities merged into yours. */
  merged = $state<readonly string[]>([])
  /** Devices asking to join yours, not yet answered. */
  requests = $state<readonly KeyFixture[]>([])
  private asked = 0
  /** The identity this browser asked to join. */
  joining = $state<IdentityFixture>(work)

  go(to: RingState): void {
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

  /** Jump from the map with the context the state needs: the key ring has an
   * identity, onboarding has none yet. */
  jump(to: RingState): void {
    const onboarding = ring.some((node) => node.state === to && node.group === RingGroup.Onboarding)
    if (onboarding) this.forget()
    else if (!this.ready) this.create()
    this.go(to)
  }

  private showAtCursor(): void {
    const state = this.history.at(this.cursor)
    if (state) this.show(state)
  }

  private show(state: RingState): void {
    this.current = state
    if (!this.visited.includes(state)) this.visited = [...this.visited, state]
  }

  reset(): void {
    this.forget()
    this.current = RingState.Start
    this.history = [RingState.Start]
    this.cursor = 0
    this.visited = [RingState.Start]
  }

  private forget(): void {
    this.ready = false
    this.selfId = ''
    this.name = 'Personal'
    this.keys = []
    this.merged = []
    this.requests = []
    this.provider = ''
    this.saved = false
    this.onProvider = []
    this.standings = {}
  }

  /** Point at a provider and read what it holds. Your identity is saved
   * there at once only when there is nothing else to decide. */
  connect(provider: string): void {
    this.provider = provider
    this.standings = {}
    this.onProvider = this.holds === ProviderHolds.Nothing ? [] : found
    this.saved = this.ready && this.onProvider.length === 0
  }

  standing(identity: IdentityFixture): Standing {
    for (const [id, standing] of Object.entries(this.standings)) {
      if (id === identity.id) return standing
    }
    return Standing.Unknown
  }

  private stand(identity: IdentityFixture, standing: Standing): void {
    this.standings = { ...this.standings, [identity.id]: standing }
  }

  /** Try your passkey on it; the simulator decides whether it is yours. */
  unlock(identity: IdentityFixture): void {
    const first = found.findIndex((entry) => entry.id === identity.id) === 0
    const yours = this.holds === ProviderHolds.Yours && first
    this.stand(identity, yours ? Standing.Yours : Standing.Locked)
  }

  askToJoin(identity: IdentityFixture): void {
    this.joining = identity
    this.stand(identity, Standing.Asked)
  }

  /** A device of the identity this browser asked to join approves it. */
  approved(): void {
    this.stand(this.joining, Standing.Yours)
  }

  /** A new identity with one key: this browser's passkey. */
  create(): void {
    this.ready = true
    this.selfId = ''
    this.words = 'spoon-river-calm'
    this.keys = [thisBrowserPasskey]
    this.saved = this.provider !== ''
  }

  /** Onboarding found you on the provider: that identity is yours, and this
   * browser's passkey joins its keys. */
  adopt(identity: IdentityFixture): void {
    this.ready = true
    this.selfId = identity.id
    this.name = identity.name || identity.words
    this.words = identity.words
    this.keys = [...identity.keys, thisBrowserPasskey]
    this.saved = true
  }

  /** Another identity of yours folds into this one: you keep your name, and
   * its keys join your ring. */
  merge(identity: IdentityFixture): void {
    this.keys = [...this.keys, ...identity.keys]
    this.merged = [...this.merged, identity.id]
    this.saved = true
  }

  /** Provider identities that are neither you nor merged into you. */
  others(): readonly IdentityFixture[] {
    return this.onProvider.filter(
      (identity) => identity.id !== this.selfId && !this.merged.includes(identity.id),
    )
  }

  addKey(key: KeyFixture): void {
    this.keys = [...this.keys, key]
  }

  /** The simulator: another device asks to join your identity. */
  deviceAsks(): void {
    const label = askingDevices[this.asked % askingDevices.length]
    this.requests = [
      ...this.requests,
      { id: `device_ask_${this.asked}`, kind: 'device', label: `${label} · device key`, here: false },
    ]
    this.asked += 1
  }

  answer(key: KeyFixture, approve: boolean): void {
    this.requests = this.requests.filter((request) => request.id !== key.id)
    if (approve) this.addKey(key)
  }
}
