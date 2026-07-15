export {}

import { summarizePasswordForms } from '../../../nook-web-shared/src/extension/password-forms'

const WIDGET_HOST_ID = 'nook-auth-widget'
const SIMPLE_ORIGIN = 'https://simple.nokey.sh'
const SENTINEL_ORIGIN = 'https://sentinel.nokey.sh'

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

  const openButton = document.createElement('button')
  openButton.type = 'button'
  openButton.className = 'open-button'
  openButton.setAttribute('aria-label', translatedMessage('widgetOpenVault'))
  const mark = document.createElement('span')
  mark.className = 'mark'
  mark.ariaHidden = 'true'
  mark.textContent = 'N'
  const labels = document.createElement('span')
  const brand = document.createElement('strong')
  brand.textContent = 'Nook'
  const action = document.createElement('small')
  action.textContent = translatedMessage('widgetOpenVault')
  labels.append(brand, action)
  openButton.append(mark, labels)
  openButton.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'nook:open-simple-vault' })
  })

  const dismissButton = document.createElement('button')
  dismissButton.type = 'button'
  dismissButton.className = 'dismiss-button'
  dismissButton.textContent = '×'
  dismissButton.setAttribute('aria-label', translatedMessage('widgetDismiss'))
  dismissButton.addEventListener('click', () => {
    dismissed = true
    removeWidget()
  })

  const style = document.createElement('style')
  style.textContent = `
    :host { all: initial; position: fixed; z-index: 2147483647; top: 18px; right: 18px; }
    .panel { align-items: center; background: #f8faf8; border: 1px solid #cbd8ce; border-radius: 12px; box-shadow: 0 12px 32px rgba(23, 32, 26, .18); display: flex; font-family: Inter, ui-sans-serif, system-ui, sans-serif; padding: 5px; }
    button { appearance: none; border: 0; cursor: pointer; font: inherit; }
    .open-button { align-items: center; background: transparent; color: #17201a; display: flex; gap: 9px; padding: 5px 8px 5px 5px; text-align: left; }
    .open-button > span:last-child { display: grid; gap: 1px; }
    .mark { align-items: center; background: #203c2a; border-radius: 8px; color: white; display: flex; font-size: 14px; font-weight: 800; height: 30px; justify-content: center; width: 30px; }
    strong { font-size: 13px; line-height: 1.1; }
    small { color: #58645b; font-size: 11px; line-height: 1.2; }
    .dismiss-button { background: transparent; border-radius: 6px; color: #68736b; font-size: 18px; line-height: 1; padding: 6px 8px; }
    .dismiss-button:hover, .open-button:hover { background: #edf3ee; }
    button:focus-visible { outline: 2px solid #356f49; outline-offset: 2px; }
  `

  panel.append(openButton, dismissButton)
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

if (location.origin !== SIMPLE_ORIGIN && location.origin !== SENTINEL_ORIGIN) {
  renderWidget()

  const observer = new MutationObserver(scheduleScan)
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  })
}
