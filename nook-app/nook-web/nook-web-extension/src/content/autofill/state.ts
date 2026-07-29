import {
  EMPTY_VALUE,
  presentValue,
  type ValueState,
} from '../../../../nook-web-shared/src/explicit-state'
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
type PendingSaveWatch = {
  offer: WebsiteLoginSaveOfferView
  startedAt: number
  authPath: string
  sawMutation: boolean
  timer?: number
  observer?: MutationObserver
}

class ScanState {
  private timer: ValueState<number> = EMPTY_VALUE
  sequence = 0
  schedule: () => void = () => {}
  get pendingTimer(): number | void {
    if (this.timer.kind === 'present') return this.timer.value
    return
  }
  set pendingTimer(value: number | void) {
    this.timer =
      typeof value === 'undefined' ? EMPTY_VALUE : presentValue(value)
  }
  clearPendingTimer(): void {
    this.timer = EMPTY_VALUE
  }
}

class WidgetState {
  private hostValue: ValueState<HTMLElement> = EMPTY_VALUE
  private workflowKey: ValueState<string> = EMPTY_VALUE
  private workflowRoot: ValueState<PasswordFormObservation> = EMPTY_VALUE
  private positionValue: ValueState<WidgetPosition> = EMPTY_VALUE
  dismissed = false
  busy = false
  collapsed = false
  get host(): HTMLElement | void {
    if (this.hostValue.kind === 'present') return this.hostValue.value
    return
  }
  set host(value: HTMLElement | void) {
    this.hostValue =
      typeof value === 'undefined' ? EMPTY_VALUE : presentValue(value)
  }
  get renderedWorkflowKey(): string | void {
    if (this.workflowKey.kind === 'present') return this.workflowKey.value
    return
  }
  set renderedWorkflowKey(value: string | void) {
    this.workflowKey =
      typeof value === 'undefined' ? EMPTY_VALUE : presentValue(value)
  }
  get renderedWorkflowRoot(): PasswordFormObservation | void {
    if (this.workflowRoot.kind === 'present') return this.workflowRoot.value
    return
  }
  set renderedWorkflowRoot(value: PasswordFormObservation | void) {
    this.workflowRoot =
      typeof value === 'undefined' ? EMPTY_VALUE : presentValue(value)
  }
  get position(): WidgetPosition | void {
    if (this.positionValue.kind === 'present') return this.positionValue.value
    return
  }
  set position(value: WidgetPosition | void) {
    this.positionValue =
      typeof value === 'undefined' ? EMPTY_VALUE : presentValue(value)
  }
  clearRenderedWidget(): void {
    this.hostValue = EMPTY_VALUE
    this.workflowKey = EMPTY_VALUE
    this.workflowRoot = EMPTY_VALUE
  }
}

class SaveOfferState {
  private offer: ValueState<WebsiteLoginSaveOfferView> = EMPTY_VALUE
  private watch: ValueState<PendingSaveWatch> = EMPTY_VALUE
  confirmationActive = false
  dismissedOfferIds = new Set<string>()
  get activeOffer(): WebsiteLoginSaveOfferView | void {
    if (this.offer.kind === 'present') return this.offer.value
    return
  }
  set activeOffer(value: WebsiteLoginSaveOfferView | void) {
    this.offer =
      typeof value === 'undefined' ? EMPTY_VALUE : presentValue(value)
  }
  get pendingWatch(): PendingSaveWatch | void {
    if (this.watch.kind === 'present') return this.watch.value
    return
  }
  set pendingWatch(value: PendingSaveWatch | void) {
    this.watch =
      typeof value === 'undefined' ? EMPTY_VALUE : presentValue(value)
  }
  clearActiveOffer(): void {
    this.offer = EMPTY_VALUE
  }
  clearPendingWatch(): void {
    this.watch = EMPTY_VALUE
  }
}

class PickerState {
  private authenticator: ValueState<PendingAuthenticatorPicker> = EMPTY_VALUE
  private login: ValueState<PendingLoginPicker> = EMPTY_VALUE
  get pendingAuthenticator(): PendingAuthenticatorPicker | void {
    if (this.authenticator.kind === 'present') return this.authenticator.value
    return
  }
  set pendingAuthenticator(value: PendingAuthenticatorPicker | void) {
    this.authenticator =
      typeof value === 'undefined' ? EMPTY_VALUE : presentValue(value)
  }
  get pendingLogin(): PendingLoginPicker | void {
    if (this.login.kind === 'present') return this.login.value
    return
  }
  set pendingLogin(value: PendingLoginPicker | void) {
    this.login =
      typeof value === 'undefined' ? EMPTY_VALUE : presentValue(value)
  }
  clearPendingAuthenticator(): void {
    this.authenticator = EMPTY_VALUE
  }
  clearPendingLogin(): void {
    this.login = EMPTY_VALUE
  }
}

export const scanState = new ScanState()
export const widgetState = new WidgetState()
export const saveOfferState = new SaveOfferState()
export const pickerState = new PickerState()
