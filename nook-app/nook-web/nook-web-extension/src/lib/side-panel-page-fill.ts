import { Schema } from 'effect'
import type * as SchemaAST from 'effect/SchemaAST'
import type { BrowserRuntimeMessageValue } from './browser-runtime-message'

/**
 * The service worker's Fill trigger for the active tab's top document. Only the
 * worker sends it, to frame 0 of the tab it resolved itself; the content
 * script then reveals the login through its own sender-bound route.
 */
export enum SidePanelPageFillMessageType {
  Fill = 'nook:side-panel-page-fill',
}

/** The content script's answer. It never carries a credential or a URL. */
export enum SidePanelPageFillReplyKind {
  Filled = 'filled',
  TabChanged = 'tab-changed',
  NoLoginForm = 'no-login-form',
  FillFailed = 'fill-failed',
  Locked = 'locked',
}

export interface SidePanelPageFillAccount {
  readonly vaultStoreId: string
  readonly secretId: string
  readonly authorizationGeneration: string
}

export interface SidePanelPageFillPayload {
  /** The origin the worker derived from the tab when Fill was pressed. */
  readonly origin: string
  readonly account: SidePanelPageFillAccount
}

export interface SidePanelPageFillMessage {
  readonly type: SidePanelPageFillMessageType.Fill
  readonly payload: SidePanelPageFillPayload
}

export interface SidePanelPageFillReply {
  readonly kind: SidePanelPageFillReplyKind
}

type BoundedTextSchema = Schema.Codec<string>
type SidePanelPageFillAccountFields = {
  readonly vaultStoreId: BoundedTextSchema
  readonly secretId: BoundedTextSchema
  readonly authorizationGeneration: BoundedTextSchema
}
type SidePanelPageFillPayloadFields = {
  readonly origin: BoundedTextSchema
  readonly account: Schema.Codec<SidePanelPageFillAccount>
}
type SidePanelPageFillMessageFields = {
  readonly type: Schema.Codec<SidePanelPageFillMessageType.Fill>
  readonly payload: Schema.Codec<SidePanelPageFillPayload>
}
type SidePanelPageFillTypeFields = {
  readonly type: Schema.Codec<SidePanelPageFillMessageType.Fill>
}
type SidePanelPageFillReplyFields = {
  readonly kind: Schema.Codec<SidePanelPageFillReplyKind>
}
type SidePanelPageFillReplyKinds = readonly SidePanelPageFillReplyKind[]

/** Strict codecs for the worker-to-page Fill trigger and its answer. */
export class SidePanelPageFillMessages {
  private constructor() {}

  private static readonly TEXT_MAX_LENGTH = 2048

  private static readonly strict: SchemaAST.ParseOptions = {
    onExcessProperty: 'error',
  }
  private static readonly text: BoundedTextSchema = Schema.String.check(
    Schema.isBetweenLength(1, SidePanelPageFillMessages.TEXT_MAX_LENGTH),
  )
  private static readonly accountFields: SidePanelPageFillAccountFields = {
    vaultStoreId: SidePanelPageFillMessages.text,
    secretId: SidePanelPageFillMessages.text,
    authorizationGeneration: SidePanelPageFillMessages.text,
  }
  private static readonly payloadFields: SidePanelPageFillPayloadFields = {
    origin: SidePanelPageFillMessages.text,
    account: Schema.Struct(SidePanelPageFillMessages.accountFields),
  }
  private static readonly messageFields: SidePanelPageFillMessageFields = {
    type: Schema.Literal(SidePanelPageFillMessageType.Fill),
    payload: Schema.Struct(SidePanelPageFillMessages.payloadFields),
  }
  private static readonly typeFields: SidePanelPageFillTypeFields = {
    type: Schema.Literal(SidePanelPageFillMessageType.Fill),
  }
  private static readonly replyKinds: SidePanelPageFillReplyKinds = [
    SidePanelPageFillReplyKind.Filled,
    SidePanelPageFillReplyKind.TabChanged,
    SidePanelPageFillReplyKind.NoLoginForm,
    SidePanelPageFillReplyKind.FillFailed,
    SidePanelPageFillReplyKind.Locked,
  ]
  private static readonly replyFields: SidePanelPageFillReplyFields = {
    kind: Schema.Literals(SidePanelPageFillMessages.replyKinds),
  }

  /** Matches the trigger by type only, so a malformed trigger still gets an answer. */
  static matches(message: BrowserRuntimeMessageValue) {
    return Schema.decodeUnknownResult(
      Schema.Struct(SidePanelPageFillMessages.typeFields),
    )(message)
  }

  static decode(message: BrowserRuntimeMessageValue) {
    return Schema.decodeUnknownResult(
      Schema.Struct(SidePanelPageFillMessages.messageFields),
      SidePanelPageFillMessages.strict,
    )(message)
  }

  static decodeReply(reply: BrowserRuntimeMessageValue) {
    return Schema.decodeUnknownEffect(
      Schema.Struct(SidePanelPageFillMessages.replyFields),
      SidePanelPageFillMessages.strict,
    )(reply)
  }
}
