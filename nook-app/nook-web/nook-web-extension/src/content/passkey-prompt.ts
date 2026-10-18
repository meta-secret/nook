/*
 * The website passkey consent card. It docks in the Pilot's top-right corner
 * in the shared keytag style, leaves the page usable, and stays through the
 * ceremony: choose, then Saving…, then Saved or a visible failure. A page can
 * imitate any in-page UI, so the card never asks for a secret.
 */
import {
  BROWSER_MESSAGE_KEYS,
  type BrowserMessageKey,
} from '../lib/browser-message-keys'
import { WebsitePasskeyCeremony } from '../lib/webauthn-message-types'
import { IN_PAGE_SURFACE_TOKENS, WIDGET_HOST_ID } from './in-page-surface'

export type PasskeyOption = {
  vaultStoreId: string
  vaultName: string
  account?: {
    credentialId: string
    userName: string
    userDisplayName: string
  }
}

export enum PasskeyPromptChoiceKind {
  Selected = 'selected',
  BrowserFallback = 'browser-fallback',
  Dismissed = 'dismissed',
}

export type PasskeyPromptChoice =
  | { kind: PasskeyPromptChoiceKind.Selected; option: PasskeyOption }
  | { kind: PasskeyPromptChoiceKind.BrowserFallback }
  | { kind: PasskeyPromptChoiceKind.Dismissed }

export type PasskeyPromptRequest = {
  ceremony: WebsitePasskeyCeremony
  /** The domain the passkey belongs to. */
  site: string
  /** What the site calls itself, or its domain. */
  siteName: string
  /** The account the site is registering, as the site names it. */
  userName?: string
  options: PasskeyOption[]
}

enum PasskeyPromptState {
  Choosing = 'choosing',
  Working = 'working',
  Saved = 'saved',
  Failed = 'failed',
}

enum PasskeyPromptIcon {
  Close = 'close',
  Check = 'check',
  Alert = 'alert',
}

enum PasskeyPromptTone {
  Working = 'working',
  Success = 'success',
  Warning = 'warning',
}

type PasskeyPromptMessage = {
  key: BrowserMessageKey
  substitution: string
}

type PasskeyPromptStatus = {
  tone: PasskeyPromptTone
  text: string
}

type PasskeyPromptPanelArgs = {
  request: PasskeyPromptRequest
  /** Closes the card once the ceremony no longer needs an answer. */
  onClose: () => void
}

const SAVED_CARD_MS = 3_000

const DISMISSED: PasskeyPromptChoice = {
  kind: PasskeyPromptChoiceKind.Dismissed,
}
const BROWSER_FALLBACK: PasskeyPromptChoice = {
  kind: PasskeyPromptChoiceKind.BrowserFallback,
}

function selected(option: PasskeyOption): PasskeyPromptChoice {
  return { kind: PasskeyPromptChoiceKind.Selected, option }
}

const ICON_PATHS: Record<PasskeyPromptIcon, string[]> = {
  [PasskeyPromptIcon.Close]: ['M18 6 6 18', 'm6 6 12 12'],
  [PasskeyPromptIcon.Check]: ['M20 6 9 17l-5-5'],
  [PasskeyPromptIcon.Alert]: [
    'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z',
    'M12 8v4',
    'M12 16h.01',
  ],
}

const PASSKEY_PROMPT_STYLES = `
    :host {
      all: initial;
      position: fixed;
      z-index: 2147483647;
      top: 18px;
      right: 18px;
      ${IN_PAGE_SURFACE_TOKENS}
      filter: drop-shadow(0 18px 36px rgb(0 0 0 / 45%));
    }
    [hidden] { display: none !important; }
    .panel {
      box-sizing: border-box;
      position: relative;
      isolation: isolate;
      width: min(340px, calc(100vw - 36px));
      max-height: calc(100dvh - 36px);
      overflow-y: auto;
      display: grid;
      gap: 14px;
      padding: 12px 14px 16px;
      background: var(--nk-border);
      color: var(--nk-fg);
      font: 400 13px/1.4 Inter, ui-sans-serif, system-ui, sans-serif;
      clip-path: polygon(0 0, calc(100% - var(--nk-cut)) 0, 100% var(--nk-cut), 100% 100%, 0 100%);
      animation: nk-enter 180ms cubic-bezier(0.2, 0.8, 0.2, 1);
    }
    .panel::before {
      content: '';
      position: absolute;
      inset: 1px;
      z-index: -1;
      background: var(--nk-card);
      clip-path: polygon(0 0, calc(100% - var(--nk-cut) + 0.41px) 0, 100% calc(var(--nk-cut) - 0.41px), 100% 100%, 0 100%);
    }
    .panel:focus { outline: none; }
    @keyframes nk-enter { from { opacity: 0; transform: translateY(-6px); } }
    @keyframes nk-spin { to { transform: rotate(360deg); } }
    .toolbar {
      display: grid;
      grid-template-columns: auto 1fr auto;
      align-items: center;
      gap: 8px;
      margin: 0 -2px;
      padding-bottom: 10px;
      border-bottom: 1px solid var(--nk-border);
    }
    .mark { display: block; width: 22px; height: 22px; object-fit: contain; }
    .step-label, .field-label {
      margin: 0;
      padding: 0;
      color: var(--nk-muted);
      font: 500 10.5px/1.3 var(--nk-mono);
      letter-spacing: 0.14em;
      text-transform: uppercase;
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
    h1 {
      margin: 2px 0 0;
      font-size: 17px;
      font-weight: 600;
      letter-spacing: -0.01em;
      line-height: 1.25;
      overflow-wrap: anywhere;
    }
    .body { display: grid; gap: 14px; }
    .site-row {
      display: flex;
      align-items: center;
      gap: 7px;
      margin: 0;
      padding: 8px 10px;
      border: 1px solid var(--nk-border);
      background: var(--nk-bg);
      font: 500 11.5px/1.3 var(--nk-mono);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .site-row::before {
      content: '';
      flex: none;
      width: 6px;
      height: 6px;
      background: var(--nk-success);
    }
    .field { display: grid; gap: 6px; min-width: 0; margin: 0; padding: 0; border: 0; }
    legend.field-label { margin-bottom: 6px; }
    .field-value { margin: 0; font-size: 14px; font-weight: 500; overflow-wrap: anywhere; }
    .choices { display: grid; gap: 6px; }
    .vault-option {
      display: flex;
      align-items: center;
      gap: 10px;
      min-height: 40px;
      padding: 0 12px;
      border: 1px solid var(--nk-border);
      background: var(--nk-bg);
      cursor: pointer;
    }
    .vault-option:hover { border-color: var(--nk-input); }
    .vault-option:has(input:checked) { border-color: var(--nk-input); background: var(--nk-raised); }
    .vault-option input {
      appearance: none;
      flex: none;
      width: 14px;
      height: 14px;
      margin: 0;
      border: 1px solid var(--nk-input);
      background: transparent;
      cursor: pointer;
    }
    .vault-option input:checked {
      border-color: var(--nk-primary);
      background: var(--nk-primary);
      box-shadow: inset 0 0 0 3px var(--nk-raised);
    }
    .vault-name, .account-name, .account-detail {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .vault-name { font-weight: 600; }
    .account-option {
      appearance: none;
      display: grid;
      grid-template-columns: auto 1fr;
      align-items: center;
      gap: 10px;
      width: 100%;
      min-height: 50px;
      padding: 8px 10px;
      border: 1px solid var(--nk-border);
      border-radius: 3px;
      background: var(--nk-bg);
      color: var(--nk-fg);
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .account-option:hover { border-color: var(--nk-input); background: var(--nk-raised); }
    .avatar {
      display: grid;
      place-items: center;
      width: 30px;
      height: 30px;
      border: 1px solid var(--nk-input);
      background: var(--nk-card);
      font: 600 12px/1 var(--nk-mono);
      text-transform: uppercase;
    }
    .account-copy { display: grid; gap: 2px; min-width: 0; }
    .account-name { font-size: 13.5px; font-weight: 600; }
    .account-detail { color: var(--nk-muted); font: 400 11px/1.3 var(--nk-mono); }
    .actions { display: grid; gap: 10px; }
    .primary-button {
      appearance: none;
      min-height: 40px;
      padding: 9px 12px;
      border: 1px solid transparent;
      border-radius: 3px;
      background: var(--nk-primary);
      color: var(--nk-primary-fg);
      cursor: pointer;
      font: 600 13px/1.2 Inter, ui-sans-serif, system-ui, sans-serif;
    }
    .primary-button:hover { background: color-mix(in oklab, var(--nk-primary) 90%, black); }
    .text-button {
      appearance: none;
      width: fit-content;
      margin: 0 auto;
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
    .status {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      margin: 0;
      padding: 10px 11px;
      border-left: 2px solid var(--nk-input);
      background: var(--nk-bg);
      line-height: 1.45;
      overflow-wrap: anywhere;
    }
    .status[data-tone='success'] { border-left-color: var(--nk-success); }
    .status[data-tone='warning'] { border-left-color: var(--nk-warning); }
    .status-mark { flex: none; width: 16px; height: 16px; margin-top: 1px; }
    .status[data-tone='working'] .status-mark {
      box-sizing: border-box;
      border: 2px solid var(--nk-input);
      border-top-color: var(--nk-fg);
      border-radius: 50%;
      animation: nk-spin 800ms linear infinite;
    }
    .status[data-tone='success'] .status-mark { color: var(--nk-success); }
    .status[data-tone='warning'] .status-mark { color: var(--nk-warning); }
    button:focus-visible, input:focus-visible {
      outline: 2px solid rgb(180 186 198 / 45%);
      outline-offset: 2px;
    }
    @media (prefers-reduced-motion: reduce) {
      .panel, .status[data-tone='working'] .status-mark { animation: none; }
    }
  `

function translate(key: BrowserMessageKey): string {
  return chrome.i18n.getMessage(key)
}

function translateWith({ key, substitution }: PasskeyPromptMessage): string {
  return chrome.i18n.getMessage(key, substitution)
}

/** `classed('panel')('section')`: an element carrying one style class. */
function classed(className: string) {
  return <K extends keyof HTMLElementTagNameMap>(
    tag: K,
  ): HTMLElementTagNameMap[K] => {
    const node = document.createElement(tag)
    node.className = className
    return node
  }
}

/** A 24-unit Lucide stroke icon. */
function icon(kind: PasskeyPromptIcon): SVGSVGElement {
  const namespace = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(namespace, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '2')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  for (const d of ICON_PATHS[kind]) {
    const path = document.createElementNS(namespace, 'path')
    path.setAttribute('d', d)
    svg.append(path)
  }
  return svg
}

/** The card's content and its states; the page mount stays separate. */
export class PasskeyPromptPanel {
  readonly element = classed('panel')('section')
  readonly choice: Promise<PasskeyPromptChoice>
  private readonly resolveChoice: (choice: PasskeyPromptChoice) => void
  private readonly title = document.createElement('h1')
  private readonly body = classed('body')('div')
  private readonly closeButton = classed('icon-button')('button')
  private state = PasskeyPromptState.Choosing

  constructor(private readonly args: PasskeyPromptPanelArgs) {
    let resolveChoice: (choice: PasskeyPromptChoice) => void = () => {}
    this.choice = new Promise((resolve) => {
      resolveChoice = resolve
    })
    this.resolveChoice = resolveChoice
    this.element.setAttribute('role', 'dialog')
    this.element.setAttribute('aria-modal', 'false')
    this.element.setAttribute('aria-labelledby', 'nook-passkey-title')
    this.element.tabIndex = -1
    this.title.id = 'nook-passkey-title'
    this.element.append(this.toolbar(), this.title, this.body)
    this.showChoices()
  }

  get creating(): boolean {
    return this.args.request.ceremony === WebsitePasskeyCeremony.Create
  }

  /** Escape and the close button: decline while choosing, else close. */
  dismiss(): void {
    switch (this.state) {
      case PasskeyPromptState.Choosing:
        this.resolveChoice(DISMISSED)
        return
      case PasskeyPromptState.Working:
        return
      case PasskeyPromptState.Saved:
      case PasskeyPromptState.Failed:
        this.args.onClose()
    }
  }

  focusFirst(): void {
    const target = this.body.querySelector<HTMLElement>(
      '.primary-button, .account-option',
    )
    const focusTarget = target ? target : this.element
    focusTarget.focus()
  }

  showWorking(): void {
    this.state = PasskeyPromptState.Working
    this.closeButton.hidden = true
    const status: PasskeyPromptStatus = {
      tone: PasskeyPromptTone.Working,
      text: translate(
        this.creating
          ? BROWSER_MESSAGE_KEYS.PasskeySaving
          : BROWSER_MESSAGE_KEYS.PasskeySigningIn,
      ),
    }
    this.showStatus(status)
  }

  showSaved(vaultName: string): void {
    this.state = PasskeyPromptState.Saved
    this.closeButton.hidden = false
    this.title.textContent = translate(BROWSER_MESSAGE_KEYS.PasskeySavedTitle)
    const detail: PasskeyPromptMessage = {
      key: BROWSER_MESSAGE_KEYS.PasskeySavedDetail,
      substitution: vaultName,
    }
    const status: PasskeyPromptStatus = {
      tone: PasskeyPromptTone.Success,
      text: translateWith(detail),
    }
    this.showStatus(status)
  }

  showFailed(): void {
    this.state = PasskeyPromptState.Failed
    this.closeButton.hidden = false
    const status: PasskeyPromptStatus = {
      tone: PasskeyPromptTone.Warning,
      text: translate(
        this.creating
          ? BROWSER_MESSAGE_KEYS.PasskeySaveFailed
          : BROWSER_MESSAGE_KEYS.PasskeyUseFailed,
      ),
    }
    this.showStatus(status)
    this.closeButton.focus()
  }

  private toolbar(): HTMLElement {
    const toolbar = classed('toolbar')('header')
    const mark = classed('mark')('img')
    mark.src = chrome.runtime.getURL('icons/nook.png')
    mark.alt = ''
    mark.width = 22
    mark.height = 22
    const label = classed('step-label')('p')
    label.textContent = translate(BROWSER_MESSAGE_KEYS.PasskeyLabel)
    this.closeButton.type = 'button'
    this.closeButton.setAttribute(
      'aria-label',
      translate(BROWSER_MESSAGE_KEYS.PasskeyClose),
    )
    this.closeButton.append(icon(PasskeyPromptIcon.Close))
    this.closeButton.addEventListener('click', () => this.dismiss())
    toolbar.append(mark, label, this.closeButton)
    return toolbar
  }

  private siteRow(): HTMLElement {
    const row = classed('site-row')('p')
    row.textContent = this.args.request.site
    return row
  }

  private showChoices(): void {
    const { request } = this.args
    const title: PasskeyPromptMessage = {
      key: this.creating
        ? BROWSER_MESSAGE_KEYS.PasskeySaveTitle
        : BROWSER_MESSAGE_KEYS.PasskeyUseTitle,
      substitution: request.siteName,
    }
    this.title.textContent = translateWith(title)
    const choices = this.creating ? this.saveChoices() : this.accountChoices()
    const browser = classed('text-button')('button')
    browser.type = 'button'
    browser.textContent = translate(BROWSER_MESSAGE_KEYS.PasskeyUseBrowser)
    browser.addEventListener('click', () =>
      this.resolveChoice(BROWSER_FALLBACK),
    )
    this.body.replaceChildren(this.siteRow(), ...choices, browser)
  }

  /** Registration: who the site is saving, where it goes, one Save. */
  private saveChoices(): HTMLElement[] {
    const { request } = this.args
    const fields: HTMLElement[] = []
    if (request.userName) {
      const account = classed('field')('div')
      const label = classed('field-label')('p')
      label.textContent = translate(BROWSER_MESSAGE_KEYS.PasskeyAccountLabel)
      const value = classed('field-value')('p')
      value.textContent = request.userName
      account.append(label, value)
      fields.push(account)
    }
    const vaults = classed('field')('fieldset')
    const legend = classed('field-label')('legend')
    legend.textContent = translate(BROWSER_MESSAGE_KEYS.PasskeySaveToLabel)
    const list = classed('choices')('div')
    const radios = request.options.map((option) => {
      const row = classed('vault-option')('label')
      const radio = document.createElement('input')
      radio.type = 'radio'
      radio.name = 'nook-passkey-vault'
      radio.checked = option === request.options[0]
      const name = classed('vault-name')('span')
      name.textContent = option.vaultName
      row.append(radio, name)
      list.append(row)
      return radio
    })
    vaults.append(legend, list)
    const save = classed('primary-button')('button')
    save.type = 'button'
    save.textContent = translate(BROWSER_MESSAGE_KEYS.PasskeySaveAction)
    save.addEventListener('click', () => {
      const index = radios.findIndex((radio) => radio.checked)
      const option = request.options[index < 0 ? 0 : index]
      if (option) this.resolveChoice(selected(option))
    })
    return [...fields, vaults, save]
  }

  /** Assertion: one row per account; choosing a row is the consent. */
  private accountChoices(): HTMLElement[] {
    const label = classed('field-label')('p')
    label.textContent = translate(BROWSER_MESSAGE_KEYS.PasskeyChooseAccount)
    const list = classed('choices')('div')
    for (const option of this.args.request.options) {
      const account = option.account
      const name = account
        ? account.userDisplayName || account.userName
        : option.vaultName
      const button = classed('account-option')('button')
      button.type = 'button'
      const avatar = classed('avatar')('span')
      avatar.setAttribute('aria-hidden', 'true')
      avatar.textContent = Array.from(name).slice(0, 1).join('')
      const copy = classed('account-copy')('span')
      const primary = classed('account-name')('span')
      primary.textContent = name
      const detail = classed('account-detail')('span')
      detail.textContent =
        account && account.userName !== name
          ? `${account.userName} · ${option.vaultName}`
          : option.vaultName
      copy.append(primary, detail)
      button.append(avatar, copy)
      button.addEventListener('click', () =>
        this.resolveChoice(selected(option)),
      )
      list.append(button)
    }
    const field = classed('field')('div')
    field.append(label, list)
    return [field]
  }

  private showStatus({ tone, text }: PasskeyPromptStatus): void {
    const status = classed('status')('p')
    status.dataset.tone = tone
    status.setAttribute('role', 'status')
    const mark = classed('status-mark')('span')
    switch (tone) {
      case PasskeyPromptTone.Success:
        mark.append(icon(PasskeyPromptIcon.Check))
        break
      case PasskeyPromptTone.Warning:
        mark.append(icon(PasskeyPromptIcon.Alert))
        break
      case PasskeyPromptTone.Working:
        break
    }
    const copy = document.createElement('span')
    copy.textContent = text
    status.append(mark, copy)
    const focusInside = this.element.contains(document.activeElement)
    this.body.replaceChildren(this.siteRow(), status)
    if (focusInside) this.element.focus()
  }
}

/**
 * Mounts the card in a closed shadow root at the top-right of the page. The
 * Pilot steps aside while the card is up, since they share that corner.
 */
export class PasskeyPrompt {
  private readonly host = document.createElement('aside')
  private readonly panel: PasskeyPromptPanel
  private readonly pilot = document.getElementById(WIDGET_HOST_ID)
  private closeTimer: ReturnType<typeof setTimeout> | undefined

  private constructor(request: PasskeyPromptRequest) {
    const panelArgs: PasskeyPromptPanelArgs = {
      request,
      onClose: () => this.close(),
    }
    this.panel = new PasskeyPromptPanel(panelArgs)
    this.host.setAttribute(
      'aria-label',
      translate(BROWSER_MESSAGE_KEYS.PasskeyPromptLabel),
    )
    this.host.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      this.panel.dismiss()
    })
    const shadowInit: ShadowRootInit = { mode: 'closed' }
    const shadow = this.host.attachShadow(shadowInit)
    const style = document.createElement('style')
    style.textContent = PASSKEY_PROMPT_STYLES
    shadow.append(style, this.panel.element)
  }

  static open(request: PasskeyPromptRequest): PasskeyPrompt {
    const prompt = new PasskeyPrompt(request)
    prompt.pilot?.style.setProperty('visibility', 'hidden')
    document.documentElement.append(prompt.host)
    prompt.panel.focusFirst()
    return prompt
  }

  get choice(): Promise<PasskeyPromptChoice> {
    return this.panel.choice
  }

  showWorking(): void {
    this.panel.showWorking()
  }

  /** Confirms the save, then leaves on its own. */
  showSaved(vaultName: string): void {
    this.panel.showSaved(vaultName)
    this.closeTimer = setTimeout(() => this.close(), SAVED_CARD_MS)
  }

  /** Stays until the user closes it, so a failure is never silent. */
  showFailed(): void {
    this.panel.showFailed()
  }

  close(): void {
    clearTimeout(this.closeTimer)
    this.host.remove()
    this.pilot?.style.removeProperty('visibility')
  }
}
