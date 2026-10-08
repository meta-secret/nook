/* eslint-disable @typescript-eslint/no-restricted-types -- Dedicated browser untrusted-input decoder immediately applies concrete schemas. */
import {
  decode_extension_session_request,
  type ExtensionSessionRequestAdmission,
  type ExtensionSessionRequest,
  type MessageDefaultQueueDisposition,
} from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { companionWasmReady } from '../../../nook-web-shared/src/extension/companion-ready'
import { Effect, Schema, SchemaIssue } from 'effect'
import { ExtensionSessionMessageType } from './extension-session-message-type'
import type { NookFocusedLoginFillRequest } from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import type { WebsiteLoginRevealMessage } from './login-fill-messages'

export enum WebsiteFocusedLoginRevealMessageType {
  Reveal = 'nook:website-focused-login-fill',
}
export type WebsiteFocusedLoginFillResponse =
  { ok: true; value: string } | { ok: false; reason: string }

const text = Schema.String.pipe(Schema.check(Schema.isMinLength(1)))
const credential = text
type FocusedSelectorAdmissionAttempt = {
  readonly try: () => ExtensionSessionRequest
  readonly catch: () => Schema.SchemaError
}
type FocusedPayloadSchemaFields = {
  origin: typeof text
  vaultStoreId: typeof text
  secretId: typeof text
  authorizationGeneration: typeof text
  credential: typeof credential
}
const payloadFields: FocusedPayloadSchemaFields = {
  origin: text,
  vaultStoreId: text,
  secretId: text,
  authorizationGeneration: text,
  credential,
}
type FocusedMessageSchemaFields = {
  type: Schema.Literal<WebsiteFocusedLoginRevealMessageType.Reveal>
  payload: Schema.Struct<FocusedPayloadSchemaFields>
}
const fields: FocusedMessageSchemaFields = {
  type: Schema.Literal(WebsiteFocusedLoginRevealMessageType.Reveal),
  payload: Schema.Struct(payloadFields),
}
const messageSchema = Schema.Struct(fields)
type FocusedReadySchemaFields = {
  ok: Schema.Literal<true>
  value: typeof Schema.String
}
const readyFields: FocusedReadySchemaFields = {
  ok: Schema.Literal(true),
  value: Schema.String,
}
type FocusedFailureSchemaFields = {
  ok: Schema.Literal<false>
  reason: typeof Schema.String
}
const failureFields: FocusedFailureSchemaFields = {
  ok: Schema.Literal(false),
  reason: Schema.String,
}
const responseSchema = Schema.Union([
  Schema.Struct(readyFields),
  Schema.Struct(failureFields),
]) satisfies Schema.Codec<WebsiteFocusedLoginFillResponse>

/** Browser envelope; the credential selector is owned by the generated Rust contract. */
export class WebsiteFocusedLoginRevealMessage {
  private constructor() {}
  declare readonly type: WebsiteFocusedLoginRevealMessageType.Reveal
  declare readonly payload: WebsiteLoginRevealMessage['payload'] & {
    readonly credential: NookFocusedLoginFillRequest['credential']
  }
  static decode = Effect.fnUntraced(function* (message: unknown) {
    const decoded = yield* Schema.decodeUnknownEffect(messageSchema)(message)
    yield* Effect.promise(() => companionWasmReady)
    // This unsent envelope admits only wire shape. Real grant authority remains
    // the service worker's prerequisite for the subsequent disclosure request.
    const admission: ExtensionSessionRequestAdmission = {
      type: ExtensionSessionMessageType.RevealFocusedLogin,
      payload: {
        vaultStoreId: decoded.payload.vaultStoreId,
        deviceId: 'selector-admission',
        devicePublicKey: 'selector-admission',
        deviceSigningPublicKey: 'selector-admission',
        origin: decoded.payload.origin,
        secretId: decoded.payload.secretId,
        credential: decoded.payload.credential,
        queue: {
          kind: 'message-default',
        } satisfies MessageDefaultQueueDisposition,
      },
    }
    const rejected = new Schema.SchemaError(
      new SchemaIssue.InvalidType(messageSchema.ast),
    )
    const attempt: FocusedSelectorAdmissionAttempt = {
      try: () => decode_extension_session_request(admission),
      catch: () => rejected,
    }
    const request = yield* Effect.try(attempt)
    switch (true) {
      case request.type === ExtensionSessionMessageType.RevealFocusedLogin:
        return {
          ...decoded,
          payload: {
            ...decoded.payload,
            credential: request.payload.credential,
          },
        }
      case true:
        return yield* Effect.fail(rejected)
    }
    return yield* Effect.fail(rejected)
  })
  static decodeResponse(response: unknown) {
    return Schema.decodeUnknownEffect(responseSchema)(response)
  }
}
