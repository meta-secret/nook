import type { PasswordFormObservation } from '../../../../nook-web-shared/src/extension/password-forms'
import type { WebsiteLoginSaveOfferView } from '../../lib/login-save-messages'

export type WidgetPosition = {
  left: number
  top: number
}

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

export const scanState: {
  pendingTimer: number | undefined
  sequence: number
  schedule: () => void
} = {
  pendingTimer: undefined,
  sequence: 0,
  schedule: () => undefined,
}

export const widgetState: {
  host: HTMLElement | undefined
  renderedWorkflowKey: string | undefined
  renderedWorkflowRoot: PasswordFormObservation | undefined
  dismissed: boolean
  busy: boolean
  collapsed: boolean
  position: WidgetPosition | undefined
} = {
  host: undefined,
  renderedWorkflowKey: undefined,
  renderedWorkflowRoot: undefined,
  dismissed: false,
  busy: false,
  collapsed: false,
  position: undefined,
}

export const saveOfferState: {
  activeOffer: WebsiteLoginSaveOfferView | undefined
  confirmationActive: boolean
  dismissedOfferIds: Set<string>
  pendingWatch: PendingSaveWatch | undefined
} = {
  activeOffer: undefined,
  confirmationActive: false,
  dismissedOfferIds: new Set<string>(),
  pendingWatch: undefined,
}

export const pickerState: {
  pendingAuthenticator: PendingAuthenticatorPicker | undefined
  pendingLogin: PendingLoginPicker | undefined
} = {
  pendingAuthenticator: undefined,
  pendingLogin: undefined,
}
