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
type ScanSchedule = { kind: 'idle' } | { kind: 'scheduled'; timer: number }
type WidgetHost =
  | { kind: 'detached' }
  | { kind: 'attached'; element: HTMLElement }
type WidgetWorkflowKey =
  | { kind: 'unassigned' }
  | { kind: 'assigned'; key: string }
type WidgetWorkflowRoot =
  | { kind: 'unassigned' }
  | { kind: 'assigned'; observation: PasswordFormObservation }
type WidgetPlacement =
  | { kind: 'unpositioned' }
  | { kind: 'positioned'; position: WidgetPosition }
type SaveOfferDisplay =
  | { kind: 'hidden' }
  | { kind: 'visible'; offer: WebsiteLoginSaveOfferView }
type SavePageWatch =
  | { kind: 'idle' }
  | { kind: 'watching'; watch: PendingSaveWatch }
type AuthenticatorPicker =
  | { kind: 'closed' }
  | { kind: 'open'; request: PendingAuthenticatorPicker }
type LoginPicker =
  | { kind: 'closed' }
  | { kind: 'open'; request: PendingLoginPicker }
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
    if (this.scheduleState.kind === 'scheduled') {
      return this.scheduleState.timer
    }
    return
  }
  get scanScheduled(): boolean {
    return this.scheduleState.kind === 'scheduled'
  }
  set pendingTimer(value: number) {
    this.scheduleState = { kind: 'scheduled', timer: value }
  }
  clearPendingTimer(): void {
    this.scheduleState = { kind: 'idle' }
  }
}

class WidgetState {
  private hostState: WidgetHost = { kind: 'detached' }
  private workflowKeyState: WidgetWorkflowKey = { kind: 'unassigned' }
  private workflowRootState: WidgetWorkflowRoot = { kind: 'unassigned' }
  private placementState: WidgetPlacement = { kind: 'unpositioned' }
  dismissed = false
  busy = false
  collapsed = false
  get host(): HTMLElement | void {
    if (this.hostState.kind === 'attached') return this.hostState.element
    return
  }
  set host(value: HTMLElement) {
    this.hostState = { kind: 'attached', element: value }
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
    if (this.placementState.kind === 'positioned') {
      return this.placementState.position
    }
    return
  }
  set position(value: WidgetPosition) {
    this.placementState = { kind: 'positioned', position: value }
  }
  clearRenderedWidget(): void {
    this.hostState = { kind: 'detached' }
    this.workflowKeyState = { kind: 'unassigned' }
    this.workflowRootState = { kind: 'unassigned' }
  }
}

class SaveOfferState {
  private offerState: SaveOfferDisplay = { kind: 'hidden' }
  private watchState: SavePageWatch = { kind: 'idle' }
  confirmationActive = false
  dismissedOfferIds = new Set<string>()
  get activeOffer(): WebsiteLoginSaveOfferView | void {
    if (this.offerState.kind === 'visible') return this.offerState.offer
    return
  }
  set activeOffer(value: WebsiteLoginSaveOfferView) {
    this.offerState = { kind: 'visible', offer: value }
  }
  get pendingWatch(): PendingSaveWatch | void {
    if (this.watchState.kind === 'watching') return this.watchState.watch
    return
  }
  set pendingWatch(value: PendingSaveWatch) {
    this.watchState = { kind: 'watching', watch: value }
  }
  clearActiveOffer(): void {
    this.offerState = { kind: 'hidden' }
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
