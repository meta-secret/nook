export {}

import {
  fillLoginCredentials,
  submitLoginForm,
  summarizePasswordForms,
} from '../../../nook-web-shared/src/extension/password-forms'
import type { WebsiteLoginAccountOption } from '../lib/login-fill-messages'
import { isRuntimeNookVaultAppUrl } from '../lib/simple-vault-runtime'

const WIDGET_HOST_ID = 'nook-auth-widget'
const DRAG_THRESHOLD_PX = 4

type WidgetPosition = {
  left: number
  top: number
}

let pendingScan: number | undefined
let widgetHost: HTMLElement | undefined
let dismissed = false
let busy = false
let widgetCollapsed = false
let widgetPosition: WidgetPosition | undefined

type LoginOptionsResponse = {
  ok?: boolean
  status?: 'ready' | 'locked' | 'unavailable'
  accounts?: WebsiteLoginAccountOption[]
  reason?: string
}

type LoginFillResponse = {
  ok?: boolean
  username?: string
  password?: string
  reason?: string
}

function translatedMessage(key: string): string {
  return chrome.i18n.getMessage(key) || 'Nook'
}

function removeWidget(): void {
  widgetHost?.remove()
  widgetHost = undefined
}

function clampWidgetPosition(
  left: number,
  top: number,
  width: number,
  height: number,
): WidgetPosition {
  const margin = 8
  const maxLeft = Math.max(margin, window.innerWidth - width - margin)
  const maxTop = Math.max(margin, window.innerHeight - height - margin)
  return {
    left: Math.min(Math.max(margin, left), maxLeft),
    top: Math.min(Math.max(margin, top), maxTop),
  }
}

function applyWidgetPosition(
  host: HTMLElement,
  position: WidgetPosition,
): void {
  host.style.top = `${position.top}px`
  host.style.left = `${position.left}px`
  host.style.right = 'auto'
}

function attachPointerDrag(
  host: HTMLElement,
  handle: HTMLElement,
  options?: { onTap?: () => void },
): void {
  let pointerId: number | undefined
  let startX = 0
  let startY = 0
  let originLeft = 0
  let originTop = 0
  let dragged = false

  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return
    const target = event.target
    if (
      target instanceof Element &&
      target.closest('button') &&
      !handle.classList.contains('collapsed-launch')
    ) {
      return
    }
    pointerId = event.pointerId
    handle.setPointerCapture(pointerId)
    const rect = host.getBoundingClientRect()
    startX = event.clientX
    startY = event.clientY
    originLeft = rect.left
    originTop = rect.top
    dragged = false
  })

  handle.addEventListener('pointermove', (event) => {
    if (pointerId === undefined || event.pointerId !== pointerId) return
    const dx = event.clientX - startX
    const dy = event.clientY - startY
    if (!dragged && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return
    dragged = true
    host.classList.add('dragging')
    widgetPosition = clampWidgetPosition(
      originLeft + dx,
      originTop + dy,
      host.offsetWidth,
      host.offsetHeight,
    )
    applyWidgetPosition(host, widgetPosition)
  })

  const endDrag = (event: PointerEvent) => {
    if (pointerId === undefined || event.pointerId !== pointerId) return
    if (handle.hasPointerCapture(pointerId)) {
      handle.releasePointerCapture(pointerId)
    }
    pointerId = undefined
    host.classList.remove('dragging')
    if (!dragged) options?.onTap?.()
  }

  handle.addEventListener('pointerup', endDrag)
  handle.addEventListener('pointercancel', endDrag)
}

function sendRuntimeMessage<T>(message: unknown): Promise<T | undefined> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response: T | undefined) => {
      if (chrome.runtime.lastError) {
        resolve(undefined)
        return
      }
      resolve(response)
    })
  })
}

function setStatus(
  description: HTMLParagraphElement,
  continueButton: HTMLButtonElement,
  text: string,
  enableContinue: boolean,
): void {
  description.textContent = text
  continueButton.disabled = !enableContinue || busy
}

async function fillAndSubmitAccount(
  account: WebsiteLoginAccountOption,
  description: HTMLParagraphElement,
  continueButton: HTMLButtonElement,
): Promise<void> {
  const response = await sendRuntimeMessage<LoginFillResponse>({
    type: 'nook:website-login-fill',
    payload: {
      origin: location.origin,
      vaultStoreId: account.vaultStoreId,
      secretId: account.secretId,
    },
  })
  if (!response?.ok || !response.username || response.password === undefined) {
    setStatus(
      description,
      continueButton,
      translatedMessage('widgetFillFailed'),
      true,
    )
    return
  }

  const credentials = {
    username: response.username,
    password: response.password,
  }
  response.password = ''
  const filled = fillLoginCredentials(credentials)
  credentials.password = ''
  credentials.username = ''
  if (!filled) {
    setStatus(
      description,
      continueButton,
      translatedMessage('widgetFillFailed'),
      true,
    )
    return
  }
  submitLoginForm()
  dismissed = true
  removeWidget()
}

function renderAccountChooser(
  panel: HTMLElement,
  accounts: WebsiteLoginAccountOption[],
  description: HTMLParagraphElement,
  continueButton: HTMLButtonElement,
  openVaultButton: HTMLButtonElement,
): void {
  continueButton.hidden = true
  openVaultButton.hidden = true
  description.textContent = translatedMessage('widgetChooseAccount')

  const list = document.createElement('div')
  list.className = 'account-list'
  for (const account of accounts) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'secondary-button account-button'
    button.textContent = account.username || account.websiteHost
    button.addEventListener('click', () => {
      if (busy) return
      busy = true
      button.disabled = true
      void fillAndSubmitAccount(account, description, continueButton).finally(
        () => {
          busy = false
        },
      )
    })
    list.append(button)
  }
  panel.append(list)
}

async function continueWithNook(
  description: HTMLParagraphElement,
  continueButton: HTMLButtonElement,
  openVaultButton: HTMLButtonElement,
  panel: HTMLElement,
): Promise<void> {
  if (busy) return
  busy = true
  continueButton.disabled = true
  setStatus(
    description,
    continueButton,
    translatedMessage('widgetWorking'),
    false,
  )

  try {
    const response = await sendRuntimeMessage<LoginOptionsResponse>({
      type: 'nook:website-login-options',
      payload: { origin: location.origin },
    })

    if (!response?.ok) {
      setStatus(
        description,
        continueButton,
        translatedMessage('widgetFillFailed'),
        true,
      )
      return
    }

    if (response.status === 'locked') {
      setStatus(
        description,
        continueButton,
        translatedMessage('widgetUnlockThenContinue'),
        true,
      )
      return
    }

    const accounts = response.accounts ?? []
    if (accounts.length === 0) {
      setStatus(
        description,
        continueButton,
        translatedMessage('widgetNoMatch'),
        true,
      )
      return
    }

    if (accounts.length === 1) {
      await fillAndSubmitAccount(accounts[0], description, continueButton)
      return
    }

    renderAccountChooser(
      panel,
      accounts,
      description,
      continueButton,
      openVaultButton,
    )
  } finally {
    busy = false
    if (continueButton.isConnected && !continueButton.hidden) {
      continueButton.disabled = false
    }
  }
}

function renderWidget(): void {
  const summary = summarizePasswordForms()
  if (summary.passwordFieldCount === 0 || dismissed) {
    removeWidget()
    return
  }
  if (widgetHost) return

  const host = document.createElement('aside')
  host.id = WIDGET_HOST_ID
  host.setAttribute('aria-label', 'Nook')
  const shadow = host.attachShadow({ mode: 'open' })

  const panel = document.createElement('div')
  panel.className = 'panel'
  panel.setAttribute('data-testid', 'nook-auth-gate')

  const toolbar = document.createElement('div')
  toolbar.className = 'toolbar'
  toolbar.setAttribute('data-testid', 'nook-auth-gate-drag')

  const step = document.createElement('p')
  step.className = 'step-label'
  step.textContent = translatedMessage('widgetGateStep')

  const collapseButton = document.createElement('button')
  collapseButton.type = 'button'
  collapseButton.className = 'icon-button collapse-button'
  collapseButton.textContent = '▾'
  collapseButton.setAttribute('aria-label', translatedMessage('widgetCollapse'))

  const dismissButton = document.createElement('button')
  dismissButton.type = 'button'
  dismissButton.className = 'icon-button dismiss-button'
  dismissButton.textContent = '×'
  dismissButton.setAttribute('aria-label', translatedMessage('widgetDismiss'))
  dismissButton.addEventListener('click', () => {
    dismissed = true
    removeWidget()
  })

  toolbar.append(step, collapseButton, dismissButton)

  const body = document.createElement('div')
  body.className = 'body'

  const mark = document.createElement('img')
  mark.className = 'mark'
  mark.src = chrome.runtime.getURL('icons/nook.png')
  mark.alt = ''
  mark.setAttribute('aria-hidden', 'true')
  mark.width = 52
  mark.height = 52

  const title = document.createElement('h1')
  title.textContent = translatedMessage('widgetGateTitle')

  const description = document.createElement('p')
  description.className = 'description'
  description.textContent = translatedMessage('widgetGateDescription')

  const continueButton = document.createElement('button')
  continueButton.type = 'button'
  continueButton.className = 'primary-button'
  continueButton.setAttribute('aria-label', translatedMessage('widgetContinue'))
  continueButton.textContent = translatedMessage('widgetContinue')

  const openVaultButton = document.createElement('button')
  openVaultButton.type = 'button'
  openVaultButton.className = 'secondary-button'
  openVaultButton.setAttribute(
    'aria-label',
    translatedMessage('widgetOpenVault'),
  )
  openVaultButton.textContent = translatedMessage('widgetOpenVault')
  openVaultButton.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'nook:open-simple-vault' })
  })

  continueButton.addEventListener('click', () => {
    void continueWithNook(description, continueButton, openVaultButton, body)
  })

  body.append(mark, title, description, continueButton, openVaultButton)

  const collapsedLaunch = document.createElement('button')
  collapsedLaunch.type = 'button'
  collapsedLaunch.className = 'collapsed-launch'
  collapsedLaunch.setAttribute('aria-label', translatedMessage('widgetExpand'))
  collapsedLaunch.setAttribute('data-testid', 'nook-auth-gate-expand')

  const collapsedMark = document.createElement('img')
  collapsedMark.className = 'collapsed-mark'
  collapsedMark.src = chrome.runtime.getURL('icons/nook.png')
  collapsedMark.alt = ''
  collapsedMark.width = 40
  collapsedMark.height = 40
  collapsedLaunch.append(collapsedMark)

  const applyCollapsedState = (): void => {
    panel.classList.toggle('is-collapsed', widgetCollapsed)
    collapseButton.hidden = widgetCollapsed
    toolbar.hidden = widgetCollapsed
    body.hidden = widgetCollapsed
    collapsedLaunch.hidden = !widgetCollapsed
    host.setAttribute('aria-expanded', widgetCollapsed ? 'false' : 'true')
    requestAnimationFrame(() => {
      if (!widgetPosition) return
      widgetPosition = clampWidgetPosition(
        widgetPosition.left,
        widgetPosition.top,
        host.offsetWidth,
        host.offsetHeight,
      )
      applyWidgetPosition(host, widgetPosition)
    })
  }

  collapseButton.addEventListener('click', () => {
    widgetCollapsed = true
    applyCollapsedState()
  })

  const style = document.createElement('style')
  style.textContent = `
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
      width: min(320px, calc(100vw - 36px));
      display: grid;
      gap: 12px;
      padding: 14px 14px 16px;
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
      gap: 12px;
    }
    .mark {
      display: block;
      width: 52px;
      height: 52px;
      margin: 0 auto;
      border-radius: 12px;
      object-fit: contain;
    }
    .collapsed-launch {
      appearance: none;
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
    h1 {
      margin: 0;
      font-size: 18px;
      line-height: 1.25;
      text-align: center;
    }
    .description {
      margin: 0;
      color: oklch(0.705 0.015 286.067);
      font-size: 13px;
      line-height: 1.4;
      text-align: center;
    }
    .account-list {
      display: grid;
      gap: 8px;
    }
    button.primary-button,
    button.secondary-button {
      appearance: none;
      min-height: 40px;
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
    button:focus-visible {
      outline: 2px solid rgb(180 186 198 / 45%);
      outline-offset: 2px;
    }
  `

  panel.append(toolbar, body, collapsedLaunch)
  shadow.append(style, panel)
  document.documentElement.append(host)
  widgetHost = host

  attachPointerDrag(host, toolbar)
  attachPointerDrag(host, collapsedLaunch, {
    onTap: () => {
      widgetCollapsed = false
      applyCollapsedState()
    },
  })
  applyCollapsedState()
  if (widgetPosition) {
    applyWidgetPosition(host, widgetPosition)
  }
}

function scheduleScan() {
  if (pendingScan !== undefined) {
    window.clearTimeout(pendingScan)
  }

  pendingScan = window.setTimeout(() => {
    pendingScan = undefined
    renderWidget()
  }, 150)
}

if (!isRuntimeNookVaultAppUrl(location.href)) {
  renderWidget()

  const observer = new MutationObserver(scheduleScan)
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  })
}
