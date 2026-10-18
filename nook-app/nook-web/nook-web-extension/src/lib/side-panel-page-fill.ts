import { Schema } from 'effect'
import type * as SchemaAST from 'effect/SchemaAST'
import type { BrowserRuntimeMessageValue } from './browser-runtime-message'

/**
 * The service worker's Fill triggers for the active tab's top document. Only
 * the worker sends them, to frame 0 of the tab it resolved itself; the
 * content script then obtains the login or the current code through its own
 * sender-bound route. Neither trigger carries a credential or a code.
 */
export enum SidePanelPageFillMessageType {
  Fill = 'nook:side-panel-page-fill',
  FillCode = 'nook:side-panel-page-fill-code',
}

/** The content script's answer to a login Fill. It never carries a credential or a URL. */
export enum SidePanelPageFillReplyKind {
  Filled = 'filled',
  TabChanged = 'tab-changed',
  NoLoginForm = 'no-login-form',
  FillFailed = 'fill-failed',
  Locked = 'locked',
}

/** The content script's answer to a Fill code. It never carries the code. */
export enum SidePanelPageCodeFillReplyKind {
  Filled = 'filled',
  TabChanged = 'tab-changed',
  /** Rust found no one-time-code challenge on the page. */
  NoCodeField = 'no-code-field',
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

export interface SidePanelPageCodeFillMessage {
  readonly type: SidePanelPageFillMessageType.FillCode
  readonly payload: SidePanelPageFillPayload
}

export interface SidePanelPageFillReply {
  readonly kind: SidePanelPageFillReplyKind
}

export interface SidePanelPageCodeFillReply {
  readonly kind: SidePanelPageCodeFillReplyKind
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
type SidePanelPageFillMessageFields<Type extends SidePanelPageFillMessageType> =
  {
    readonly type: Schema.Codec<Type>
    readonly payload: Schema.Codec<SidePanelPageFillPayload>
  }
type SidePanelPageFillTypeFields<Type extends SidePanelPageFillMessageType> = {
  readonly type: Schema.Codec<Type>
}
type SidePanelPageFillReplyFields = {
  readonly kind: Schema.Codec<SidePanelPageFillReplyKind>
}
type SidePanelPageCodeFillReplyFields = {
  readonly kind: Schema.Codec<SidePanelPageCodeFillReplyKind>
}

/** Strict codecs for the worker-to-page Fill triggers and their answers. */
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
  private static readonly messageFields: SidePanelPageFillMessageFields<SidePanelPageFillMessageType.Fill> =
    {
      type: Schema.Literal(SidePanelPageFillMessageType.Fill),
      payload: Schema.Struct(SidePanelPageFillMessages.payloadFields),
    }
  private static readonly codeMessageFields: SidePanelPageFillMessageFields<SidePanelPageFillMessageType.FillCode> =
    {
      type: Schema.Literal(SidePanelPageFillMessageType.FillCode),
      payload: Schema.Struct(SidePanelPageFillMessages.payloadFields),
    }
  private static readonly typeFields: SidePanelPageFillTypeFields<SidePanelPageFillMessageType.Fill> =
    { type: Schema.Literal(SidePanelPageFillMessageType.Fill) }
  private static readonly codeTypeFields: SidePanelPageFillTypeFields<SidePanelPageFillMessageType.FillCode> =
    { type: Schema.Literal(SidePanelPageFillMessageType.FillCode) }
  private static readonly replyFields: SidePanelPageFillReplyFields = {
    kind: Schema.Enum(SidePanelPageFillReplyKind),
  }
  private static readonly codeReplyFields: SidePanelPageCodeFillReplyFields = {
    kind: Schema.Enum(SidePanelPageCodeFillReplyKind),
  }

  /** Matches the trigger by type only, so a malformed trigger still gets an answer. */
  static matches(message: BrowserRuntimeMessageValue) {
    return Schema.decodeUnknownResult(
      Schema.Struct(SidePanelPageFillMessages.typeFields),
    )(message)
  }

  /** Matches the Fill code trigger by type only, so a malformed one still gets an answer. */
  static matchesCode(message: BrowserRuntimeMessageValue) {
    return Schema.decodeUnknownResult(
      Schema.Struct(SidePanelPageFillMessages.codeTypeFields),
    )(message)
  }

  static decode(message: BrowserRuntimeMessageValue) {
    return Schema.decodeUnknownResult(
      Schema.Struct(SidePanelPageFillMessages.messageFields),
      SidePanelPageFillMessages.strict,
    )(message)
  }

  static decodeCode(message: BrowserRuntimeMessageValue) {
    return Schema.decodeUnknownResult(
      Schema.Struct(SidePanelPageFillMessages.codeMessageFields),
      SidePanelPageFillMessages.strict,
    )(message)
  }

  static decodeReply(reply: BrowserRuntimeMessageValue) {
    return Schema.decodeUnknownEffect(
      Schema.Struct(SidePanelPageFillMessages.replyFields),
      SidePanelPageFillMessages.strict,
    )(reply)
  }

  static decodeCodeReply(reply: BrowserRuntimeMessageValue) {
    return Schema.decodeUnknownEffect(
      Schema.Struct(SidePanelPageFillMessages.codeReplyFields),
      SidePanelPageFillMessages.strict,
    )(reply)
  }
}
