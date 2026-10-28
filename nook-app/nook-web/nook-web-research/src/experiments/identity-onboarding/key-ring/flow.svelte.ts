import {
  Branch,
  KeyKind,
  ProviderHolds,
  Standing,
  Step,
  askingDevices,
  browserKey,
  laptop,
  providerIdentities,
  providers,
  steps,
  type Identity,
  type Key,
} from './model'

/** The prototype's state: the step and the path to it, your identity and
 * its keys, the sync provider and what it holds, and the simulator. */
export class KeyRingFlow {
  step = $state<Step>(Step.Start)
  visited = $state<readonly Step[]>([Step.Start])
  history = $state<readonly Step[]>([Step.Start])
  cursor = $state(0)

  holds = $state<ProviderHolds>(ProviderHolds.Yours)

  /** Your identity exists on this browser. */
  ready = $state(false)
  name = $state('Personal')
  words = $state('spoon-river-calm')
  keys = $state<readonly Key[]>([])
  /** The provider identity you are, when you imported it. */
  selfId = $state('')
  /** Provider identities merged into yours. */
  merged = $state<readonly string[]>([])
  /** Devices asking to join yours. */
  requests = $state<readonly Key[]>([])
  private asked = 0

  /** The sync provider; empty while there is none. */
  provider = $state('')
  /** Your identity is saved to the provider. */
  saved = $state(false)
  /** What the provider held when it was connected. */
  onProvider = $state<readonly Identity[]>([])
  private standings = $state<readonly { readonly id: string; readonly standing: Standing }[]>([])
  /** The provider identity this browser asked to join. */
  joining = $state<Identity>(laptop)

  go(to: Step): void {
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

  /** Jump from the map with the context the step needs: onboarding starts
   * with nothing, the ring has an identity, and provider steps a provider. */
  jump(to: Step): void {
    const ring = steps.some((node) => node.step === to && node.branch === Branch.Ring)
    if (!ring) this.forget()
    else if (!this.ready) this.create()
    if ((to === Step.Found || to === Step.Waiting || to === Step.Provider) && !this.provider) {
      this.connect(providers[0])
    }
    if (to === Step.Waiting) this.askToJoin(laptop)
    this.go(to)
  }

  reset(): void {
    this.forget()
    this.step = Step.Start
    this.history = [Step.Start]
    this.cursor = 0
    this.visited = [Step.Start]
  }

  private showAtCursor(): void {
    const step = this.history.at(this.cursor)
    if (step) this.show(step)
  }

  private show(step: Step): void {
    this.step = step
    if (!this.visited.includes(step)) this.visited = [...this.visited, step]
  }

  private forget(): void {
    this.ready = false
    this.name = 'Personal'
    this.keys = []
    this.selfId = ''
    this.merged = []
    this.requests = []
    this.provider = ''
    this.saved = false
    this.onProvider = []
    this.standings = []
  }

  /** Sign in to a provider and read what it holds. With nothing else on it,
   * an existing identity is saved there at once. */
  connect(provider: string): void {
    this.provider = provider
    this.standings = []
    this.onProvider = this.holds === ProviderHolds.Nothing ? [] : providerIdentities
    this.saved = this.ready && this.onProvider.length === 0
  }

  standing(identity: Identity): Standing {
    for (const entry of this.standings) {
      if (entry.id === identity.id) return entry.standing
    }
    return Standing.Unknown
  }

  private stand(identity: Identity, standing: Standing): void {
    this.standings = [
      ...this.standings.filter((entry) => entry.id !== identity.id),
      { id: identity.id, standing },
    ]
  }

  /** Try your passkey on it; the simulator decides whether it is yours. */
  unlock(identity: Identity): void {
    const first = providerIdentities.findIndex((entry) => entry.id === identity.id) === 0
    const yours = this.holds === ProviderHolds.Yours && first
    this.stand(identity, yours ? Standing.Yours : Standing.Locked)
  }

  askToJoin(identity: Identity): void {
    this.joining = identity
    this.stand(identity, Standing.Asked)
  }

  /** A device of the identity this browser asked to join approves it. */
  approved(): void {
    this.stand(this.joining, Standing.Yours)
  }

  /** A new identity whose one key is this browser's passkey. */
  create(): void {
    this.ready = true
    this.selfId = ''
    this.words = 'spoon-river-calm'
    this.keys = [browserKey]
    this.saved = this.provider !== ''
  }

  /** Import: the provider identity is yours, and this browser's passkey
   * joins its keys. */
  adopt(identity: Identity): void {
    this.ready = true
    this.selfId = identity.id
    this.name = identity.name || identity.words
    this.words = identity.words
    this.keys = [...identity.keys, browserKey]
    this.saved = true
  }

  /** Another identity of yours folds into this one: the name stays, its keys
   * join the ring, and yours is saved to the provider. */
  merge(identity: Identity): void {
    this.keys = [...this.keys, ...identity.keys]
    this.merged = [...this.merged, identity.id]
    this.saved = true
  }

  /** Provider identities that are neither you nor merged into you. */
  others(): readonly Identity[] {
    return this.onProvider.filter(
      (identity) => identity.id !== this.selfId && !this.merged.includes(identity.id),
    )
  }

  addKey(key: Key): void {
    this.keys = [...this.keys, key]
  }

  /** The simulator: another device asks to join your identity. */
  deviceAsks(): void {
    const device = askingDevices[this.asked % askingDevices.length]
    this.requests = [
      ...this.requests,
      { id: `key_asking_${this.asked}`, kind: KeyKind.Device, device: device || 'Device', here: false },
    ]
    this.asked += 1
  }

  answer(key: Key, approve: boolean): void {
    this.requests = this.requests.filter((request) => request.id !== key.id)
    if (approve) this.addKey(key)
  }
}
