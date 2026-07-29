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
export enum WidgetWorkflowRootKind {
  Unassigned = 'unassigned',
  Assigned = 'assigned',
}

export type WidgetWorkflowRoot =
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
  private scheduleState: ScanSchedule = { kind: ScanScheduleKind.Idle }
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
    this.scheduleState = { kind: ScanScheduleKind.Idle }
  }
}

class WidgetState {
  private hostState: WidgetHost = { kind: WidgetHostKind.Detached }
  private workflowKeyState: WidgetWorkflowKey = {
    kind: WidgetWorkflowKeyKind.Unassigned,
  }
  private workflowRootState: WidgetWorkflowRoot = {
    kind: WidgetWorkflowRootKind.Unassigned,
  }
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
    if (this.workflowKeyState.kind === WidgetWorkflowKeyKind.Assigned) {
      return this.workflowKeyState.key
    }
    return
  }
  set renderedWorkflowKey(value: string) {
    this.workflowKeyState = {
      kind: WidgetWorkflowKeyKind.Assigned,
      key: value,
    }
  }
  get renderedWorkflowRoot(): WidgetWorkflowRoot {
    return this.workflowRootState
  }
  set renderedWorkflowRoot(value: WidgetWorkflowRoot) {
    this.workflowRootState = value
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
    this.workflowKeyState = { kind: WidgetWorkflowKeyKind.Unassigned }
    this.workflowRootState = { kind: WidgetWorkflowRootKind.Unassigned }
  }
}

class SaveOfferState {
  private offerState: SaveOfferDisplay = { kind: SaveOfferDisplayKind.Hidden }
  private watchState: SavePageWatch = { kind: SavePageWatchKind.Idle }
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
    this.watchState = { kind: SavePageWatchKind.Idle }
  }
}

class PickerState {
  private authenticatorState: AuthenticatorPicker = {
    kind: AuthenticatorPickerKind.Closed,
  }
  private loginState: LoginPicker = { kind: LoginPickerKind.Closed }
  get pendingAuthenticator(): PendingAuthenticatorPicker | void {
    if (this.authenticatorState.kind === AuthenticatorPickerKind.Open) {
      return this.authenticatorState.request
    }
    return
  }
  set pendingAuthenticator(value: PendingAuthenticatorPicker) {
    this.authenticatorState = {
      kind: AuthenticatorPickerKind.Open,
      request: value,
    }
  }
  get pendingLogin(): PendingLoginPicker | void {
    if (this.loginState.kind === LoginPickerKind.Open)
      return this.loginState.request
    return
  }
  set pendingLogin(value: PendingLoginPicker) {
    this.loginState = { kind: LoginPickerKind.Open, request: value }
  }
  clearPendingAuthenticator(): void {
    this.authenticatorState = { kind: AuthenticatorPickerKind.Closed }
  }
  clearPendingLogin(): void {
    this.loginState = { kind: LoginPickerKind.Closed }
  }
}

export const scanState = new ScanState()
export const widgetState = new WidgetState()
export const saveOfferState = new SaveOfferState()
export const pickerState = new PickerState()
