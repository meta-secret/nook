import { BROWSER_MESSAGE_KEYS } from '../../lib/browser-message-keys'
import {
  type EnrollmentFlowHost,
  type EnrollmentPageHints,
} from '../enrollment-flow'
import { cancelPendingAuthenticatorPickerRequest } from './authenticator-actions'
import {
  cancelPendingLoginPickerRequest,
  sendDecodedRuntimeMessage,
  sendAuthenticationOutcomeRuntimeMessage,
  sendAuthenticatorBackupAttachRuntimeMessage,
  sendAuthenticatorCodeRuntimeMessage,
  sendAuthenticatorEnrollmentConfirmRuntimeMessage,
  sendAuthenticatorEnrollmentDismissRuntimeMessage,
  sendAuthenticatorEnrollmentStageRuntimeMessage,
  sendAuthenticatorOptionsRuntimeMessage,
  sendAuthenticatorPreviewRuntimeMessage,
  sendRuntimeMessageWithoutResponse,
} from './login-passkey-actions'
import {
  WidgetPlacementKind,
  widgetState,
  type WidgetWorkflowRoot,
} from './state'
import {
  applyWidgetPosition,
  attachPointerDrag,
  PointerDragBehaviorKind,
  clampWidgetPosition,
} from './widget-position'
import type { WorkflowCopy } from './workflow-ui'
import {
  WIDGET_HOST_ID,
  progressLabel,
  removeWidget,
  translatedMessage,
  translatedMessageWithSubstitution,
} from './workflow-ui'

const WIDGET_PANEL_STYLES = `
    :host {
      all: initial;
      position: fixed;
      z-index: 2147483647;
      top: 18px;
      right: 18px;
      color-scheme: dark;
    }
    :host(.dragging) {
      cursor: grabbing;
      user-select: none;
    }
    [hidden] {
      display: none !important;
    }
    .panel {
      position: relative;
      width: min(288px, calc(100vw - 36px));
      display: grid;
      gap: 10px;
      padding: 12px;
      border: 1px solid rgb(255 255 255 / 10%);
      border-radius: 12px;
      background: oklch(0.141 0.005 285.823);
      color: oklch(0.985 0 0);
      box-shadow: 0 16px 40px rgb(0 0 0 / 35%);
      font-family: Inter, ui-sans-serif, system-ui, sans-serif;
    }
    .panel.is-collapsed {
      width: auto;
      gap: 0;
      padding: 0;
      border-radius: 16px;
      background: transparent;
      border: 0;
      box-shadow: none;
    }
    .toolbar {
      display: grid;
      grid-template-columns: 1fr auto auto;
      align-items: center;
      gap: 4px;
      cursor: grab;
      touch-action: none;
      user-select: none;
    }
    :host(.dragging) .toolbar {
      cursor: grabbing;
    }
    .icon-button {
      appearance: none;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: oklch(0.705 0.015 286.067);
      cursor: pointer;
      font: inherit;
      font-size: 16px;
      line-height: 1;
      padding: 4px 8px;
    }
    .icon-button:hover { background: oklch(0.274 0.006 286.033); }
    .collapse-button { font-size: 14px; }
    .step-label {
      margin: 0;
      color: oklch(0.705 0.015 286.067);
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-align: left;
      text-transform: uppercase;
    }
    .body {
      display: grid;
      gap: 9px;
    }
    .site-context {
      width: fit-content;
      max-width: 100%;
      margin: 0;
      overflow: hidden;
      color: oklch(0.82 0.01 286);
      font-size: 11px;
      font-weight: 650;
      letter-spacing: 0.02em;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .collapsed-launch {
      appearance: none;
      position: relative;
      display: grid;
      place-items: center;
      width: 56px;
      height: 56px;
      padding: 0;
      border: 1px solid rgb(255 255 255 / 10%);
      border-radius: 16px;
      background: oklch(0.141 0.005 285.823);
      box-shadow: 0 12px 28px rgb(0 0 0 / 35%);
      cursor: grab;
      touch-action: none;
    }
    .collapsed-launch:hover {
      background: oklch(0.21 0.006 285.885);
    }
    .collapsed-mark {
      display: block;
      width: 40px;
      height: 40px;
      border-radius: 10px;
      object-fit: contain;
      pointer-events: none;
    }
    .collapsed-progress {
      position: absolute;
      right: -4px;
      bottom: -4px;
      min-width: 24px;
      padding: 3px 5px;
      border: 1px solid rgb(255 255 255 / 18%);
      border-radius: 999px;
      background: oklch(0.274 0.006 286.033);
      color: oklch(0.985 0 0);
      font: 700 10px/1 Inter, ui-sans-serif, system-ui, sans-serif;
      pointer-events: none;
    }
    h1 {
      margin: 0;
      font-size: 16px;
      line-height: 1.25;
      text-align: left;
    }
    .description {
      margin: 0;
      color: oklch(0.705 0.015 286.067);
      font-size: 12px;
      line-height: 1.4;
      text-align: left;
    }
    .account-list {
      display: grid;
      gap: 8px;
    }
    button.primary-button,
    button.secondary-button {
      appearance: none;
      min-height: 38px;
      border-radius: 9px;
      cursor: pointer;
      font: inherit;
      font-size: 13px;
      font-weight: 700;
      padding: 9px 12px;
    }
    button:disabled {
      cursor: wait;
      opacity: 0.68;
    }
    .primary-button {
      border: 1px solid transparent;
      background: oklch(0.92 0.004 286.32);
      color: oklch(0.21 0.006 285.885);
    }
    .primary-button:hover:not(:disabled) {
      background: color-mix(in oklab, oklch(0.92 0.004 286.32) 90%, black);
    }
    .secondary-button {
      border: 1px solid rgb(255 255 255 / 10%);
      background: transparent;
      color: oklch(0.985 0 0);
    }
    .secondary-button:hover:not(:disabled) {
      background: oklch(0.274 0.006 286.033);
    }
    .text-button {
      appearance: none;
      width: fit-content;
      margin: -4px auto 0;
      padding: 4px 8px;
      border: 0;
      background: transparent;
      color: oklch(0.705 0.015 286.067);
      cursor: pointer;
      font: 650 12px/1.2 Inter, ui-sans-serif, system-ui, sans-serif;
    }
    .text-button:hover { color: oklch(0.985 0 0); }
    button:focus-visible {
      outline: 2px solid rgb(180 186 198 / 45%);
      outline-offset: 2px;
    }
  `

type BuildEnrollmentFlowHostArgs = {
  panel: HTMLElement
  step: HTMLParagraphElement
  title: HTMLHeadingElement
  description: HTMLParagraphElement
  continueButton: HTMLButtonElement
  requestWorkflowReclassification: () => void
}

export function buildEnrollmentFlowHost({
  panel,
  step,
  title,
  description,
  continueButton,
  requestWorkflowReclassification,
}: BuildEnrollmentFlowHostArgs): EnrollmentFlowHost {
  return {
    panel,
    step,
    title,
    description,
    continueButton,
    setBusy: (value: boolean) => {
      widgetState.busy = value
    },
    isBusy: () => widgetState.busy,
    sendDecodedRuntimeMessage,
    sendAuthenticationOutcomeRuntimeMessage,
    sendAuthenticatorBackupAttachRuntimeMessage,
    sendAuthenticatorCodeRuntimeMessage,
    sendAuthenticatorEnrollmentConfirmRuntimeMessage,
    sendAuthenticatorEnrollmentDismissRuntimeMessage,
    sendAuthenticatorEnrollmentStageRuntimeMessage,
    sendAuthenticatorOptionsRuntimeMessage,
    sendAuthenticatorPreviewRuntimeMessage,
    sendRuntimeMessageWithoutResponse,
    requestWorkflowReclassification,
    translatedMessage,
    translatedMessageWithSubstitution,
  }
}

export function enrollmentCopy(hints: EnrollmentPageHints): WorkflowCopy {
  if (hints.qr) {
    return {
      titleKey: BROWSER_MESSAGE_KEYS.WidgetEnrollTitle,
      descriptionKey: BROWSER_MESSAGE_KEYS.WidgetEnrollDescription,
    }
  }
  return {
    titleKey: BROWSER_MESSAGE_KEYS.WidgetBackupTitle,
    descriptionKey: BROWSER_MESSAGE_KEYS.WidgetBackupDescription,
  }
}

interface WidgetShell {
  host: HTMLElement
  panel: HTMLDivElement
  toolbar: HTMLDivElement
  body: HTMLDivElement
  step: HTMLParagraphElement
  title: HTMLHeadingElement
  description: HTMLParagraphElement
  continueButton: HTMLButtonElement
  collapseButton: HTMLButtonElement
  collapsedLaunch: HTMLButtonElement
}

type CreateWidgetMarkArgs = {
  className: string
  size: number
}

export function createWidgetMark({
  className,
  size,
}: CreateWidgetMarkArgs): HTMLImageElement {
  const mark = document.createElement('img')
  mark.className = className
  mark.src = chrome.runtime.getURL('icons/nook.png')
  mark.alt = ''
  mark.setAttribute('aria-hidden', 'true')
  mark.width = size
  mark.height = size
  return mark
}

type CreateWidgetShellArgs = {
  copy: WorkflowCopy
  currentStep: number
  totalSteps: number
}

export function createWidgetShell({
  copy,
  currentStep,
  totalSteps,
}: CreateWidgetShellArgs): WidgetShell {
  const host = document.createElement('aside')
  host.id = WIDGET_HOST_ID
  host.setAttribute(
    'aria-label',
    translatedMessage(BROWSER_MESSAGE_KEYS.WidgetPilotLabel),
  )

  const panel = document.createElement('div')
  panel.className = 'panel'
  panel.setAttribute('data-testid', 'nook-auth-gate')

  const toolbar = document.createElement('div')
  toolbar.className = 'toolbar'
  toolbar.setAttribute('data-testid', 'nook-auth-gate-drag')

  const step = document.createElement('p')
  step.className = 'step-label'
  const nookTypedArgs0_0: Parameters<typeof progressLabel>[0] = {
    currentStep,
    totalSteps,
  }
  step.textContent = progressLabel(nookTypedArgs0_0)

  const collapseButton = document.createElement('button')
  collapseButton.type = 'button'
  collapseButton.className = 'icon-button collapse-button'
  collapseButton.textContent = '▾'
  collapseButton.setAttribute(
    'aria-label',
    translatedMessage(BROWSER_MESSAGE_KEYS.WidgetCollapse),
  )

  const dismissButton = document.createElement('button')
  dismissButton.type = 'button'
  dismissButton.className = 'icon-button dismiss-button'
  dismissButton.textContent = '×'
  dismissButton.setAttribute(
    'aria-label',
    translatedMessage(BROWSER_MESSAGE_KEYS.WidgetDismiss),
  )
  dismissButton.addEventListener('click', () => {
    cancelPendingAuthenticatorPickerRequest()
    cancelPendingLoginPickerRequest()
    widgetState.dismissed = true
    removeWidget()
  })
  toolbar.append(step, collapseButton, dismissButton)

  const body = document.createElement('div')
  body.className = 'body'

  const title = document.createElement('h1')
  title.textContent = translatedMessage(copy.titleKey)

  const site = document.createElement('p')
  site.className = 'site-context'
  site.textContent = location.hostname

  const description = document.createElement('p')
  description.className = 'description'
  description.textContent = translatedMessage(copy.descriptionKey)

  const continueButton = document.createElement('button')
  continueButton.type = 'button'
  continueButton.className = 'primary-button'

  body.append(site, title, description, continueButton)

  const collapsedLaunch = document.createElement('button')
  collapsedLaunch.type = 'button'
  collapsedLaunch.className = 'collapsed-launch'
  const nookTypedArgs0_2: Parameters<typeof progressLabel>[0] = {
    currentStep,
    totalSteps,
  }
  collapsedLaunch.setAttribute(
    'aria-label',
    `${translatedMessage(BROWSER_MESSAGE_KEYS.WidgetExpand)}: ${progressLabel(nookTypedArgs0_2)}`,
  )
  collapsedLaunch.setAttribute('data-testid', 'nook-auth-gate-expand')

  const nookTypedArgs0_3: Parameters<typeof createWidgetMark>[0] = {
    className: 'collapsed-mark',
    size: 40,
  }
  const collapsedMark = createWidgetMark(nookTypedArgs0_3)
  const collapsedProgress = document.createElement('span')
  collapsedProgress.className = 'collapsed-progress'
  collapsedProgress.textContent = `${currentStep}/${totalSteps}`
  collapsedLaunch.append(collapsedMark, collapsedProgress)

  return {
    host,
    panel,
    toolbar,
    body,
    step,
    title,
    description,
    continueButton,
    collapseButton,
    collapsedLaunch,
  }
}

type MountWidgetShellArgs = {
  shell: WidgetShell
  workflowKey: string
  workflowRoot: WidgetWorkflowRoot
}

export function mountWidgetShell({
  shell,
  workflowKey,
  workflowRoot,
}: MountWidgetShellArgs): void {
  const { host, panel, toolbar, body, collapseButton, collapsedLaunch } = shell
  const applyCollapsedState = (): void => {
    panel.classList.toggle('is-collapsed', widgetState.collapsed)
    collapseButton.hidden = widgetState.collapsed
    toolbar.hidden = widgetState.collapsed
    body.hidden = widgetState.collapsed
    collapsedLaunch.hidden = !widgetState.collapsed
    host.setAttribute('aria-expanded', widgetState.collapsed ? 'false' : 'true')
    requestAnimationFrame(() => {
      if (widgetState.placement.kind === WidgetPlacementKind.Unpositioned)
        return
      const nookTypedArgs0_4: Parameters<typeof clampWidgetPosition>[0] = {
        left: widgetState.placement.position.left,
        top: widgetState.placement.position.top,
        width: host.offsetWidth,
        height: host.offsetHeight,
      }
      const position = clampWidgetPosition(nookTypedArgs0_4)
      widgetState.setPosition(position)
      const nookTypedArgs0_5: Parameters<typeof applyWidgetPosition>[0] = {
        host,
        position,
      }
      applyWidgetPosition(nookTypedArgs0_5)
    })
  }

  collapseButton.addEventListener('click', () => {
    widgetState.collapseByUser()
    applyCollapsedState()
  })

  const style = document.createElement('style')
  style.textContent = WIDGET_PANEL_STYLES
  panel.append(toolbar, body, collapsedLaunch)
  const nookTypedArgs0_1: Parameters<typeof host.attachShadow>[0] = {
    mode: 'open',
  }
  host.attachShadow(nookTypedArgs0_1).append(style, panel)
  document.documentElement.append(host)
  widgetState.attachHost(host)
  widgetState.assignWorkflowKey(workflowKey)
  widgetState.setRenderedWorkflowRoot(workflowRoot)

  const nookTypedArgs0_6: Parameters<typeof attachPointerDrag>[0] = {
    host,
    handle: toolbar,
    behavior: { kind: PointerDragBehaviorKind.DragOnly },
  }
  attachPointerDrag(nookTypedArgs0_6)
  const nookTypedArgs0_2: Parameters<typeof attachPointerDrag>[0]['behavior'] =
    {
      kind: PointerDragBehaviorKind.Tappable,
      onTap: () => {
        widgetState.expandByUser()
        applyCollapsedState()
      },
    }
  const nookTypedArgs0_7: Parameters<typeof attachPointerDrag>[0] = {
    host,
    handle: collapsedLaunch,
    behavior: nookTypedArgs0_2,
  }
  attachPointerDrag(nookTypedArgs0_7)
  applyCollapsedState()
  if (widgetState.placement.kind === WidgetPlacementKind.Positioned) {
    const nookTypedArgs0_8: Parameters<typeof applyWidgetPosition>[0] = {
      host,
      position: widgetState.placement.position,
    }
    applyWidgetPosition(nookTypedArgs0_8)
  }
}
