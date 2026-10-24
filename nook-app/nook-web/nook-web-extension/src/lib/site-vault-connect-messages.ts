import { Schema } from 'effect'
import type * as SchemaAST from 'effect/SchemaAST'

/**
 * The page widget asks the worker to start connecting a vault. The request
 * carries nothing: the worker derives the originating tab and window from
 * the sender, chooses a normal browser window for the connect flow, and
 * returns focus to that tab once the connection is approved.
 */
export enum SiteVaultConnectMessageType {
  Connect = 'nook:site-vault-connect',
}

export enum SiteVaultConnectResponseKind {
  /** The connect flow opened in a normal browser window. */
  Opened = 'opened',
  /** No window could be opened for the connect flow. */
  Failed = 'failed',
}

export type SiteVaultConnectMessage = {
  readonly type: SiteVaultConnectMessageType.Connect
}

export type SiteVaultConnectResponse = {
  readonly kind: SiteVaultConnectResponseKind
}

/** Strict codecs for the widget's connect request and its answer. */
export class SiteVaultConnectMessages {
  private constructor() {}

  private static readonly strict: SchemaAST.ParseOptions = {
    onExcessProperty: 'error',
  }
  private static readonly messageFields = {
    type: Schema.Literal(SiteVaultConnectMessageType.Connect),
  } satisfies Schema.Struct.Fields
  private static readonly responseFields = {
    kind: Schema.Enum(SiteVaultConnectResponseKind),
  } satisfies Schema.Struct.Fields
  private static readonly message: Schema.Codec<SiteVaultConnectMessage> =
    Schema.Struct(SiteVaultConnectMessages.messageFields)
  private static readonly response: Schema.Codec<SiteVaultConnectResponse> =
    Schema.Struct(SiteVaultConnectMessages.responseFields)

  static decode(message: unknown) {
    return Schema.decodeUnknownEffect(SiteVaultConnectMessages.message)(
      message,
      SiteVaultConnectMessages.strict,
    )
  }

  static decodeResponse(response: unknown) {
    return Schema.decodeUnknownEffect(SiteVaultConnectMessages.response)(
      response,
      SiteVaultConnectMessages.strict,
    )
  }
}
