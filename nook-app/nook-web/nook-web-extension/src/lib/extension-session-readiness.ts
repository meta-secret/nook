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

export function isExtensionSessionReadyMessage(
  message: unknown,
): message is ExtensionSessionReadyMessage {
  return Boolean(
    message &&
    typeof message === 'object' &&
    'type' in message &&
    message.type === ExtensionSessionReadinessMessageType.Ready,
  )
}

export function isExtensionSessionReadinessQuery(
  message: unknown,
): message is ExtensionSessionReadinessQuery {
  return Boolean(
    message &&
    typeof message === 'object' &&
    'type' in message &&
    message.type === ExtensionSessionReadinessMessageType.Query,
  )
}

export function isExtensionSessionReadyResponse(
  response: unknown,
): response is ExtensionSessionReadyResponse {
  return Boolean(
    response &&
    typeof response === 'object' &&
    'ok' in response &&
    response.ok === true,
  )
}
