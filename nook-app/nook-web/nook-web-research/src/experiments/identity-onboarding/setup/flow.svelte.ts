import {
  FolderHolds,
  MemberOf,
  PasskeyChoice,
  Step,
  existingEvents,
  family,
  folderIdentities,
  newEvents,
  steps,
  work,
  type Identity,
} from './model'

/** The prototype's state: the step and the path to it, the passkey and the
 * provider set up so far, the identity chosen, and the simulator's answers. */
export class SetupFlow {
  step = $state<Step>(Step.Start)
  visited = $state<readonly Step[]>([Step.Start])
  history = $state<readonly Step[]>([Step.Start])
  cursor = $state(0)

  memberOf = $state<MemberOf>(MemberOf.Work)
  holds = $state<FolderHolds>(FolderHolds.Identities)

  /** A passkey is set up on this browser. */
  passkey = $state(false)
  choice = $state<PasskeyChoice>(PasskeyChoice.New)
  /** Google Drive is connected. */
  connected = $state(false)
  /** The identity setup finishes with. */
  identity = $state<Identity>(work)
  /** The identity is new, created in Drive during setup. */
  created = $state(false)
  newName = $state('')

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

  /** Jump from the rail with what the step needs set up before it. */
  jump(to: Step): void {
    const reached = this.stageOf(to)
    if (reached < 2) this.passkey = false
    else if (!this.passkey) this.usePasskey(PasskeyChoice.Existing)
    this.connected = reached >= 3
    if (to === Step.Join) this.identity = family
    if (to === Step.Sync && !this.created) this.identity = work
    this.go(to)
  }

  reset(): void {
    this.passkey = false
    this.connected = false
    this.identity = work
    this.created = false
    this.newName = ''
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

  stageOf(step: Step): number {
    for (const node of steps) if (node.step === step) return node.stage
    return 0
  }

  usePasskey(choice: PasskeyChoice): void {
    this.choice = choice
    this.passkey = true
  }

  /** What the Nook folder in Drive holds. */
  found(): readonly Identity[] {
    return this.holds === FolderHolds.Identities ? folderIdentities : []
  }

  /** The passkey chosen in step two is one of this identity's keys. A new
   * passkey is a member of nothing. */
  isMember(identity: Identity): boolean {
    return (
      this.choice === PasskeyChoice.Existing &&
      this.memberOf === MemberOf.Work &&
      identity.id === work.id
    )
  }

  /** Finish setup on an identity that exists: a member's or a joined one. */
  finish(identity: Identity): void {
    this.identity = identity
    this.created = false
    this.go(Step.Sync)
  }

  /** Finish setup on a new identity under the name chosen. */
  createIdentity(): void {
    const identity: Identity = {
      id: 'idn_new',
      name: this.newName,
      words: 'spoon-river-calm',
      devices: 1,
    }
    this.identity = identity
    this.created = true
    this.go(Step.Sync)
  }

  events(): number {
    return this.created ? newEvents : existingEvents
  }
}
