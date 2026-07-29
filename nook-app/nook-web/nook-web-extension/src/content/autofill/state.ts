import type { PasswordFormObservation } from '../../../../nook-web-shared/src/extension/password-forms'
import type { WebsiteLoginSaveOfferView } from '../../lib/login-save-messages'

export type WidgetPosition = { left: number; top: number }

type PendingAuthenticatorPicker = {
  requestId: string
  workflow: PasswordFormObservation
  step: HTMLParagraphElement
  title: HTMLHeadingElement
  description: HTMLParagraphElement
  continueButton: HTMLButtonElement
  timeoutId: number
}

type PendingLoginPicker = PendingAuthenticatorPicker
enum ScanScheduleKind {
  Idle = 'idle',
  Scheduled = 'scheduled',
}

type ScanSchedule =
  | { kind: ScanScheduleKind.Idle }
  | { kind: ScanScheduleKind.Scheduled; timer: number }
enum WidgetHostKind {
  Detached = 'detached',
  Attached = 'attached',
}

type WidgetHost =
  | { kind: WidgetHostKind.Detached }
  | { kind: WidgetHostKind.Attached; element: HTMLElement }
enum WidgetWorkflowKeyKind {
  Unassigned = 'unassigned',
  Assigned = 'assigned',
}

type WidgetWorkflowKey =
  | { kind: WidgetWorkflowKeyKind.Unassigned }
  | { kind: WidgetWorkflowKeyKind.Assigned; key: string }
enum WidgetWorkflowRootKind {
  Unassigned = 'unassigned',
  Assigned = 'assigned',
}

type WidgetWorkflowRoot =
  | { kind: WidgetWorkflowRootKind.Unassigned }
  | {
      kind: WidgetWorkflowRootKind.Assigned
      observation: PasswordFormObservation
    }
enum WidgetPlacementKind {
  Unpositioned = 'unpositioned',
  Positioned = 'positioned',
}

type WidgetPlacement =
  | { kind: WidgetPlacementKind.Unpositioned }
  | { kind: WidgetPlacementKind.Positioned; position: WidgetPosition }
enum SaveOfferDisplayKind {
  Hidden = 'hidden',
  Visible = 'visible',
}

type SaveOfferDisplay =
  | { kind: SaveOfferDisplayKind.Hidden }
  | { kind: SaveOfferDisplayKind.Visible; offer: WebsiteLoginSaveOfferView }
enum SavePageWatchKind {
  Idle = 'idle',
  Watching = 'watching',
}

type SavePageWatch =
  | { kind: SavePageWatchKind.Idle }
  | { kind: SavePageWatchKind.Watching; watch: PendingSaveWatch }
enum AuthenticatorPickerKind {
  Closed = 'closed',
  Open = 'open',
}

type AuthenticatorPicker =
  | { kind: AuthenticatorPickerKind.Closed }
  | { kind: AuthenticatorPickerKind.Open; request: PendingAuthenticatorPicker }
enum LoginPickerKind {
  Closed = 'closed',
  Open = 'open',
}

type LoginPicker =
  | { kind: LoginPickerKind.Closed }
  | { kind: LoginPickerKind.Open; request: PendingLoginPicker }
type PendingSaveWatch = {
  offer: WebsiteLoginSaveOfferView
  startedAt: number
  authPath: string
  sawMutation: boolean
  timer?: number
  observer?: MutationObserver
}

class ScanState {
  private scheduleState: ScanSchedule = { kind: 'idle' }
  sequence = 0
  schedule: () => void = () => {}
  get pendingTimer(): number | void {
    if (this.scheduleState.kind === ScanScheduleKind.Scheduled) {
      return this.scheduleState.timer
    }
    return
  }
  get scanScheduled(): boolean {
    return this.scheduleState.kind === ScanScheduleKind.Scheduled
  }
  set pendingTimer(value: number) {
    this.scheduleState = { kind: ScanScheduleKind.Scheduled, timer: value }
  }
  clearPendingTimer(): void {
    this.scheduleState = { kind: 'idle' }
  }
}

class WidgetState {
  private hostState: WidgetHost = { kind: WidgetHostKind.Detached }
  private workflowKeyState: WidgetWorkflowKey = { kind: 'unassigned' }
  private workflowRootState: WidgetWorkflowRoot = { kind: 'unassigned' }
  private placementState: WidgetPlacement = {
    kind: WidgetPlacementKind.Unpositioned,
  }
  dismissed = false
  busy = false
  collapsed = false
  get host(): HTMLElement | void {
    if (this.hostState.kind === WidgetHostKind.Attached)
      return this.hostState.element
    return
  }
  set host(value: HTMLElement) {
    this.hostState = { kind: WidgetHostKind.Attached, element: value }
  }
  get renderedWorkflowKey(): string | void {
    if (this.workflowKeyState.kind === 'assigned') {
      return this.workflowKeyState.key
    }
    return
  }
  set renderedWorkflowKey(value: string) {
    this.workflowKeyState = { kind: 'assigned', key: value }
  }
  get renderedWorkflowRoot(): PasswordFormObservation | void {
    if (this.workflowRootState.kind === 'assigned') {
      return this.workflowRootState.observation
    }
    return
  }
  set renderedWorkflowRoot(value: PasswordFormObservation) {
    this.workflowRootState = { kind: 'assigned', observation: value }
  }
  get position(): WidgetPosition | void {
    if (this.placementState.kind === WidgetPlacementKind.Positioned) {
      return this.placementState.position
    }
    return
  }
  set position(value: WidgetPosition) {
    this.placementState = {
      kind: WidgetPlacementKind.Positioned,
      position: value,
    }
  }
  clearRenderedWidget(): void {
    this.hostState = { kind: WidgetHostKind.Detached }
    this.workflowKeyState = { kind: 'unassigned' }
    this.workflowRootState = { kind: 'unassigned' }
  }
}

class SaveOfferState {
  private offerState: SaveOfferDisplay = { kind: SaveOfferDisplayKind.Hidden }
  private watchState: SavePageWatch = { kind: 'idle' }
  confirmationActive = false
  dismissedOfferIds = new Set<string>()
  get activeOffer(): WebsiteLoginSaveOfferView | void {
    if (this.offerState.kind === SaveOfferDisplayKind.Visible)
      return this.offerState.offer
    return
  }
  set activeOffer(value: WebsiteLoginSaveOfferView) {
    this.offerState = { kind: SaveOfferDisplayKind.Visible, offer: value }
  }
  get pendingWatch(): PendingSaveWatch | void {
    if (this.watchState.kind === SavePageWatchKind.Watching)
      return this.watchState.watch
    return
  }
  set pendingWatch(value: PendingSaveWatch) {
    this.watchState = { kind: SavePageWatchKind.Watching, watch: value }
  }
  clearActiveOffer(): void {
    this.offerState = { kind: SaveOfferDisplayKind.Hidden }
  }
  clearPendingWatch(): void {
    this.watchState = { kind: 'idle' }
  }
}

class PickerState {
  private authenticatorState: AuthenticatorPicker = { kind: 'closed' }
  private loginState: LoginPicker = { kind: 'closed' }
  get pendingAuthenticator(): PendingAuthenticatorPicker | void {
    if (this.authenticatorState.kind === 'open') {
      return this.authenticatorState.request
    }
    return
  }
  set pendingAuthenticator(value: PendingAuthenticatorPicker) {
    this.authenticatorState = { kind: 'open', request: value }
  }
  get pendingLogin(): PendingLoginPicker | void {
    if (this.loginState.kind === 'open') return this.loginState.request
    return
  }
  set pendingLogin(value: PendingLoginPicker) {
    this.loginState = { kind: 'open', request: value }
  }
  clearPendingAuthenticator(): void {
    this.authenticatorState = { kind: 'closed' }
  }
  clearPendingLogin(): void {
    this.loginState = { kind: 'closed' }
  }
}

export const scanState = new ScanState()
export const widgetState = new WidgetState()
export const saveOfferState = new SaveOfferState()
export const pickerState = new PickerState()
