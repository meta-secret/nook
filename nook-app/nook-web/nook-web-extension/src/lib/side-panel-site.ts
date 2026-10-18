import { Effect, Schema } from 'effect'
import type * as SchemaAST from 'effect/SchemaAST'
import type { SiteSecretListing } from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import type {
  BrowserRuntimeMessage,
  BrowserRuntimeMessageValue,
} from './browser-runtime-message'
import { SiteSecretListingCodec } from './side-panel-site-listing'

/** The panel's requests. None carries an origin, URL, tab or frame. */
export enum SidePanelSiteMessageType {
  ListLogins = 'nook:side-panel-site-logins',
  FillLogin = 'nook:side-panel-login-fill',
  FillCode = 'nook:side-panel-code-fill',
}

/** Every answer to a This-site listing request. */
export enum SidePanelSiteListingKind {
  Ready = 'ready',
  Forbidden = 'forbidden',
  NonWeb = 'non-web',
  PageUnavailable = 'page-unavailable',
  Unpaired = 'unpaired',
  Locked = 'locked',
  ListFailed = 'list-failed',
}

export type SidePanelSiteListingFailureKind = Exclude<
  SidePanelSiteListingKind,
  SidePanelSiteListingKind.Ready
>

/** Every answer to a Fill request: filled, or why nothing was filled. */
export enum SidePanelLoginFillKind {
  Filled = 'filled',
  Forbidden = 'forbidden',
  NonWeb = 'non-web',
  PageUnavailable = 'page-unavailable',
  Locked = 'locked',
  Unpaired = 'unpaired',
  ItemNotFound = 'item-not-found',
  TabChanged = 'tab-changed',
  NoLoginForm = 'no-login-form',
  FillFailed = 'fill-failed',
}

/** Every answer to a Fill code request: filled, or why nothing was filled. */
export enum SidePanelCodeFillKind {
  Filled = 'filled',
  Forbidden = 'forbidden',
  NonWeb = 'non-web',
  PageUnavailable = 'page-unavailable',
  Locked = 'locked',
  Unpaired = 'unpaired',
  ItemNotFound = 'item-not-found',
  TabChanged = 'tab-changed',
  /** Rust found no one-time-code challenge on the page. */
  NoCodeField = 'no-code-field',
  FillFailed = 'fill-failed',
}

/**
 * The panel's window, from `chrome.windows.getCurrent()` in the panel. It only
 * selects a window; the service worker checks it and reads that window's
 * active tab itself.
 */
export interface SidePanelWindowSelection {
  readonly windowId: number
}

/** Opaque identity of one listed item; a lookup key, never authority. */
export interface SidePanelLoginItemId {
  readonly vaultStoreId: string
  readonly secretId: string
}

export interface SidePanelSiteReadyListing {
  readonly kind: SidePanelSiteListingKind.Ready
  /** The active tab's host as Rust displays it. */
  readonly display_host: string
  /** Rust's identity:vault sections of filtered, ordered display rows, and
   * its empty state when no section lists a row. */
  readonly listing: SiteSecretListing
}

export interface SidePanelSiteListingFailure {
  readonly kind: SidePanelSiteListingFailureKind
}

export type SidePanelSiteListing =
  SidePanelSiteReadyListing | SidePanelSiteListingFailure

export interface SidePanelLoginFillRequest {
  readonly windowId: number
  readonly itemId: SidePanelLoginItemId
}

export interface SidePanelLoginFillOutcome {
  readonly kind: SidePanelLoginFillKind
}

export interface SidePanelCodeFillOutcome {
  readonly kind: SidePanelCodeFillKind
}

export interface SidePanelSiteLoginsMessage {
  readonly type: SidePanelSiteMessageType.ListLogins
  readonly payload: SidePanelWindowSelection
}

export interface SidePanelLoginFillMessage {
  readonly type: SidePanelSiteMessageType.FillLogin
  readonly payload: SidePanelLoginFillRequest
}

/** A Fill code request carries the same window selector and opaque item id as Fill. */
export interface SidePanelCodeFillMessage {
  readonly type: SidePanelSiteMessageType.FillCode
  readonly payload: SidePanelLoginFillRequest
}

type BoundedTextSchema = Schema.Codec<string>
type WindowIdSchema = Schema.Codec<number>

type SidePanelLoginItemIdFields = {
  readonly vaultStoreId: BoundedTextSchema
  readonly secretId: BoundedTextSchema
}
type SidePanelWindowSelectionFields = {
  readonly windowId: WindowIdSchema
}
type SidePanelLoginFillRequestFields = {
  readonly windowId: WindowIdSchema
  readonly itemId: Schema.Codec<SidePanelLoginItemId>
}
type SidePanelSiteLoginsMessageFields = {
  readonly type: Schema.Codec<SidePanelSiteMessageType.ListLogins>
  readonly payload: Schema.Codec<SidePanelWindowSelection>
}
type SidePanelLoginFillMessageFields = {
  readonly type: Schema.Codec<SidePanelSiteMessageType.FillLogin>
  readonly payload: Schema.Codec<SidePanelLoginFillRequest>
}
type SidePanelCodeFillMessageFields = {
  readonly type: Schema.Codec<SidePanelSiteMessageType.FillCode>
  readonly payload: Schema.Codec<SidePanelLoginFillRequest>
}
type SidePanelSiteMessageTypeFields<Type extends SidePanelSiteMessageType> = {
  readonly type: Schema.Codec<Type>
}
type SidePanelSiteReadyListingFields = {
  readonly kind: Schema.Codec<SidePanelSiteListingKind.Ready>
  readonly display_host: BoundedTextSchema
  readonly listing: Schema.Codec<SiteSecretListing>
}
type SidePanelSiteListingFailureFields = {
  readonly kind: Schema.Codec<SidePanelSiteListingFailureKind>
}
type SidePanelLoginFillOutcomeFields = {
  readonly kind: Schema.Codec<SidePanelLoginFillKind>
}
type SidePanelCodeFillOutcomeFields = {
  readonly kind: Schema.Codec<SidePanelCodeFillKind>
}
type SidePanelSiteListingFailureKinds = Readonly<
  Record<SidePanelSiteListingFailureKind, SidePanelSiteListingFailureKind>
>

/** Strict wire codecs for the panel's requests and the worker's answers. */
export class SidePanelSiteMessages {
  private constructor() {}

  private static readonly IDENTIFIER_MAX_LENGTH = 256
  private static readonly LABEL_MAX_LENGTH = 1024

  private static readonly strict: SchemaAST.ParseOptions = {
    onExcessProperty: 'error',
  }
  private static readonly identifier: BoundedTextSchema = Schema.String.check(
    Schema.isBetweenLength(1, SidePanelSiteMessages.IDENTIFIER_MAX_LENGTH),
  )
  private static readonly host: BoundedTextSchema = Schema.String.check(
    Schema.isBetweenLength(1, SidePanelSiteMessages.LABEL_MAX_LENGTH),
  )
  private static readonly windowId: WindowIdSchema = Schema.Int.check(
    Schema.isGreaterThanOrEqualTo(0),
  )
  private static readonly itemIdFields: SidePanelLoginItemIdFields = {
    vaultStoreId: SidePanelSiteMessages.identifier,
    secretId: SidePanelSiteMessages.identifier,
  }
  private static readonly itemId: Schema.Codec<SidePanelLoginItemId> =
    Schema.Struct(SidePanelSiteMessages.itemIdFields)
  private static readonly windowSelectionFields: SidePanelWindowSelectionFields =
    { windowId: SidePanelSiteMessages.windowId }
  private static readonly fillRequestFields: SidePanelLoginFillRequestFields = {
    windowId: SidePanelSiteMessages.windowId,
    itemId: SidePanelSiteMessages.itemId,
  }
  private static readonly listLoginsFields: SidePanelSiteLoginsMessageFields = {
    type: Schema.Literal(SidePanelSiteMessageType.ListLogins),
    payload: Schema.Struct(SidePanelSiteMessages.windowSelectionFields),
  }
  private static readonly fillLoginFields: SidePanelLoginFillMessageFields = {
    type: Schema.Literal(SidePanelSiteMessageType.FillLogin),
    payload: Schema.Struct(SidePanelSiteMessages.fillRequestFields),
  }
  private static readonly fillCodeFields: SidePanelCodeFillMessageFields = {
    type: Schema.Literal(SidePanelSiteMessageType.FillCode),
    payload: Schema.Struct(SidePanelSiteMessages.fillRequestFields),
  }
  private static readonly listLoginsTypeFields: SidePanelSiteMessageTypeFields<SidePanelSiteMessageType.ListLogins> =
    { type: Schema.Literal(SidePanelSiteMessageType.ListLogins) }
  private static readonly fillLoginTypeFields: SidePanelSiteMessageTypeFields<SidePanelSiteMessageType.FillLogin> =
    { type: Schema.Literal(SidePanelSiteMessageType.FillLogin) }
  private static readonly fillCodeTypeFields: SidePanelSiteMessageTypeFields<SidePanelSiteMessageType.FillCode> =
    { type: Schema.Literal(SidePanelSiteMessageType.FillCode) }
  private static readonly readyListingFields: SidePanelSiteReadyListingFields =
    {
      kind: Schema.Literal(SidePanelSiteListingKind.Ready),
      display_host: SidePanelSiteMessages.host,
      listing: SiteSecretListingCodec.listing,
    }
  // Keyed by every failure kind, so a new kind cannot be left undecodable.
  private static readonly listingFailureKinds: SidePanelSiteListingFailureKinds =
    {
      [SidePanelSiteListingKind.Forbidden]: SidePanelSiteListingKind.Forbidden,
      [SidePanelSiteListingKind.NonWeb]: SidePanelSiteListingKind.NonWeb,
      [SidePanelSiteListingKind.PageUnavailable]:
        SidePanelSiteListingKind.PageUnavailable,
      [SidePanelSiteListingKind.Unpaired]: SidePanelSiteListingKind.Unpaired,
      [SidePanelSiteListingKind.Locked]: SidePanelSiteListingKind.Locked,
      [SidePanelSiteListingKind.ListFailed]:
        SidePanelSiteListingKind.ListFailed,
    }
  private static readonly listingFailureFields: SidePanelSiteListingFailureFields =
    {
      kind: Schema.Literals(
        Object.values(SidePanelSiteMessages.listingFailureKinds),
      ),
    }
  private static readonly fillOutcomeFields: SidePanelLoginFillOutcomeFields = {
    kind: Schema.Enum(SidePanelLoginFillKind),
  }
  private static readonly codeFillOutcomeFields: SidePanelCodeFillOutcomeFields =
    { kind: Schema.Enum(SidePanelCodeFillKind) }
  private static readonly listing: Schema.Codec<SidePanelSiteListing> =
    Schema.Union([
      Schema.Struct(SidePanelSiteMessages.readyListingFields),
      Schema.Struct(SidePanelSiteMessages.listingFailureFields),
    ])
  private static readonly fillOutcome: Schema.Codec<SidePanelLoginFillOutcome> =
    Schema.Struct(SidePanelSiteMessages.fillOutcomeFields)
  private static readonly codeFillOutcome: Schema.Codec<SidePanelCodeFillOutcome> =
    Schema.Struct(SidePanelSiteMessages.codeFillOutcomeFields)

  /** Matches a listing request by type only; the operation decodes it strictly. */
  static matchesListLogins(message: BrowserRuntimeMessage) {
    return Schema.decodeUnknownEffect(
      Schema.Struct(SidePanelSiteMessages.listLoginsTypeFields),
    )(message).pipe(Effect.as(message))
  }

  /** Matches a Fill request by type only; the operation decodes it strictly. */
  static matchesFillLogin(message: BrowserRuntimeMessage) {
    return Schema.decodeUnknownEffect(
      Schema.Struct(SidePanelSiteMessages.fillLoginTypeFields),
    )(message).pipe(Effect.as(message))
  }

  /** Matches a Fill code request by type only; the operation decodes it strictly. */
  static matchesFillCode(message: BrowserRuntimeMessage) {
    return Schema.decodeUnknownEffect(
      Schema.Struct(SidePanelSiteMessages.fillCodeTypeFields),
    )(message).pipe(Effect.as(message))
  }

  static decodeListLogins(message: BrowserRuntimeMessage) {
    return Schema.decodeUnknownEffect(
      Schema.Struct(SidePanelSiteMessages.listLoginsFields),
      SidePanelSiteMessages.strict,
    )(message)
  }

  static decodeFillLogin(message: BrowserRuntimeMessage) {
    return Schema.decodeUnknownEffect(
      Schema.Struct(SidePanelSiteMessages.fillLoginFields),
      SidePanelSiteMessages.strict,
    )(message)
  }

  static decodeFillCode(message: BrowserRuntimeMessage) {
    return Schema.decodeUnknownEffect(
      Schema.Struct(SidePanelSiteMessages.fillCodeFields),
      SidePanelSiteMessages.strict,
    )(message)
  }

  static decodeListing(response: BrowserRuntimeMessageValue) {
    return Schema.decodeUnknownEffect(
      SidePanelSiteMessages.listing,
      SidePanelSiteMessages.strict,
    )(response)
  }

  static decodeFillOutcome(response: BrowserRuntimeMessageValue) {
    return Schema.decodeUnknownEffect(
      SidePanelSiteMessages.fillOutcome,
      SidePanelSiteMessages.strict,
    )(response)
  }

  static decodeCodeFillOutcome(response: BrowserRuntimeMessageValue) {
    return Schema.decodeUnknownEffect(
      SidePanelSiteMessages.codeFillOutcome,
      SidePanelSiteMessages.strict,
    )(response)
  }
}

enum SidePanelRuntimeReplyKind {
  Delivered = 'delivered',
  Unavailable = 'unavailable',
}

type SidePanelRuntimeReply =
  | {
      readonly kind: SidePanelRuntimeReplyKind.Delivered
      readonly response: BrowserRuntimeMessageValue
    }
  | { readonly kind: SidePanelRuntimeReplyKind.Unavailable }

type SidePanelRuntimeRequest =
  | SidePanelSiteLoginsMessage
  | SidePanelLoginFillMessage
  | SidePanelCodeFillMessage

type SidePanelSiteClientConfiguration = { readonly browser: typeof globalThis }

/**
 * The side panel's view of This site, through the service worker. It sends a
 * request and reads the one reply; it never listens for runtime messages.
 */
export class SidePanelSiteClient {
  private readonly listFailed: SidePanelSiteListingFailure = {
    kind: SidePanelSiteListingKind.ListFailed,
  }
  private readonly fillFailed: SidePanelLoginFillOutcome = {
    kind: SidePanelLoginFillKind.FillFailed,
  }
  private readonly codeFillFailed: SidePanelCodeFillOutcome = {
    kind: SidePanelCodeFillKind.FillFailed,
  }

  constructor(
    private readonly configuration: SidePanelSiteClientConfiguration,
  ) {}

  list(selection: SidePanelWindowSelection): Promise<SidePanelSiteListing> {
    const message: SidePanelSiteLoginsMessage = {
      type: SidePanelSiteMessageType.ListLogins,
      payload: { windowId: selection.windowId },
    }
    return Effect.runPromise(
      this.request(message).pipe(
        Effect.flatMap((reply) => this.listing(reply)),
      ),
    )
  }

  fill(request: SidePanelLoginFillRequest): Promise<SidePanelLoginFillOutcome> {
    const message: SidePanelLoginFillMessage = {
      type: SidePanelSiteMessageType.FillLogin,
      payload: {
        windowId: request.windowId,
        itemId: {
          vaultStoreId: request.itemId.vaultStoreId,
          secretId: request.itemId.secretId,
        },
      },
    }
    return Effect.runPromise(
      this.request(message).pipe(
        Effect.flatMap((reply) => this.fillOutcome(reply)),
      ),
    )
  }

  /** Fills the current code of a listed authenticator into the active tab. */
  fillCode(
    request: SidePanelLoginFillRequest,
  ): Promise<SidePanelCodeFillOutcome> {
    const message: SidePanelCodeFillMessage = {
      type: SidePanelSiteMessageType.FillCode,
      payload: {
        windowId: request.windowId,
        itemId: {
          vaultStoreId: request.itemId.vaultStoreId,
          secretId: request.itemId.secretId,
        },
      },
    }
    return Effect.runPromise(
      this.request(message).pipe(
        Effect.flatMap((reply) => this.codeFillOutcome(reply)),
      ),
    )
  }

  private listing(
    reply: SidePanelRuntimeReply,
  ): Effect.Effect<SidePanelSiteListing> {
    switch (reply.kind) {
      case SidePanelRuntimeReplyKind.Unavailable:
        return Effect.succeed(this.listFailed)
      case SidePanelRuntimeReplyKind.Delivered:
        return SidePanelSiteMessages.decodeListing(reply.response).pipe(
          Effect.catch(() => Effect.succeed(this.listFailed)),
        )
    }
  }

  private fillOutcome(
    reply: SidePanelRuntimeReply,
  ): Effect.Effect<SidePanelLoginFillOutcome> {
    switch (reply.kind) {
      case SidePanelRuntimeReplyKind.Unavailable:
        return Effect.succeed(this.fillFailed)
      case SidePanelRuntimeReplyKind.Delivered:
        return SidePanelSiteMessages.decodeFillOutcome(reply.response).pipe(
          Effect.catch(() => Effect.succeed(this.fillFailed)),
        )
    }
  }

  private codeFillOutcome(
    reply: SidePanelRuntimeReply,
  ): Effect.Effect<SidePanelCodeFillOutcome> {
    switch (reply.kind) {
      case SidePanelRuntimeReplyKind.Unavailable:
        return Effect.succeed(this.codeFillFailed)
      case SidePanelRuntimeReplyKind.Delivered:
        return SidePanelSiteMessages.decodeCodeFillOutcome(reply.response).pipe(
          Effect.catch(() => Effect.succeed(this.codeFillFailed)),
        )
    }
  }

  private request(
    message: SidePanelRuntimeRequest,
  ): Effect.Effect<SidePanelRuntimeReply> {
    const runtime = this.configuration.browser.chrome.runtime
    return Effect.callback<SidePanelRuntimeReply>((resume) => {
      runtime.sendMessage(message, (response: BrowserRuntimeMessageValue) => {
        const reply = new SidePanelRuntimeReplyReading(runtime).read(response)
        resume(Effect.succeed(reply))
      })
    })
  }
}

/** Reads one runtime reply; Chrome reports a missing receiver through lastError. */
class SidePanelRuntimeReplyReading {
  constructor(private readonly runtime: typeof chrome.runtime) {}

  read(response: BrowserRuntimeMessageValue): SidePanelRuntimeReply {
    switch (Boolean(this.runtime.lastError)) {
      case true:
        return { kind: SidePanelRuntimeReplyKind.Unavailable }
      case false:
        return { kind: SidePanelRuntimeReplyKind.Delivered, response }
    }
  }
}

const sidePanelSiteClientConfiguration: SidePanelSiteClientConfiguration = {
  browser: globalThis,
}

/** The client the side panel uses. */
export const sidePanelSite = new SidePanelSiteClient(
  sidePanelSiteClientConfiguration,
)
