export {}

import { summarizePasswordForms } from '../../../nook-web-shared/src/extension/password-forms'
import {
  isRuntimeSentinelVaultUrl,
  isRuntimeSimpleVaultUrl,
} from '../lib/simple-vault-runtime'

const WIDGET_HOST_ID = 'nook-auth-widget'

let pendingScan: number | undefined
let widgetHost: HTMLElement | undefined
let dismissed = false

function translatedMessage(key: string): string {
  return chrome.i18n.getMessage(key) || 'Nook'
}

function removeWidget(): void {
  widgetHost?.remove()
  widgetHost = undefined
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

  const dismissButton = document.createElement('button')
  dismissButton.type = 'button'
  dismissButton.className = 'dismiss-button'
  dismissButton.textContent = '×'
  dismissButton.setAttribute('aria-label', translatedMessage('widgetDismiss'))
  dismissButton.addEventListener('click', () => {
    dismissed = true
    removeWidget()
  })

  const step = document.createElement('p')
  step.className = 'step-label'
  step.textContent = translatedMessage('widgetGateStep')

  const mark = document.createElement('div')
  mark.className = 'mark'
  mark.ariaHidden = 'true'
  mark.textContent = 'N'

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
  continueButton.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'nook:open-companion-launcher' })
  })

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
    .panel {
      position: relative;
      width: min(320px, calc(100vw - 36px));
      display: grid;
      gap: 12px;
      padding: 18px 16px 16px;
      border: 1px solid rgb(255 255 255 / 10%);
      border-radius: 12px;
      background: oklch(0.141 0.005 285.823);
      color: oklch(0.985 0 0);
      box-shadow: 0 16px 40px rgb(0 0 0 / 35%);
      font-family: Inter, ui-sans-serif, system-ui, sans-serif;
    }
    .dismiss-button {
      position: absolute;
      top: 8px;
      right: 8px;
      appearance: none;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: oklch(0.705 0.015 286.067);
      cursor: pointer;
      font: inherit;
      font-size: 18px;
      line-height: 1;
      padding: 4px 8px;
    }
    .dismiss-button:hover { background: oklch(0.274 0.006 286.033); }
    .step-label {
      margin: 0 24px 0 0;
      color: oklch(0.705 0.015 286.067);
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-align: center;
      text-transform: uppercase;
    }
    .mark {
      display: grid;
      place-items: center;
      width: 44px;
      height: 44px;
      margin: 0 auto;
      border-radius: 999px;
      background: color-mix(in oklab, oklch(0.92 0.004 286.32) 12%, transparent);
      color: oklch(0.92 0.004 286.32);
      font-size: 16px;
      font-weight: 800;
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
    .primary-button {
      border: 1px solid transparent;
      background: oklch(0.92 0.004 286.32);
      color: oklch(0.21 0.006 285.885);
    }
    .primary-button:hover {
      background: color-mix(in oklab, oklch(0.92 0.004 286.32) 90%, black);
    }
    .secondary-button {
      border: 1px solid rgb(255 255 255 / 10%);
      background: transparent;
      color: oklch(0.985 0 0);
    }
    .secondary-button:hover {
      background: oklch(0.274 0.006 286.033);
    }
    button:focus-visible {
      outline: 2px solid rgb(180 186 198 / 45%);
      outline-offset: 2px;
    }
  `

  panel.append(
    dismissButton,
    step,
    mark,
    title,
    description,
    continueButton,
    openVaultButton,
  )
  shadow.append(style, panel)
  document.documentElement.append(host)
  widgetHost = host
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

if (
  !isRuntimeSimpleVaultUrl(location.href) &&
  !isRuntimeSentinelVaultUrl(location.href)
) {
  renderWidget()

  const observer = new MutationObserver(scheduleScan)
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  })
}
