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
type ScanTimerFactory = () => number
export enum ScanScheduleKind {
  Idle = 'idle',
  Scheduled = 'scheduled',
}

export enum ScanActivityKind {
  Idle = 'idle',
  Running = 'running',
}

export type ScanSchedule =
  | { kind: ScanScheduleKind.Idle }
  | { kind: ScanScheduleKind.Scheduled; timer: number }
export enum WidgetHostKind {
  Detached = 'detached',
  Attached = 'attached',
}

export type WidgetHost =
  | { kind: WidgetHostKind.Detached }
  | { kind: WidgetHostKind.Attached; element: HTMLElement }
export enum WidgetWorkflowKeyKind {
  Unassigned = 'unassigned',
  Assigned = 'assigned',
}

export type WidgetWorkflowKey =
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
export enum WidgetPlacementKind {
  Unpositioned = 'unpositioned',
  Positioned = 'positioned',
}

export type WidgetPlacement =
  | { kind: WidgetPlacementKind.Unpositioned }
  | { kind: WidgetPlacementKind.Positioned; position: WidgetPosition }
export enum SaveOfferDisplayKind {
  Hidden = 'hidden',
  Visible = 'visible',
}

export type SaveOfferDisplay =
  | { kind: SaveOfferDisplayKind.Hidden }
  | { kind: SaveOfferDisplayKind.Visible; offer: WebsiteLoginSaveOfferView }
export enum SavePageWatchKind {
  Idle = 'idle',
  Watching = 'watching',
}

export type SavePageWatch =
  | { kind: SavePageWatchKind.Idle }
  | { kind: SavePageWatchKind.Watching; watch: PendingSaveWatch }
export enum AuthenticatorPickerKind {
  Closed = 'closed',
  Open = 'open',
}

export type AuthenticatorPicker =
  | { kind: AuthenticatorPickerKind.Closed }
  | { kind: AuthenticatorPickerKind.Open; request: PendingAuthenticatorPicker }
export enum LoginPickerKind {
  Closed = 'closed',
  Open = 'open',
}

export type LoginPicker =
  | { kind: LoginPickerKind.Closed }
  | { kind: LoginPickerKind.Open; request: PendingLoginPicker }
export type PendingSaveWatch = {
  offer: WebsiteLoginSaveOfferView
  startedAt: number
  authPath: string
  sawMutation: boolean
  timer?: number
  observer?: MutationObserver
}

export class ScanState {
  private currentSchedule: ScanSchedule = { kind: ScanScheduleKind.Idle }
  private currentActivity = ScanActivityKind.Idle
  private followUpRequested = false
  sequence = 0
  schedule: () => void = () => {}
  get scheduleState(): ScanSchedule {
    return this.currentSchedule
  }
  scheduleTimer(createTimer: ScanTimerFactory): boolean {
    if (this.currentSchedule.kind === ScanScheduleKind.Scheduled) return false
    this.currentSchedule = {
      kind: ScanScheduleKind.Scheduled,
      timer: createTimer(),
    }
    return true
  }
  clearPendingTimer(): void {
    this.currentSchedule = { kind: ScanScheduleKind.Idle }
  }
  beginScan(): boolean {
    if (this.currentActivity === ScanActivityKind.Running) {
      this.followUpRequested = true
      return false
    }
    this.currentActivity = ScanActivityKind.Running
    return true
  }
  requestFollowUpIfRunning(): boolean {
    if (this.currentActivity === ScanActivityKind.Idle) return false
    if (!this.followUpRequested) this.sequence += 1
    this.followUpRequested = true
    return true
  }
  invalidateCurrentResult(): void {
    this.sequence += 1
  }
  finishScan(): boolean {
    this.currentActivity = ScanActivityKind.Idle
    const shouldRunFollowUp = this.followUpRequested
    this.followUpRequested = false
    return shouldRunFollowUp
  }
}

export class AuthenticationActionState {
  private generation = 0
  begin(): number {
    this.generation += 1
    return this.generation
  }
  invalidate(): void {
    this.generation += 1
  }
  isCurrent(candidate: number): boolean {
    return candidate === this.generation
  }
}

export class WidgetState {
  private hostState: WidgetHost = { kind: WidgetHostKind.Detached }
  private workflowKeyState: WidgetWorkflowKey = {
    kind: WidgetWorkflowKeyKind.Unassigned,
  }
  private workflowRootState: WidgetWorkflowRoot = {
    kind: WidgetWorkflowRootKind.Unassigned,
  }
  private presentationScopeState: WidgetWorkflowKey = {
    kind: WidgetWorkflowKeyKind.Unassigned,
  }
  private placementState: WidgetPlacement = {
    kind: WidgetPlacementKind.Unpositioned,
  }
  dismissed = false
  busy = false
  private collapsedState = false
  private collapseWasSelectedByUser = false
  get collapsed(): boolean {
    return this.collapsedState
  }
  applyAutomaticCollapse(value: boolean): void {
    if (!this.collapseWasSelectedByUser) this.collapsedState = value
  }
  beginEnrollmentWorkflow(presentationScope: string): void {
    const continuesSamePresentation =
      this.presentationScopeState.kind === WidgetWorkflowKeyKind.Assigned &&
      this.presentationScopeState.key === presentationScope
    if (!continuesSamePresentation) {
      this.collapsedState = false
      this.collapseWasSelectedByUser = false
    }
    this.assignPresentationScope(presentationScope)
  }
  collapseByUser(): void {
    this.collapseWasSelectedByUser = true
    this.collapsedState = true
  }
  expandByUser(): void {
    this.collapseWasSelectedByUser = true
    this.collapsedState = false
  }
  get host(): WidgetHost {
    return this.hostState
  }
  attachHost(element: HTMLElement): void {
    this.hostState = { kind: WidgetHostKind.Attached, element }
  }
  get workflowKey(): WidgetWorkflowKey {
    return this.workflowKeyState
  }
  assignWorkflowKey(value: string): void {
    this.workflowKeyState = {
      kind: WidgetWorkflowKeyKind.Assigned,
      key: value,
    }
  }
  get presentationScope(): WidgetWorkflowKey {
    return this.presentationScopeState
  }
  assignPresentationScope(value: string): void {
    this.presentationScopeState = {
      kind: WidgetWorkflowKeyKind.Assigned,
      key: value,
    }
  }
  get renderedWorkflowRoot(): WidgetWorkflowRoot {
    return this.workflowRootState
  }
  setRenderedWorkflowRoot(value: WidgetWorkflowRoot): void {
    this.workflowRootState = value
  }
  get placement(): WidgetPlacement {
    return this.placementState
  }
  setPosition(value: WidgetPosition): void {
    this.placementState = {
      kind: WidgetPlacementKind.Positioned,
      position: value,
    }
  }
  detachRenderedWidget(): void {
    this.hostState = { kind: WidgetHostKind.Detached }
    this.workflowKeyState = { kind: WidgetWorkflowKeyKind.Unassigned }
    this.workflowRootState = { kind: WidgetWorkflowRootKind.Unassigned }
  }
  clearRenderedWidget(): void {
    this.detachRenderedWidget()
    this.presentationScopeState = { kind: WidgetWorkflowKeyKind.Unassigned }
    this.collapsedState = false
    this.collapseWasSelectedByUser = false
  }
}

type InvalidateAuthenticationActionContextArgs = {
  actionState: AuthenticationActionState
  widget: WidgetState
}

export function invalidateAuthenticationActionContext({
  actionState,
  widget,
}: InvalidateAuthenticationActionContextArgs): void {
  actionState.invalidate()
  widget.busy = false
}

class SaveOfferState {
  private offerState: SaveOfferDisplay = { kind: SaveOfferDisplayKind.Hidden }
  private watchState: SavePageWatch = { kind: SavePageWatchKind.Idle }
  confirmationActive = false
  dismissedOfferIds = new Set<string>()
  get display(): SaveOfferDisplay {
    return this.offerState
  }
  showOffer(value: WebsiteLoginSaveOfferView): void {
    this.offerState = { kind: SaveOfferDisplayKind.Visible, offer: value }
  }
  get watch(): SavePageWatch {
    return this.watchState
  }
  watchPage(value: PendingSaveWatch): void {
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
  get authenticator(): AuthenticatorPicker {
    return this.authenticatorState
  }
  openAuthenticator(value: PendingAuthenticatorPicker): void {
    this.authenticatorState = {
      kind: AuthenticatorPickerKind.Open,
      request: value,
    }
  }
  get login(): LoginPicker {
    return this.loginState
  }
  openLogin(value: PendingLoginPicker): void {
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
export const authenticationActionState = new AuthenticationActionState()
export const widgetState = new WidgetState()
export const saveOfferState = new SaveOfferState()
export const pickerState = new PickerState()
