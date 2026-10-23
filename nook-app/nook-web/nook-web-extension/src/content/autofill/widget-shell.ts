import type { AuthenticationAuthenticatorSetupSnapshot } from '../../lib/page-qr-capture'
import {
  BROWSER_MESSAGE_KEYS,
  type BrowserMessageKey,
} from '../../lib/browser-message-keys'

import {
  type EnrollmentFlowHost,
  type EnrollmentPageHints,
} from '../enrollment-flow'

import { authenticatorInteraction } from './authenticator-actions'

import {
  loginPasskeyInteraction,
  authenticationRuntimeTransport,
} from './login-passkey-actions'

import {
  WidgetPlacementKind,
  widgetState,
  type WidgetWorkflowRoot,
} from './state'

import {
  PointerDragBehaviorKind,
  authenticationWidgetPosition,
} from './widget-position'

import type { WorkflowCopy } from './workflow-ui'
import {
  SavedLoginPresentationKind,
  WidgetVaultPresentationKind,
  savedLoginDescriptionKey,
  type WidgetVaultPresentation,
} from './widget-presentation-state'

import { workflowUi } from './workflow-ui'
import {
  IN_PAGE_SURFACE_TOKENS,
  WIDGET_HOST_ID,
  inPageSurfaceMount,
} from '../in-page-surface'

/* The Pilot speaks the shared in-page surface language. */
const WIDGET_PANEL_STYLES = `
    :host {
      all: initial;
      position: fixed;
      z-index: 2147483647;
      top: 18px;
      right: 18px;
      ${IN_PAGE_SURFACE_TOKENS}
      filter: drop-shadow(0 18px 36px rgb(0 0 0 / 45%));
    }
    :host(.dragging) {
      cursor: grabbing;
      user-select: none;
    }
    [hidden] {
      display: none !important;
    }
    .panel {
      box-sizing: border-box;
      position: relative;
      isolation: isolate;
      width: min(320px, calc(100vw - 36px));
      max-height: calc(100dvh - 36px);
      overflow-y: auto;
      display: grid;
      gap: 14px;
      padding: 12px 14px 16px;
      background: var(--nk-border);
      color: var(--nk-fg);
      font-family: Inter, ui-sans-serif, system-ui, sans-serif;
      clip-path: polygon(0 0, calc(100% - var(--nk-cut)) 0, 100% var(--nk-cut), 100% 100%, 0 100%);
    }
    .panel::before {
      content: '';
      position: absolute;
      inset: 1px;
      z-index: -1;
      background: var(--nk-card);
      clip-path: polygon(0 0, calc(100% - var(--nk-cut) + 0.41px) 0, 100% calc(var(--nk-cut) - 0.41px), 100% 100%, 0 100%);
    }
    .panel.is-collapsed {
      width: auto;
      gap: 0;
      padding: 0;
      overflow: visible;
      background: transparent;
      clip-path: none;
    }
    .panel.is-collapsed::before { display: none; }
    .toolbar {
      display: grid;
      grid-template-columns: auto 1fr auto auto;
      align-items: center;
      gap: 8px;
      margin: 0 -2px;
      padding-bottom: 10px;
      border-bottom: 1px solid var(--nk-border);
      cursor: grab;
      touch-action: none;
      user-select: none;
    }
    :host(.dragging) .toolbar {
      cursor: grabbing;
    }
    .mark {
      display: block;
      width: 22px;
      height: 22px;
      object-fit: contain;
    }
    .icon-button {
      appearance: none;
      display: grid;
      place-items: center;
      width: 28px;
      height: 28px;
      padding: 0;
      border: 0;
      border-radius: 3px;
      background: transparent;
      color: var(--nk-muted);
      cursor: pointer;
    }
    .icon-button:hover { background: var(--nk-raised); color: var(--nk-fg); }
    .icon-button svg { width: 15px; height: 15px; }
    .step-label {
      margin: 0;
      color: var(--nk-muted);
      font-family: var(--nk-mono);
      font-size: 10.5px;
      font-weight: 500;
      letter-spacing: 0.14em;
      text-align: left;
      text-transform: uppercase;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .body {
      display: grid;
      gap: 12px;
    }
    /* Where Nook is acting, and what the vault holds for it, on one strip. */
    .site-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 6px 10px;
      padding: 8px 10px;
      border: 1px solid var(--nk-border);
      background: var(--nk-bg);
    }
    .site-context {
      display: flex;
      align-items: center;
      gap: 7px;
      min-width: 0;
      max-width: 100%;
      margin: 0;
      overflow: hidden;
      color: var(--nk-fg);
      font-family: var(--nk-mono);
      font-size: 11.5px;
      font-weight: 500;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .site-context::before {
      content: '';
      flex: none;
      width: 6px;
      height: 6px;
      background: var(--nk-muted);
    }
    .vault-status {
      margin: 0;
      padding: 2px 7px;
      border: 1px solid var(--nk-border);
      color: var(--nk-muted);
      font-family: var(--nk-mono);
      font-size: 10.5px;
      font-weight: 500;
      letter-spacing: 0.04em;
      white-space: nowrap;
    }
    .vault-status[data-state='vault-connected'],
    .vault-status[data-state='credential-available'] {
      border-color: color-mix(in oklab, var(--nk-success) 45%, transparent);
      color: var(--nk-success);
    }
    .vault-status[data-state='vault-not-connected'],
    .vault-status[data-state='vault-locked'],
    .vault-status[data-state='no-matching-credential'],
    .vault-status[data-state='unavailable'] {
      border-color: color-mix(in oklab, var(--nk-warning) 45%, transparent);
      color: var(--nk-warning);
    }
    .vault-status[data-state='vault-locked'],
    .vault-status[data-state='no-matching-credential'],
    .vault-status[data-state='unavailable'] {
      white-space: normal;
    }
    h1 {
      margin: 2px 0 0;
      font-size: 17px;
      font-weight: 600;
      letter-spacing: -0.01em;
      line-height: 1.25;
      text-align: left;
    }
    .description {
      margin: -6px 0 0;
      color: var(--nk-muted);
      font-size: 13px;
      line-height: 1.45;
      text-align: left;
    }
    /* The three steps as a stepper: square marks joined by a rail; the
     * current one lit, finished ones green. */
    .pilot-site-message { margin:0; padding:9px 11px; border-left:2px solid var(--nk-warning); background:var(--nk-bg); color:var(--nk-fg); font-size:13px; line-height:1.45; overflow-wrap:anywhere; }
    .pilot-site-message-label { display:block; margin-bottom:3px; color:var(--nk-muted); font-family:var(--nk-mono); font-size:10.5px; letter-spacing:0.12em; text-transform:uppercase; }
    .pilot-checklist { list-style:none; margin:0; padding:2px 0; display:grid; gap:0; min-width:0; }
    .pilot-checklist-step { position:relative; display:flex; gap:11px; align-items:flex-start; min-width:0; padding-bottom:12px; color:var(--nk-muted); font-size:13px; line-height:1.35; }
    .pilot-checklist-step:last-child { padding-bottom:0; }
    .pilot-checklist-step:not(:last-child)::after { content:''; position:absolute; left:10px; top:24px; bottom:2px; width:1px; background:var(--nk-border); }
    .pilot-checklist-mark { display:grid; place-items:center; flex:0 0 21px; width:21px; height:21px; border:1px solid var(--nk-input); background:var(--nk-bg); color:inherit; font-family:var(--nk-mono); font-size:10.5px; font-weight:600; }
    .pilot-checklist-copy { min-width:0; overflow-wrap:anywhere; padding-top:1px; }
    .pilot-checklist-label { display:block; }
    .pilot-checklist-detail { display:block; margin-top:2px; font-size:12px; line-height:1.45; font-weight:400; color:var(--nk-muted); }
    .pilot-checklist-step[data-state='Current'] { color:var(--nk-fg); font-weight:600; }
    .pilot-checklist-step[data-state='Current'] .pilot-checklist-mark { border-color:var(--nk-primary); background:var(--nk-primary); color:var(--nk-primary-fg); }
    .pilot-checklist-step[data-state='Done'] .pilot-checklist-mark { border-color:color-mix(in oklab, var(--nk-success) 60%, transparent); color:var(--nk-success); }
    .pilot-checklist-step[data-state='Done']:not(:last-child)::after { background:color-mix(in oklab, var(--nk-success) 45%, transparent); }
    .pilot-checklist-step[data-state='Attention'] .pilot-checklist-mark { border-color:color-mix(in oklab, var(--nk-warning) 60%, transparent); color:var(--nk-warning); }
    .inline-login-picker {
      width: 100%;
      height: max(80px, min(420px, calc(100dvh - 360px)));
      min-width: 0;
      border: 1px solid var(--nk-border);
      color-scheme: dark;
    }
    .inline-login-picker-cancel {
      min-height: 44px;
      margin: 0 auto;
    }
    /* Folded, Pilot is one keytag-cut chip: the mark and the step count
     * side by side, nothing overlapping or spilling outside it. */
    .collapsed-launch {
      appearance: none;
      position: relative;
      isolation: isolate;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      height: 40px;
      padding: 0 14px 0 9px;
      border: 0;
      background: var(--nk-border);
      color: var(--nk-fg);
      cursor: grab;
      touch-action: none;
      clip-path: polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 0 100%);
    }
    .collapsed-launch::before {
      content: '';
      position: absolute;
      inset: 1px;
      z-index: -1;
      background: var(--nk-card);
      clip-path: polygon(0 0, calc(100% - 10px + 0.41px) 0, 100% calc(10px - 0.41px), 100% 100%, 0 100%);
    }
    .collapsed-launch:hover::before {
      background: var(--nk-raised);
    }
    .collapsed-mark {
      display: block;
      flex: none;
      width: 22px;
      height: 22px;
      object-fit: contain;
      pointer-events: none;
    }
    .collapsed-progress {
      color: var(--nk-muted);
      font: 600 11px/1 var(--nk-mono);
      letter-spacing: 0.06em;
      pointer-events: none;
    }
    .account-list {
      display: grid;
      gap: 6px;
    }
    button.primary-button,
    button.secondary-button {
      appearance: none;
      min-height: 40px;
      border-radius: 3px;
      cursor: pointer;
      font: inherit;
      font-size: 13px;
      font-weight: 600;
      padding: 9px 12px;
    }
    button:disabled {
      cursor: wait;
      opacity: 0.68;
    }
    .primary-button {
      border: 1px solid transparent;
      background: var(--nk-primary);
      color: var(--nk-primary-fg);
    }
    .primary-button:hover:not(:disabled) {
      background: color-mix(in oklab, var(--nk-primary) 90%, black);
    }
    .secondary-button {
      border: 1px solid var(--nk-border);
      background: transparent;
      color: var(--nk-fg);
    }
    .secondary-button:hover:not(:disabled) {
      background: var(--nk-raised);
    }
    .text-button {
      appearance: none;
      width: fit-content;
      margin: -4px auto 0;
      padding: 4px 8px;
      border: 0;
      background: transparent;
      color: var(--nk-muted);
      cursor: pointer;
      font: 500 12px/1.2 Inter, ui-sans-serif, system-ui, sans-serif;
      text-decoration: underline;
      text-decoration-color: var(--nk-input);
      text-underline-offset: 3px;
    }
    .text-button:hover { color: var(--nk-fg); text-decoration-color: var(--nk-fg); }
    button:focus-visible {
      outline: 2px solid oklch(0.66 0.1 275 / 60%);
      outline-offset: 2px;
    }
  `

type BuildEnrollmentFlowHostArgs = {
  authenticatorSetupSnapshot: AuthenticationAuthenticatorSetupSnapshot
  panel: HTMLElement
  step: HTMLParagraphElement
  title: HTMLHeadingElement
  description: HTMLParagraphElement
  continueButton: HTMLButtonElement
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

enum WidgetIcon {
  Collapse = 'collapse',
  Dismiss = 'dismiss',
}

type CreateWidgetMarkArgs = {
  className: string
  size: number
}

type CreateWidgetShellArgs = {
  copy: WorkflowCopy
  vaultPresentation: WidgetVaultPresentation
  savedLoginAction: boolean
  savedLoginPresentation: SavedLoginPresentationKind
  currentStep: number
  totalSteps: number
}

type WidgetShellDescriptionKeyArgs = {
  copy: WorkflowCopy
  vaultPresentation: WidgetVaultPresentation
  savedLoginAction: boolean
}

type MountWidgetShellArgs = {
  shell: WidgetShell
  workflowKey: string
  workflowRoot: WidgetWorkflowRoot
}

/** Owns the browser runtime resources shared by these interactions. */
type AuthenticationWidgetShellContext = {
  readonly widgetState: typeof widgetState
}
class AuthenticationWidgetShell {
  constructor(private readonly ui: AuthenticationWidgetShellContext) {}

  private descriptionKey({
    copy,
    vaultPresentation,
    savedLoginAction,
  }: WidgetShellDescriptionKeyArgs): BrowserMessageKey {
    if (savedLoginAction) return savedLoginDescriptionKey(vaultPresentation)
    if (vaultPresentation.kind === WidgetVaultPresentationKind.Locked) {
      return BROWSER_MESSAGE_KEYS.WidgetUnlockThenContinue
    }
    return copy.descriptionKey
  }

  buildEnrollmentFlowHost({
    authenticatorSetupSnapshot,
    panel,
    step,
    title,
    description,
    continueButton,
  }: BuildEnrollmentFlowHostArgs): EnrollmentFlowHost {
    return {
      authenticatorSetupSnapshot,
      panel,
      step,
      title,
      description,
      continueButton,
      setBusy: (value: boolean) => {
        this.ui.widgetState.busy = value
      },
      isBusy: () => this.ui.widgetState.busy,
      sendDecodedRuntimeMessage:
        authenticationRuntimeTransport.sendDecodedRuntimeMessage.bind(
          authenticationRuntimeTransport,
        ),
      sendAuthenticationOutcomeRuntimeMessage:
        authenticationRuntimeTransport.sendAuthenticationOutcomeRuntimeMessage.bind(
          authenticationRuntimeTransport,
        ),
      sendAuthenticatorBackupAttachRuntimeMessage:
        authenticationRuntimeTransport.sendAuthenticatorBackupAttachRuntimeMessage.bind(
          authenticationRuntimeTransport,
        ),
      sendAuthenticatorCodeRuntimeMessage:
        authenticationRuntimeTransport.sendAuthenticatorCodeRuntimeMessage.bind(
          authenticationRuntimeTransport,
        ),
      sendAuthenticatorEnrollmentConfirmRuntimeMessage:
        authenticationRuntimeTransport.sendAuthenticatorEnrollmentConfirmRuntimeMessage.bind(
          authenticationRuntimeTransport,
        ),
      sendAuthenticatorEnrollmentStageRuntimeMessage:
        authenticationRuntimeTransport.sendAuthenticatorEnrollmentStageRuntimeMessage.bind(
          authenticationRuntimeTransport,
        ),
      sendAuthenticatorOptionsRuntimeMessage:
        authenticationRuntimeTransport.sendAuthenticatorOptionsRuntimeMessage.bind(
          authenticationRuntimeTransport,
        ),
      sendAuthenticatorPreviewRuntimeMessage:
        authenticationRuntimeTransport.sendAuthenticatorPreviewRuntimeMessage.bind(
          authenticationRuntimeTransport,
        ),
      sendRuntimeMessageWithoutResponse:
        authenticationRuntimeTransport.sendRuntimeMessageWithoutResponse.bind(
          authenticationRuntimeTransport,
        ),
      translatedMessage: workflowUi.translatedMessage.bind(workflowUi),
      translatedMessageWithSubstitution:
        workflowUi.translatedMessageWithSubstitution.bind(workflowUi),
    }
  }

  enrollmentCopy(hints: EnrollmentPageHints): WorkflowCopy {
    switch (hints.qr) {
      case 'present':
        return {
          titleKey: BROWSER_MESSAGE_KEYS.WidgetEnrollTitle,
          descriptionKey: BROWSER_MESSAGE_KEYS.WidgetEnrollDescription,
        }
      case 'absent':
        return {
          titleKey: BROWSER_MESSAGE_KEYS.WidgetBackupTitle,
          descriptionKey: BROWSER_MESSAGE_KEYS.WidgetBackupDescription,
        }
    }
  }

  /** A 24-unit stroke icon (Lucide's chevron-down and x) for the toolbar. */
  private createIcon(icon: WidgetIcon): SVGSVGElement {
    const namespace = 'http://www.w3.org/2000/svg'
    const svg = document.createElementNS(namespace, 'svg')
    svg.setAttribute('viewBox', '0 0 24 24')
    svg.setAttribute('fill', 'none')
    svg.setAttribute('stroke', 'currentColor')
    svg.setAttribute('stroke-width', '2')
    svg.setAttribute('stroke-linecap', 'round')
    svg.setAttribute('stroke-linejoin', 'round')
    svg.setAttribute('aria-hidden', 'true')
    const path = document.createElementNS(namespace, 'path')
    path.setAttribute(
      'd',
      icon === WidgetIcon.Collapse ? 'm6 9 6 6 6-6' : 'M18 6 6 18M6 6l12 12',
    )
    svg.append(path)
    return svg
  }

  createWidgetMark({
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

  createWidgetShell({
    copy,
    vaultPresentation,
    savedLoginAction,
    savedLoginPresentation,
    currentStep,
    totalSteps,
  }: CreateWidgetShellArgs): WidgetShell {
    const host = document.createElement('aside')
    host.id = WIDGET_HOST_ID
    host.setAttribute(
      'aria-label',
      workflowUi.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetPilotLabel),
    )

    const panel = document.createElement('div')
    panel.className = 'panel'
    panel.setAttribute('data-testid', 'nook-auth-gate')

    const toolbar = document.createElement('div')
    toolbar.className = 'toolbar'
    toolbar.setAttribute('data-testid', 'nook-auth-gate-drag')

    const step = document.createElement('p')
    step.className = 'step-label'
    const nookTypedArgs0_0: Parameters<typeof workflowUi.progressLabel>[0] = {
      currentStep,
      totalSteps,
    }
    step.textContent = workflowUi.progressLabel(nookTypedArgs0_0)

    const collapseButton = document.createElement('button')
    collapseButton.type = 'button'
    collapseButton.className = 'icon-button collapse-button'
    collapseButton.append(this.createIcon(WidgetIcon.Collapse))
    collapseButton.setAttribute(
      'aria-label',
      workflowUi.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetCollapse),
    )

    const dismissButton = document.createElement('button')
    dismissButton.type = 'button'
    dismissButton.className = 'icon-button dismiss-button'
    dismissButton.append(this.createIcon(WidgetIcon.Dismiss))
    dismissButton.setAttribute(
      'aria-label',
      workflowUi.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetDismiss),
    )
    dismissButton.title = workflowUi.translatedMessage(
      BROWSER_MESSAGE_KEYS.WidgetDismiss,
    )
    dismissButton.addEventListener('click', () => {
      authenticatorInteraction.cancelPendingAuthenticatorPickerRequest()
      loginPasskeyInteraction.cancelPendingLoginPickerRequest()
      this.ui.widgetState.dismissed = true
      workflowUi.removeWidget()
    })
    const nookTypedArgs0_1: Parameters<typeof this.createWidgetMark>[0] = {
      className: 'mark',
      size: 22,
    }
    const mark = this.createWidgetMark(nookTypedArgs0_1)
    toolbar.append(mark, step, collapseButton, dismissButton)

    const body = document.createElement('div')
    body.className = 'body'

    const title = document.createElement('h1')
    title.textContent = workflowUi.translatedMessage(copy.titleKey)

    const site = document.createElement('p')
    site.className = 'site-context'
    site.textContent = location.hostname

    const vaultStatus = document.createElement('p')
    vaultStatus.className = 'vault-status'
    vaultStatus.setAttribute('data-testid', 'nook-auth-gate-vault-status')
    vaultStatus.setAttribute('role', 'status')
    vaultStatus.setAttribute('aria-live', 'polite')
    vaultStatus.dataset.connected =
      vaultPresentation.kind === WidgetVaultPresentationKind.NotConnected
        ? 'false'
        : 'true'
    vaultStatus.dataset.state = vaultPresentation.kind
    vaultStatus.textContent = workflowUi.vaultConnectionLabel(vaultPresentation)

    const description = document.createElement('p')
    description.className = 'description'
    const descriptionKeyArgs: WidgetShellDescriptionKeyArgs = {
      copy,
      vaultPresentation,
      savedLoginAction,
    }
    description.textContent = workflowUi.translatedMessage(
      this.descriptionKey(descriptionKeyArgs),
    )

    const continueButton = document.createElement('button')
    continueButton.type = 'button'
    continueButton.className = 'primary-button'

    const siteRow = document.createElement('div')
    siteRow.className = 'site-row'
    siteRow.append(site, vaultStatus)

    // One primary action; the close button hands the page back to the person.
    body.append(siteRow, title, description, continueButton)

    const collapsedLaunch = document.createElement('button')
    collapsedLaunch.type = 'button'
    collapsedLaunch.className = 'collapsed-launch'
    collapsedLaunch.setAttribute(
      'aria-label',
      `${workflowUi.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetExpand)}: ${step.textContent}`,
    )
    collapsedLaunch.setAttribute('data-testid', 'nook-auth-gate-expand')

    const nookTypedArgs0_3: Parameters<typeof this.createWidgetMark>[0] = {
      className: 'collapsed-mark',
      size: 22,
    }
    const collapsedMark = this.createWidgetMark(nookTypedArgs0_3)
    const collapsedProgress = document.createElement('span')
    collapsedProgress.className = 'collapsed-progress'
    collapsedProgress.textContent = `${currentStep}/${totalSteps}`
    collapsedLaunch.append(collapsedMark, collapsedProgress)

    switch (savedLoginPresentation) {
      case SavedLoginPresentationKind.Empty:
        title.textContent = workflowUi.translatedMessage(
          BROWSER_MESSAGE_KEYS.WidgetLoginNoMatchTitle,
        )
        step.textContent = workflowUi.translatedMessage(
          BROWSER_MESSAGE_KEYS.WidgetPilotLabel,
        )
        collapsedProgress.textContent = step.textContent
        collapsedLaunch.setAttribute(
          'aria-label',
          `${workflowUi.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetExpand)}: ${step.textContent}`,
        )
        break
      case SavedLoginPresentationKind.Workflow:
        break
    }

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

  mountWidgetShell({
    shell,
    workflowKey,
    workflowRoot,
  }: MountWidgetShellArgs): void {
    const { host, panel, toolbar, body, collapseButton, collapsedLaunch } =
      shell
    const applyCollapsedState = (): void => {
      panel.classList.toggle('is-collapsed', this.ui.widgetState.collapsed)
      collapseButton.hidden = this.ui.widgetState.collapsed
      toolbar.hidden = this.ui.widgetState.collapsed
      body.hidden = this.ui.widgetState.collapsed
      collapsedLaunch.hidden = !this.ui.widgetState.collapsed
      host.setAttribute(
        'aria-expanded',
        this.ui.widgetState.collapsed ? 'false' : 'true',
      )
      requestAnimationFrame(() => {
        if (
          this.ui.widgetState.placement.kind ===
          WidgetPlacementKind.Unpositioned
        )
          return
        const nookTypedArgs0_4: Parameters<
          typeof authenticationWidgetPosition.clampWidgetPosition
        >[0] = {
          left: this.ui.widgetState.placement.position.left,
          top: this.ui.widgetState.placement.position.top,
          width: host.offsetWidth,
          height: host.offsetHeight,
        }
        const position =
          authenticationWidgetPosition.clampWidgetPosition(nookTypedArgs0_4)
        this.ui.widgetState.setPosition(position)
        const nookTypedArgs0_5: Parameters<
          typeof authenticationWidgetPosition.applyWidgetPosition
        >[0] = {
          host,
          position,
        }
        authenticationWidgetPosition.applyWidgetPosition(nookTypedArgs0_5)
      })
    }

    collapseButton.addEventListener('click', () => {
      loginPasskeyInteraction.cancelPendingLoginPickerRequest()
      this.ui.widgetState.collapsed = true
      applyCollapsedState()
    })

    const style = document.createElement('style')
    style.textContent = WIDGET_PANEL_STYLES
    panel.append(toolbar, body, collapsedLaunch)
    const nookTypedArgs0_1: Parameters<typeof host.attachShadow>[0] = {
      mode: 'open',
    }
    host.attachShadow(nookTypedArgs0_1).append(style, panel)
    inPageSurfaceMount.parent().append(host)
    this.ui.widgetState.attachHost(host)
    this.ui.widgetState.assignWorkflowKey(workflowKey)
    this.ui.widgetState.setRenderedWorkflowRoot(workflowRoot)

    const nookTypedArgs0_6: Parameters<
      typeof authenticationWidgetPosition.attachPointerDrag
    >[0] = {
      host,
      handle: toolbar,
      behavior: { kind: PointerDragBehaviorKind.DragOnly },
    }
    authenticationWidgetPosition.attachPointerDrag(nookTypedArgs0_6)
    const nookTypedArgs0_2: Parameters<
      typeof authenticationWidgetPosition.attachPointerDrag
    >[0]['behavior'] = {
      kind: PointerDragBehaviorKind.Tappable,
      onTap: () => {
        this.ui.widgetState.collapsed = false
        applyCollapsedState()
      },
    }
    const nookTypedArgs0_7: Parameters<
      typeof authenticationWidgetPosition.attachPointerDrag
    >[0] = {
      host,
      handle: collapsedLaunch,
      behavior: nookTypedArgs0_2,
    }
    authenticationWidgetPosition.attachPointerDrag(nookTypedArgs0_7)
    applyCollapsedState()
    if (this.ui.widgetState.placement.kind === WidgetPlacementKind.Positioned) {
      const nookTypedArgs0_8: Parameters<
        typeof authenticationWidgetPosition.applyWidgetPosition
      >[0] = {
        host,
        position: this.ui.widgetState.placement.position,
      }
      authenticationWidgetPosition.applyWidgetPosition(nookTypedArgs0_8)
    }
  }
}

const authenticationWidgetShellDependencies: ConstructorParameters<
  typeof AuthenticationWidgetShell
>[0] = {
  widgetState,
}
export const authenticationWidgetShell = new AuthenticationWidgetShell(
  authenticationWidgetShellDependencies,
)
