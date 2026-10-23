import { Effect, Schema } from 'effect'
import type * as SchemaAST from 'effect/SchemaAST'
import type {
  BrowserRuntimeMessage,
  BrowserRuntimeMessageValue,
} from './browser-runtime-message'

/**
 * "Add 2FA from this page" in the side panel. Rust's listing offers it when
 * the active tab shows an authenticator setup. The panel asks the worker with
 * its window only; the worker resolves the tab and sends frame 0 a trigger
 * without any secret. The content script then starts the same consented Pilot
 * enrollment that its own widget button starts, and only that ceremony reads
 * the QR code or setup key. No message here carries a secret.
 */
export enum SidePanelAuthenticatorSetupMessageType {
  /** Panel to worker: start adding the active tab's authenticator. */
  Add = 'nook:side-panel-add-authenticator',
  /** Worker to the tab's frame 0: start the page's enrollment. */
  PageAdd = 'nook:side-panel-page-add-authenticator',
  /** A page to the worker, which tells the panel to list the site again. */
  PageChanged = 'nook:side-panel-page-changed',
}

/** Every answer to the panel's Add request. */
export enum SidePanelAddAuthenticatorKind {
  /** The page widget now runs the enrollment for the user to review. */
  Started = 'started',
  Forbidden = 'forbidden',
  NonWeb = 'non-web',
  PageUnavailable = 'page-unavailable',
  /** The page shows no authenticator setup Nook can start from. */
  NoSetup = 'no-setup',
  TabChanged = 'tab-changed',
  Failed = 'failed',
}

/** The content script's answer to the worker's trigger. */
export enum SidePanelPageAddAuthenticatorReplyKind {
  Started = 'started',
  NoSetup = 'no-setup',
  TabChanged = 'tab-changed',
}

export interface SidePanelAddAuthenticatorMessage {
  readonly type: SidePanelAuthenticatorSetupMessageType.Add
  readonly payload: { readonly windowId: number }
}

export interface SidePanelPageAddAuthenticatorMessage {
  readonly type: SidePanelAuthenticatorSetupMessageType.PageAdd
  /** The origin the worker derived from the tab when Add was pressed. */
  readonly payload: { readonly origin: string }
}

export interface SidePanelPageChangedMessage {
  readonly type: SidePanelAuthenticatorSetupMessageType.PageChanged
}

export interface SidePanelAddAuthenticatorOutcome {
  readonly kind: SidePanelAddAuthenticatorKind
}

export interface SidePanelPageAddAuthenticatorReply {
  readonly kind: SidePanelPageAddAuthenticatorReplyKind
}

type TypeFields<Type extends SidePanelAuthenticatorSetupMessageType> = {
  readonly type: Schema.Codec<Type>
}
type AddFields = TypeFields<SidePanelAuthenticatorSetupMessageType.Add> & {
  readonly payload: Schema.Codec<SidePanelAddAuthenticatorMessage['payload']>
}
type PageAddFields =
  TypeFields<SidePanelAuthenticatorSetupMessageType.PageAdd> & {
    readonly payload: Schema.Codec<
      SidePanelPageAddAuthenticatorMessage['payload']
    >
  }
type WindowFields = { readonly windowId: Schema.Codec<number> }
type OriginFields = { readonly origin: Schema.Codec<string> }
type OutcomeFields = {
  readonly kind: Schema.Codec<SidePanelAddAuthenticatorKind>
}
type ReplyFields = {
  readonly kind: Schema.Codec<SidePanelPageAddAuthenticatorReplyKind>
}

/** Strict codecs for the Add request, its page trigger, and their answers. */
export class SidePanelAuthenticatorSetupMessages {
  private constructor() {}

  private static readonly TEXT_MAX_LENGTH = 2048

  private static readonly strict: SchemaAST.ParseOptions = {
    onExcessProperty: 'error',
  }
  private static readonly windowFields: WindowFields = {
    windowId: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  }
  private static readonly originFields: OriginFields = {
    origin: Schema.String.check(
      Schema.isBetweenLength(
        1,
        SidePanelAuthenticatorSetupMessages.TEXT_MAX_LENGTH,
      ),
    ),
  }
  private static readonly addTypeFields: TypeFields<SidePanelAuthenticatorSetupMessageType.Add> =
    { type: Schema.Literal(SidePanelAuthenticatorSetupMessageType.Add) }
  private static readonly pageAddTypeFields: TypeFields<SidePanelAuthenticatorSetupMessageType.PageAdd> =
    { type: Schema.Literal(SidePanelAuthenticatorSetupMessageType.PageAdd) }
  private static readonly pageChangedFields: TypeFields<SidePanelAuthenticatorSetupMessageType.PageChanged> =
    {
      type: Schema.Literal(SidePanelAuthenticatorSetupMessageType.PageChanged),
    }
  private static readonly addFields: AddFields = {
    ...SidePanelAuthenticatorSetupMessages.addTypeFields,
    payload: Schema.Struct(SidePanelAuthenticatorSetupMessages.windowFields),
  }
  private static readonly pageAddFields: PageAddFields = {
    ...SidePanelAuthenticatorSetupMessages.pageAddTypeFields,
    payload: Schema.Struct(SidePanelAuthenticatorSetupMessages.originFields),
  }
  private static readonly outcomeFields: OutcomeFields = {
    kind: Schema.Enum(SidePanelAddAuthenticatorKind),
  }
  private static readonly replyFields: ReplyFields = {
    kind: Schema.Enum(SidePanelPageAddAuthenticatorReplyKind),
  }

  /** Matches the panel's Add request by type only; the operation decodes it. */
  static matchesAdd(message: BrowserRuntimeMessage) {
    return Schema.decodeUnknownEffect(
      Schema.Struct(SidePanelAuthenticatorSetupMessages.addTypeFields),
    )(message).pipe(Effect.as(message))
  }

  static decodeAdd(message: BrowserRuntimeMessage) {
    return Schema.decodeUnknownEffect(
      Schema.Struct(SidePanelAuthenticatorSetupMessages.addFields),
      SidePanelAuthenticatorSetupMessages.strict,
    )(message)
  }

  /** Matches the page trigger by type only, so a malformed one still gets an answer. */
  static matchesPageAdd(message: BrowserRuntimeMessageValue) {
    return Schema.decodeUnknownResult(
      Schema.Struct(SidePanelAuthenticatorSetupMessages.pageAddTypeFields),
    )(message)
  }

  static decodePageAdd(message: BrowserRuntimeMessageValue) {
    return Schema.decodeUnknownResult(
      Schema.Struct(SidePanelAuthenticatorSetupMessages.pageAddFields),
      SidePanelAuthenticatorSetupMessages.strict,
    )(message)
  }

  static decodePageReply(reply: BrowserRuntimeMessageValue) {
    return Schema.decodeUnknownEffect(
      Schema.Struct(SidePanelAuthenticatorSetupMessages.replyFields),
      SidePanelAuthenticatorSetupMessages.strict,
    )(reply)
  }

  static decodeOutcome(response: BrowserRuntimeMessageValue) {
    return Schema.decodeUnknownEffect(
      Schema.Struct(SidePanelAuthenticatorSetupMessages.outcomeFields),
      SidePanelAuthenticatorSetupMessages.strict,
    )(response)
  }

  /** Matches a page's notice strictly; it carries nothing but its type. */
  static matchesPageChanged(message: BrowserRuntimeMessage) {
    return Schema.decodeUnknownEffect(
      Schema.Struct(SidePanelAuthenticatorSetupMessages.pageChangedFields),
      SidePanelAuthenticatorSetupMessages.strict,
    )(message).pipe(Effect.as(message))
  }
}
