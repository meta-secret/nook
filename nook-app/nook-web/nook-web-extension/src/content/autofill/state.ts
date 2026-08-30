import type { AuthenticationPageObservationFacts } from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import type { PasswordFormObservation } from '../../../../nook-web-shared/src/extension/password-forms'
import type { WebsiteLoginSaveOfferView } from '../../lib/login-save-messages'
import type { AuthenticationWorkflowApproval } from '../../lib/auth-workflow-messages'

export type WidgetPosition = { left: number; top: number }

type PendingAuthenticatorPicker = {
  requestId: string
  workflow: PasswordFormObservation
  step: HTMLParagraphElement
  title: HTMLHeadingElement
  description: HTMLParagraphElement
  continueButton: HTMLButtonElement
  timeoutId: number
  approval: AuthenticationWorkflowApproval
}

type PendingLoginPicker = PendingAuthenticatorPicker
export enum ScanScheduleKind {
  Idle = 'idle',
  Scheduled = 'scheduled',
}

export type ScanSchedule =
  | { kind: ScanScheduleKind.Idle }
  | { kind: ScanScheduleKind.Scheduled; timer: number }
export type AuthenticationScanMutationBatch = MutationRecord[]
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
      facts: AuthenticationPageObservationFacts
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

class ScanState {
  private currentSchedule: ScanSchedule = { kind: ScanScheduleKind.Idle }
  private scheduleStartedAt = 0
  sequence = 0
  schedule: (mutations?: AuthenticationScanMutationBatch) => void = () => {}
  get scheduleState(): ScanSchedule {
    return this.currentSchedule
  }
  remainingScanDelay(debounceMs: number): number {
    if (this.currentSchedule.kind !== ScanScheduleKind.Scheduled) {
      this.scheduleStartedAt = Date.now()
      return debounceMs
    }
    return Math.max(0, debounceMs - (Date.now() - this.scheduleStartedAt))
  }
  scheduleTimer(timer: number): void {
    this.currentSchedule = { kind: ScanScheduleKind.Scheduled, timer }
  }
  clearPendingTimer(): void {
    this.currentSchedule = { kind: ScanScheduleKind.Idle }
    this.scheduleStartedAt = 0
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
export const widgetState = new WidgetState()
export const saveOfferState = new SaveOfferState()
export const pickerState = new PickerState()
