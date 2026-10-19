import { Schema } from 'effect'
import { authenticationSubmissionBridge } from '../../../nook-web-shared/src/extension/authentication-direct-submit-bridge'
import {
  OpenCompanionLauncherMessageType,
  type OpenCompanionLauncherMessage,
} from '../../../nook-web-shared/src/extension/companion-launcher-message'
export {}

authenticationSubmissionBridge.installIsolatedAuthenticationDirectSubmitBridge()

import {
  WebsitePasskeyCeremony,
  WebsitePasskeyCancelMessageType,
  WebsitePasskeyOptionsMessageType,
  WebsitePasskeyOptionsStatus,
  WebsitePasskeyPerformMessageType,
} from '../lib/webauthn-message-types'
import type {
  WebsitePasskeyCancelMessage,
  WebsitePasskeyOptionsMessage,
  WebsitePasskeyOptionsResponse,
  WebsitePasskeyPerformMessage,
  WebsitePasskeyPerformResponse,
} from '../lib/webauthn-messages'
import {
  PageResponseAction,
  websitePasskeyOptionsDisposition,
  WebsitePasskeyOptionsDispositionKind,
  WebsitePasskeyUnavailableReason,
} from './webauthn-options-response'
import {
  ConcreteDecoderResultKind,
  runConcreteDecoder,
} from '../lib/concrete-decoder'
import {
  PasskeyLookupKind,
  PasskeyPrompt,
  PasskeyPromptChoiceKind,
  type PasskeyLookup,
  type PasskeyOption,
  type PasskeyPromptRequest,
  type PasskeyPromptUnlock,
} from './passkey-prompt'

const REQUEST_SOURCE = 'nook-passkey-page-v1'
const RESPONSE_SOURCE = 'nook-passkey-extension-v1'
const prompts = new Map<string, PasskeyPrompt>()
/** Finished cards still showing Saved or a failure; the next request replaces them. */
const settledPrompts = new Set<PasskeyPrompt>()

enum PageRequestType {
  Request = 'request',
  Cancel = 'cancel',
}

type PageRequest = {
  source: typeof REQUEST_SOURCE
  type: PageRequestType.Request
  requestId: string
  ceremony: WebsitePasskeyCeremony
  requestJson: string
  relyingPartyName?: string
  rpId?: string
  userName?: string
  expiresAt: number
}

enum PageRequestBodyDecodeKind {
  Rejected = 'rejected',
  Decoded = 'decoded',
}

enum PageRequestBodyStringFieldKind {
  Absent = 'absent',
  Present = 'present',
}

type PageRequestBodyStringField =
  | { kind: PageRequestBodyStringFieldKind.Absent }
  | { kind: PageRequestBodyStringFieldKind.Present; value: string }

type PageRequestBodyDecode =
  | { kind: PageRequestBodyDecodeKind.Rejected }
  | {
      kind: PageRequestBodyDecodeKind.Decoded
      requestJson: string
      relyingPartyName: PageRequestBodyStringField
      rpId: PageRequestBodyStringField
      userName: PageRequestBodyStringField
    }

type PasskeyAccount = NonNullable<PasskeyOption['account']>

type WebAuthnPageResponseDelivery = {
  requestId: string
  action: PageResponseAction
  value?: string | WebsitePasskeyPerformResponse
}

type WebsitePasskeyRuntimeMessage =
  | WebsitePasskeyOptionsMessage
  | WebsitePasskeyPerformMessage
  | WebsitePasskeyCancelMessage
  | OpenCompanionLauncherMessage

type OpenNookResponse = { ok: boolean }

const CHECK_FAILED: PasskeyLookup = {
  kind: PasskeyLookupKind.Offer,
  offer: {
    options: [],
    unavailable: WebsitePasskeyUnavailableReason.CheckFailed,
  },
}

function respond({
  requestId,
  action,
  value,
}: WebAuthnPageResponseDelivery): void {
  const nookTypedArgs0_0: Parameters<typeof window.postMessage>[0] = {
    source: RESPONSE_SOURCE,
    requestId,
    action,
    ...(action === PageResponseAction.Result ? { result: value } : {}),
    ...(action === PageResponseAction.Error ? { reason: value } : {}),
  }
  window.postMessage(nookTypedArgs0_0, location.origin)
}

class WebAuthnRuntimeTransport<T> {
  constructor(private readonly message: WebsitePasskeyRuntimeMessage) {}

  send(): Promise<T> {
    return new Promise((...[resolve, reject]) => {
      void chrome.runtime.sendMessage(this.message, (response: T) => {
        const error = chrome.runtime.lastError?.message
        if (error) reject(new Error(error))
        else resolve(response)
      })
    })
  }
}

type PasskeyAccountSchemaFields = {
  credentialId: typeof Schema.String
  userName: typeof Schema.String
  userDisplayName: typeof Schema.String
}
const passkeyAccountSchemaFields: PasskeyAccountSchemaFields = {
  credentialId: Schema.String,
  userName: Schema.String,
  userDisplayName: Schema.String,
}
const passkeyAccountSchema = Schema.Struct(
  passkeyAccountSchemaFields,
) satisfies Schema.Codec<PasskeyAccount>
type PasskeyOptionSchemaFields = {
  vaultStoreId: typeof Schema.String
  vaultName: typeof Schema.String
  account: Schema.optionalKey<typeof passkeyAccountSchema>
}
const passkeyOptionSchemaFields: PasskeyOptionSchemaFields = {
  vaultStoreId: Schema.String,
  vaultName: Schema.String,
  account: Schema.optionalKey(passkeyAccountSchema),
}
const passkeyOptionSchema = Schema.Struct(
  passkeyOptionSchemaFields,
) satisfies Schema.Codec<PasskeyOption>

function decodePasskeyOption(value: unknown) {
  return Schema.decodeUnknownEffect(passkeyOptionSchema)(value)
}

function validOptions(value: unknown): PasskeyOption[] {
  if (!Array.isArray(value)) return []
  const options: PasskeyOption[] = []
  for (const candidate of value) {
    const decoded = runConcreteDecoder(decodePasskeyOption, candidate)
    if (decoded.kind === ConcreteDecoderResultKind.Decoded) {
      options.push(decoded.value)
    }
  }
  return options
}

function removePrompt(requestId: string): void {
  prompts.get(requestId)?.close()
  prompts.delete(requestId)
}

/** Asks Nook what it can offer for this request. */
async function lookupOffer(request: PageRequest): Promise<PasskeyLookup> {
  const nookTypedArgs0_4: WebsitePasskeyOptionsMessage = {
    type: WebsitePasskeyOptionsMessageType.NookWebsitePasskeyOptions,
    payload: {
      requestId: request.requestId,
      ceremony: request.ceremony,
      requestJson: request.requestJson,
      expiresAt: request.expiresAt,
    },
  } satisfies WebsitePasskeyOptionsMessage
  const optionsResponse =
    await new WebAuthnRuntimeTransport<WebsitePasskeyOptionsResponse>(
      nookTypedArgs0_4,
    ).send()
  const options = validOptions(
    optionsResponse.ok ? optionsResponse.options : [],
  )
  const dispositionArgs: Parameters<
    typeof websitePasskeyOptionsDisposition
  >[0] = {
    ok: optionsResponse.ok,
    status: optionsResponse.ok
      ? optionsResponse.status
      : WebsitePasskeyOptionsStatus.Unavailable,
    hasOptions: options.length > 0,
  }
  const disposition = websitePasskeyOptionsDisposition(dispositionArgs)
  switch (disposition.kind) {
    case WebsitePasskeyOptionsDispositionKind.Respond:
      return { kind: PasskeyLookupKind.Declined }
    case WebsitePasskeyOptionsDispositionKind.Explain:
      return {
        kind: PasskeyLookupKind.Offer,
        offer: { options, unavailable: disposition.reason },
      }
    case WebsitePasskeyOptionsDispositionKind.Continue:
      return { kind: PasskeyLookupKind.Offer, offer: { options } }
  }
}

/** Opens Nook in this window so the person can unlock it. */
async function openNook(): Promise<void> {
  const message: OpenCompanionLauncherMessage = {
    type: OpenCompanionLauncherMessageType.NookOpenCompanionLauncher,
  }
  const response = await new WebAuthnRuntimeTransport<OpenNookResponse>(
    message,
  ).send()
  if (response?.ok !== true) throw new Error('Nook could not be opened')
}

async function handleRequest(request: PageRequest): Promise<void> {
  const requestJson = request.requestJson
  const lookup = await lookupOffer(request)
  if (lookup.kind === PasskeyLookupKind.Declined) {
    const declined: Parameters<typeof respond>[0] = {
      requestId: request.requestId,
      action: PageResponseAction.Error,
      value: 'NotAllowedError',
    }
    respond(declined)
    return
  }
  for (const settled of settledPrompts) settled.close()
  settledPrompts.clear()
  const site = request.rpId ? request.rpId : location.hostname
  const promptRequest: PasskeyPromptRequest = {
    ceremony: request.ceremony,
    site,
    siteName:
      request.ceremony === WebsitePasskeyCeremony.Create &&
      request.relyingPartyName
        ? request.relyingPartyName
        : site,
    ...(request.userName ? { userName: request.userName } : {}),
    ...lookup.offer,
  }
  const unlock: PasskeyPromptUnlock = {
    open: openNook,
    lookup: () => lookupOffer(request).catch(() => CHECK_FAILED),
  }
  const prompt = PasskeyPrompt.open({ request: promptRequest, unlock })
  prompts.set(request.requestId, prompt)
  const choice = await prompt.choice
  if (choice.kind !== PasskeyPromptChoiceKind.Selected) {
    removePrompt(request.requestId)
    const declined: Parameters<typeof respond>[0] =
      choice.kind === PasskeyPromptChoiceKind.BrowserFallback
        ? { requestId: request.requestId, action: PageResponseAction.Fallback }
        : {
            requestId: request.requestId,
            action: PageResponseAction.Error,
            value: 'NotAllowedError',
          }
    respond(declined)
    return
  }
  const { option: selected } = choice
  prompt.showWorking()
  const nookTypedArgs0_5: WebsitePasskeyPerformMessage = {
    type: WebsitePasskeyPerformMessageType.NookWebsitePasskeyPerform,
    payload: {
      requestId: request.requestId,
      ceremony: request.ceremony,
      requestJson,
      expiresAt: request.expiresAt,
      vaultStoreId: selected.vaultStoreId,
      ...(selected.account
        ? { credentialId: selected.account.credentialId }
        : {}),
    },
  } satisfies WebsitePasskeyPerformMessage
  const result =
    await new WebAuthnRuntimeTransport<WebsitePasskeyPerformResponse>(
      nookTypedArgs0_5,
    ).send()
  prompts.delete(request.requestId)
  if (result?.ok === true) {
    const nookTypedArgs0_5: Parameters<typeof respond>[0] = {
      requestId: request.requestId,
      action: PageResponseAction.Result,
      value: result,
    }
    respond(nookTypedArgs0_5)
    if (request.ceremony === WebsitePasskeyCeremony.Create) {
      prompt.showSaved(selected.vaultName)
      settledPrompts.add(prompt)
    } else {
      prompt.close()
    }
  } else {
    const nookTypedArgs0_6: Parameters<typeof respond>[0] = {
      requestId: request.requestId,
      action: PageResponseAction.Error,
      value: 'NotAllowedError',
    }
    respond(nookTypedArgs0_6)
    prompt.showFailed()
    settledPrompts.add(prompt)
  }
}

/** Admits the page message envelope before Rust validates its serialized payload. */
class WebAuthnPageIngress {
  private static decodeRequestBody(value: unknown): PageRequestBodyDecode {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { kind: PageRequestBodyDecodeKind.Rejected }
    }
    let requestJson: string
    try {
      requestJson = JSON.stringify(value)
    } catch {
      return { kind: PageRequestBodyDecodeKind.Rejected }
    }
    if (!requestJson || requestJson.length > 65_536) {
      return { kind: PageRequestBodyDecodeKind.Rejected }
    }
    const relyingParty: unknown = Reflect.get(value, 'relyingParty')
    const user: unknown = Reflect.get(value, 'user')
    const party = WebAuthnPageIngress.displayStrings(relyingParty)
    const account = WebAuthnPageIngress.displayStrings(user)
    const requestRpId = WebAuthnPageIngress.displayStrings(value)('rpId')
    const accountName = account('name')
    return {
      kind: PageRequestBodyDecodeKind.Decoded,
      requestJson,
      relyingPartyName: party('name'),
      rpId:
        requestRpId.kind === PageRequestBodyStringFieldKind.Present
          ? requestRpId
          : party('id'),
      userName:
        accountName.kind === PageRequestBodyStringFieldKind.Present
          ? accountName
          : account('displayName'),
    }
  }

  /** Reads non-empty strings the card may display; Rust validates the request. */
  private static displayStrings(
    container: unknown,
  ): (key: string) => PageRequestBodyStringField {
    return (key) => {
      if (!container || typeof container !== 'object') {
        return { kind: PageRequestBodyStringFieldKind.Absent }
      }
      const field: unknown = Reflect.get(container, key)
      return typeof field === 'string' && field
        ? { kind: PageRequestBodyStringFieldKind.Present, value: field }
        : { kind: PageRequestBodyStringFieldKind.Absent }
    }
  }

  static receive(event: MessageEvent): void {
    const data: unknown = event.data
    if (
      event.source !== window ||
      event.origin !== location.origin ||
      !data ||
      typeof data !== 'object'
    )
      return
    const message = data
    if (
      !('source' in message) ||
      message.source !== REQUEST_SOURCE ||
      !('requestId' in message) ||
      typeof message.requestId !== 'string' ||
      !('type' in message)
    )
      return
    const requestId = message.requestId
    if (message.type === PageRequestType.Cancel) {
      removePrompt(requestId)
      const cancelMessage: WebsitePasskeyCancelMessage = {
        type: WebsitePasskeyCancelMessageType.NookWebsitePasskeyCancel,
        payload: { requestId },
      }
      void new WebAuthnRuntimeTransport(cancelMessage).send().catch(() => {})
      return
    }
    if (
      message.type !== PageRequestType.Request ||
      !('ceremony' in message) ||
      (message.ceremony !== WebsitePasskeyCeremony.Create &&
        message.ceremony !== WebsitePasskeyCeremony.Get) ||
      !('expiresAt' in message) ||
      typeof message.expiresAt !== 'number' ||
      !Number.isFinite(message.expiresAt) ||
      message.expiresAt <= Date.now() ||
      !('request' in message)
    )
      return
    const requestBody = WebAuthnPageIngress.decodeRequestBody(message.request)
    if (requestBody.kind === PageRequestBodyDecodeKind.Rejected) return
    const request: PageRequest = {
      source: REQUEST_SOURCE,
      type: PageRequestType.Request,
      requestId,
      ceremony: message.ceremony,
      requestJson: requestBody.requestJson,
      ...(requestBody.relyingPartyName.kind ===
      PageRequestBodyStringFieldKind.Present
        ? { relyingPartyName: requestBody.relyingPartyName.value }
        : {}),
      ...(requestBody.rpId.kind === PageRequestBodyStringFieldKind.Present
        ? { rpId: requestBody.rpId.value }
        : {}),
      ...(requestBody.userName.kind === PageRequestBodyStringFieldKind.Present
        ? { userName: requestBody.userName.value }
        : {}),
      expiresAt: message.expiresAt,
    }
    void handleRequest(request).catch(() => {
      removePrompt(requestId)
      const response: Parameters<typeof respond>[0] = {
        requestId,
        action: PageResponseAction.Fallback,
      }
      respond(response)
    })
  }
}

window.addEventListener('message', WebAuthnPageIngress.receive)
