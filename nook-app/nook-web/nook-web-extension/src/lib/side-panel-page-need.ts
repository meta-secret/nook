import { Schema } from 'effect'
import type * as SchemaAST from 'effect/SchemaAST'
import { SitePageNeed } from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import type { BrowserRuntimeMessageValue } from './browser-runtime-message'

/**
 * The service worker asks the active tab's top document, once per This-site
 * listing, what the page needs: Rust maps the workflow it classifies there to
 * a page need, and that need filters the listing.
 */
export enum SidePanelPageNeedMessageType {
  Query = 'nook:side-panel-page-need',
}

export interface SidePanelPageNeedPayload {
  /** The origin the worker derived from the tab for this listing. */
  readonly origin: string
}

export interface SidePanelPageNeedMessage {
  readonly type: SidePanelPageNeedMessageType.Query
  readonly payload: SidePanelPageNeedPayload
}

/** The content script's answer: Rust's page need, or why there is none. */
export enum SidePanelPageNeedReplyKind {
  /** Rust mapped the classified page to this need. */
  Needed = 'needed',
  /** The document is no longer on the derived origin. */
  TabChanged = 'tab-changed',
  /** The classification could not complete. */
  Unavailable = 'unavailable',
}

export type SidePanelPageNeedReply =
  | {
      readonly kind: SidePanelPageNeedReplyKind.Needed
      readonly need: SitePageNeed
    }
  | {
      readonly kind:
        | SidePanelPageNeedReplyKind.TabChanged
        | SidePanelPageNeedReplyKind.Unavailable
    }

type BoundedTextSchema = Schema.Codec<string>
type SidePanelPageNeedPayloadFields = {
  readonly origin: BoundedTextSchema
}
type SidePanelPageNeedMessageFields = {
  readonly type: Schema.Codec<SidePanelPageNeedMessageType.Query>
  readonly payload: Schema.Codec<SidePanelPageNeedPayload>
}
type SidePanelPageNeedTypeFields = {
  readonly type: Schema.Codec<SidePanelPageNeedMessageType.Query>
}
type SidePanelPageNeedNeededFields = {
  readonly kind: Schema.Codec<SidePanelPageNeedReplyKind.Needed>
  readonly need: Schema.Codec<SitePageNeed>
}
type SidePanelPageNeedBareReplyKind = Exclude<
  SidePanelPageNeedReplyKind,
  SidePanelPageNeedReplyKind.Needed
>
type SidePanelPageNeedBareReplyFields = {
  readonly kind: Schema.Codec<SidePanelPageNeedBareReplyKind>
}

/** Strict codecs for the worker-to-page need query and its answer. */
export class SidePanelPageNeedMessages {
  private constructor() {}

  private static readonly TEXT_MAX_LENGTH = 2048

  private static readonly strict: SchemaAST.ParseOptions = {
    onExcessProperty: 'error',
  }
  private static readonly text: BoundedTextSchema = Schema.String.check(
    Schema.isBetweenLength(1, SidePanelPageNeedMessages.TEXT_MAX_LENGTH),
  )
  private static readonly payloadFields: SidePanelPageNeedPayloadFields = {
    origin: SidePanelPageNeedMessages.text,
  }
  private static readonly messageFields: SidePanelPageNeedMessageFields = {
    type: Schema.Literal(SidePanelPageNeedMessageType.Query),
    payload: Schema.Struct(SidePanelPageNeedMessages.payloadFields),
  }
  private static readonly typeFields: SidePanelPageNeedTypeFields = {
    type: Schema.Literal(SidePanelPageNeedMessageType.Query),
  }
  private static readonly neededFields: SidePanelPageNeedNeededFields = {
    kind: Schema.Literal(SidePanelPageNeedReplyKind.Needed),
    need: Schema.Enum(SitePageNeed),
  }
  private static readonly bareReplyFields: SidePanelPageNeedBareReplyFields = {
    kind: Schema.Literals([
      SidePanelPageNeedReplyKind.TabChanged,
      SidePanelPageNeedReplyKind.Unavailable,
    ]),
  }
  private static readonly reply: Schema.Codec<SidePanelPageNeedReply> =
    Schema.Union([
      Schema.Struct(SidePanelPageNeedMessages.neededFields),
      Schema.Struct(SidePanelPageNeedMessages.bareReplyFields),
    ])

  /** Matches the query by type only, so a malformed query still gets an answer. */
  static matches(message: BrowserRuntimeMessageValue) {
    return Schema.decodeUnknownResult(
      Schema.Struct(SidePanelPageNeedMessages.typeFields),
    )(message)
  }

  static decode(message: BrowserRuntimeMessageValue) {
    return Schema.decodeUnknownResult(
      Schema.Struct(SidePanelPageNeedMessages.messageFields),
      SidePanelPageNeedMessages.strict,
    )(message)
  }

  static decodeReply(reply: BrowserRuntimeMessageValue) {
    return Schema.decodeUnknownEffect(
      SidePanelPageNeedMessages.reply,
      SidePanelPageNeedMessages.strict,
    )(reply)
  }
}
