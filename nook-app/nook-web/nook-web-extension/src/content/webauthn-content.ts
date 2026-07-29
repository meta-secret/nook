export {}

import {
  WebsitePasskeyCeremony,
  type WebsitePasskeyCancelMessage,
  type WebsitePasskeyOptionsMessage,
  type WebsitePasskeyPerformMessage,
} from '../lib/webauthn-messages'

const REQUEST_SOURCE = 'nook-passkey-page-v1'
const RESPONSE_SOURCE = 'nook-passkey-extension-v1'
const prompts = new Map<string, HTMLElement>()

enum PageRequestType {
  Request = 'request',
}

enum PageResponseAction {
  Fallback = 'fallback',
  Result = 'result',
  Error = 'error',
}

type PageRequest = {
  source: typeof REQUEST_SOURCE
  type: PageRequestType.Request
  requestId: string
  ceremony: WebsitePasskeyCeremony
  request: Record<string, unknown>
  expiresAt: number
}

type PasskeyOption = {
  vaultStoreId: string
  vaultName: string
  account?: {
    credentialId: string
    userName: string
    userDisplayName: string
  }
}

enum PasskeyOptionChoiceKind {
  BrowserFallback = 'browser-fallback',
  Selected = 'selected',
}

type PasskeyOptionChoice =
  | { kind: PasskeyOptionChoiceKind.BrowserFallback }
  | { kind: PasskeyOptionChoiceKind.Selected; option: PasskeyOption }

enum PasskeyOptionsStatus {
  Ready = 'ready',
}

function t(key: string, fallback: string): string {
  return chrome.i18n.getMessage(key) || fallback
}

function respond(
  requestId: string,
  action: PageResponseAction,
  value?: unknown,
): void {
  window.postMessage(
    {
      source: RESPONSE_SOURCE,
      requestId,
      action,
      ...(action === PageResponseAction.Result ? { result: value } : {}),
      ...(action === PageResponseAction.Error ? { reason: value } : {}),
    },
    location.origin,
  )
}

function runtimeMessage<T>(message: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage<T>(message, (response) => {
      const error = chrome.runtime.lastError?.message
      if (error) reject(new Error(error))
      else resolve(response)
    })
  })
}

function validOptions(value: unknown): PasskeyOption[] {
  if (!Array.isArray(value)) return []
  return value.filter((option): option is PasskeyOption => {
    if (!option || typeof option !== 'object') return false
    const row = option as Record<string, unknown>
    return (
      typeof row.vaultStoreId === 'string' && typeof row.vaultName === 'string'
    )
  })
}

function removePrompt(requestId: string): void {
  prompts.get(requestId)?.remove()
  prompts.delete(requestId)
}

function chooseOption(
  request: PageRequest,
  options: PasskeyOption[],
): Promise<PasskeyOptionChoice> {
  return new Promise((resolve) => {
    const host = document.createElement('aside')
    host.setAttribute('aria-label', 'Nook passkey')
    const shadow = host.attachShadow({ mode: 'closed' })
    const panel = document.createElement('section')
    panel.setAttribute('role', 'dialog')
    panel.setAttribute('aria-modal', 'true')
    const heading = document.createElement('h2')
    heading.textContent = t(
      request.ceremony === WebsitePasskeyCeremony.Create
        ? 'passkeySaveTitle'
        : 'passkeyUseTitle',
      request.ceremony === WebsitePasskeyCeremony.Create
        ? 'Save a passkey with Nook?'
        : 'Use a Nook passkey?',
    )
    const detail = document.createElement('p')
    const relyingParty = request.request.relyingParty
    const rp =
      request.ceremony === WebsitePasskeyCeremony.Create &&
      relyingParty &&
      typeof relyingParty === 'object' &&
      'name' in relyingParty
        ? relyingParty.name
        : request.request.rpId
    detail.textContent = typeof rp === 'string' ? rp : location.hostname
    const choices = document.createElement('div')
    for (const option of options) {
      const button = document.createElement('button')
      button.type = 'button'
      const account = option.account
      button.textContent = account
        ? `${account.userDisplayName || account.userName} · ${option.vaultName}`
        : option.vaultName
      button.addEventListener('click', () => {
        removePrompt(request.requestId)
        resolve({ kind: PasskeyOptionChoiceKind.Selected, option })
      })
      choices.append(button)
    }
    const fallback = document.createElement('button')
    fallback.type = 'button'
    fallback.className = 'fallback'
    fallback.textContent = t('passkeyUseBrowser', 'Use browser or security key')
    fallback.addEventListener('click', () => {
      removePrompt(request.requestId)
      resolve({ kind: PasskeyOptionChoiceKind.BrowserFallback })
    })
    const style = document.createElement('style')
    style.textContent = `
      :host { all: initial; position: fixed; inset: 0; z-index: 2147483647; display: grid; place-items: center; background: rgba(10, 18, 13, .45); }
      section { box-sizing: border-box; width: min(420px, calc(100vw - 32px)); border: 1px solid #bdcbbf; border-radius: 16px; background: #f8faf8; box-shadow: 0 24px 70px rgba(10, 18, 13, .28); color: #17201a; font-family: Inter, ui-sans-serif, system-ui, sans-serif; padding: 22px; }
      h2 { font-size: 20px; line-height: 1.25; margin: 0; }
      p { color: #58645b; font-size: 14px; margin: 8px 0 18px; overflow-wrap: anywhere; }
      div { display: grid; gap: 9px; }
      button { appearance: none; border: 1px solid #b7c8bb; border-radius: 10px; background: #fff; color: #17201a; cursor: pointer; font: 600 14px/1.3 Inter, ui-sans-serif, system-ui, sans-serif; padding: 12px 14px; text-align: left; }
      button:hover, button:focus-visible { border-color: #356f49; outline: 2px solid #b8d7c1; outline-offset: 1px; }
      .fallback { background: transparent; border-color: transparent; color: #356f49; margin-top: 8px; text-align: center; width: 100%; }
    `
    panel.append(heading, detail, choices, fallback)
    shadow.append(style, panel)
    document.documentElement.append(host)
    prompts.set(request.requestId, host)
    choices.querySelector('button')?.focus()
  })
}

async function handleRequest(request: PageRequest): Promise<void> {
  const requestJson = JSON.stringify(request.request)
  const optionsResponse = await runtimeMessage<{
    ok?: boolean
    status?: PasskeyOptionsStatus
    options?: unknown
  }>({
    type: 'nook:website-passkey-options',
    payload: {
      requestId: request.requestId,
      ceremony: request.ceremony,
      requestJson,
      expiresAt: request.expiresAt,
    },
  } satisfies WebsitePasskeyOptionsMessage)
  const options = validOptions(optionsResponse?.options)
  if (
    optionsResponse?.ok !== true ||
    optionsResponse.status !== PasskeyOptionsStatus.Ready ||
    options.length === 0
  ) {
    respond(request.requestId, PageResponseAction.Fallback)
    return
  }
  const choice = await chooseOption(request, options)
  if (choice.kind === PasskeyOptionChoiceKind.BrowserFallback) {
    respond(request.requestId, PageResponseAction.Fallback)
    return
  }
  const { option: selected } = choice
  const result = await runtimeMessage<Record<string, unknown>>({
    type: 'nook:website-passkey-perform',
    payload: {
      requestId: request.requestId,
      ceremony: request.ceremony,
      requestJson,
      expiresAt: request.expiresAt,
      vaultStoreId: selected.vaultStoreId,
      credentialId: selected.account?.credentialId,
    },
  } satisfies WebsitePasskeyPerformMessage)
  if (result?.ok === true) {
    respond(request.requestId, PageResponseAction.Result, result)
  } else {
    respond(request.requestId, PageResponseAction.Error, 'NotAllowedError')
  }
}

window.addEventListener('message', (event: MessageEvent<unknown>) => {
  if (
    event.source !== window ||
    event.origin !== location.origin ||
    !event.data ||
    typeof event.data !== 'object'
  )
    return
  const message = event.data as Record<string, unknown>
  if (
    message.source !== REQUEST_SOURCE ||
    typeof message.requestId !== 'string'
  )
    return
  if (message.type === 'cancel') {
    removePrompt(message.requestId)
    void runtimeMessage({
      type: 'nook:website-passkey-cancel',
      payload: { requestId: message.requestId },
    } satisfies WebsitePasskeyCancelMessage).catch(() => {})
    return
  }
  if (
    message.type !== PageRequestType.Request ||
    (message.ceremony !== WebsitePasskeyCeremony.Create &&
      message.ceremony !== WebsitePasskeyCeremony.Get) ||
    typeof message.expiresAt !== 'number' ||
    !Number.isFinite(message.expiresAt) ||
    message.expiresAt <= Date.now() ||
    !message.request ||
    typeof message.request !== 'object' ||
    JSON.stringify(message.request).length > 65_536
  )
    return
  void handleRequest(message as unknown as PageRequest).catch(() => {
    removePrompt(message.requestId as string)
    respond(message.requestId as string, PageResponseAction.Fallback)
  })
})
