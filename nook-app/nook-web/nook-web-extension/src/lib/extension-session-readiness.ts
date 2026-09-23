import { Schema } from 'effect'
import type { BrowserRuntimeMessageValue } from './browser-runtime-message'

export const ExtensionSessionReadinessMessageType = {
  Ready: 'nook:extension-session-ready',
  Query: 'nook:extension-session-readiness-query',
} as const

export type ExtensionSessionReadyMessage = {
  readonly type: typeof ExtensionSessionReadinessMessageType.Ready
}

export type ExtensionSessionReadinessQuery = {
  readonly type: typeof ExtensionSessionReadinessMessageType.Query
}

export type ExtensionSessionReadyResponse = { readonly ok: true }

type ExtensionSessionReadyResponseSchemaFields = {
  readonly ok: Schema.Schema<ExtensionSessionReadyResponse['ok']>
}

export class ExtensionSessionReadyResponseDecoder {
  private static readonly schemaFields: ExtensionSessionReadyResponseSchemaFields =
    {
      ok: Schema.Literal(true),
    }
  private static readonly schema = Schema.Struct(
    ExtensionSessionReadyResponseDecoder.schemaFields,
  ) satisfies Schema.Schema<ExtensionSessionReadyResponse>

  static decode(response: BrowserRuntimeMessageValue) {
    return Schema.decodeUnknown(ExtensionSessionReadyResponseDecoder.schema)(
      response,
    )
  }
}
