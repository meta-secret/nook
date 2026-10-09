import { Effect, Schema } from 'effect'
import {
  GoogleLoginBrowserContextSchema,
  GoogleLoginContinuationMessageType,
  GoogleLoginContinuationOperation,
  GoogleLoginContinuationResponse,
  type GoogleLoginRuntimeResponse,
  type GoogleLoginSessionMessage,
} from '../../../../nook-web-shared/src/extension/google-login-continuation-messages'
import { GoogleLoginContinuationMessageCodec } from '../../lib/google-login-continuation-messages'
import type { BrowserRuntimeMessage } from '../../lib/browser-runtime-message'
import type { SchemaRuntimeMessageOperationRequest } from './schema-runtime-message-route'
import { extensionPairingIdentity } from './pairing-identity'
import { accountPickerAuthorizationIsCurrent } from './account-pickers'

type GoogleLoginOperationRequest =
  SchemaRuntimeMessageOperationRequest<BrowserRuntimeMessage>
interface GoogleChromeSenderContext {
  readonly tabId: chrome.tabs.Tab['id']
  readonly frameId: chrome.runtime.MessageSender['frameId']
  readonly documentId: chrome.runtime.MessageSender['documentId']
  readonly sourceOrigin: chrome.runtime.MessageSender['origin']
}
type GoogleWebsiteSenderAdmission = Parameters<
  typeof extensionPairingIdentity.isAuthorizedWebsiteSender
>[0]

/** Only stamps actual Chrome context and live generation; existing owners decode and respond. */
export class GoogleLoginContinuationRoute {
  static readonly failed: GoogleLoginRuntimeResponse = {
    ok: false,
    reason: 'google-login-continuation-unavailable',
  }
  constructor(private readonly request: GoogleLoginOperationRequest) {}
  readonly run = Effect.fnUntraced(function* (
    this: GoogleLoginContinuationRoute,
  ) {
    const message = yield* GoogleLoginContinuationMessageCodec.decode(
      this.request.message,
    )
    const sender = this.request.sender
    const rawContext: GoogleChromeSenderContext = {
      tabId: sender.tab?.id,
      frameId: sender.frameId,
      documentId: sender.documentId,
      sourceOrigin: sender.origin,
    }
    const browserContext = yield* Schema.decodeUnknownEffect(
      GoogleLoginBrowserContextSchema,
    )(rawContext)
    const pageUrl = yield* Schema.decodeUnknownEffect(Schema.String)(sender.url)
    const senderAdmission: GoogleWebsiteSenderAdmission = {
      sender,
      origin: message.origin,
    }
    switch (
      message.origin === browserContext.sourceOrigin &&
      extensionPairingIdentity.isAuthorizedWebsiteSender(senderAdmission)
    ) {
      case false:
        return GoogleLoginContinuationRoute.failed
      case true:
        break
    }
    let payload = message.payload
    switch (payload.operation) {
      case GoogleLoginContinuationOperation.Begin:
        switch (
          accountPickerAuthorizationIsCurrent(
            payload.request.observation.authorization_generation,
          )
        ) {
          case false:
            return GoogleLoginContinuationRoute.failed
          case true:
            break
        }
        payload = {
          ...payload,
          request: {
            ...payload.request,
            observation: { ...payload.request.observation, page_url: pageUrl },
          },
        }
        break
      case GoogleLoginContinuationOperation.Inspect:
      case GoogleLoginContinuationOperation.Admit:
        switch (
          accountPickerAuthorizationIsCurrent(
            payload.request.authorization_generation,
          )
        ) {
          case false:
            payload = { operation: GoogleLoginContinuationOperation.Cancel }
            break
          case true:
            // History transitions retain this sender document's original URL.
            // The decoded live observation carries its current route to Rust.
            break
        }
        break
      case GoogleLoginContinuationOperation.Cancel:
        break
    }
    const session: GoogleLoginSessionMessage = {
      type: GoogleLoginContinuationMessageType.Session,
      origin: browserContext.sourceOrigin,
      payload,
      browserContext,
    }
    const delivery = yield* Effect.tryPromise(() =>
      extensionPairingIdentity.sendSessionMessage(session),
    )
    const result = yield* delivery.match(
      GoogleLoginContinuationResponse.decode,
      (failure) => Effect.fail(failure),
    )
    const response: GoogleLoginRuntimeResponse = { ok: true, result }
    return response
  })
}
