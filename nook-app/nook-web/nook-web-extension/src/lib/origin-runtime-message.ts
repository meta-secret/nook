export type OriginRuntimeMessage = {
  type: string
  payload: Record<string, unknown> & { origin: string }
}

export function hasOriginPayload(
  message: unknown,
  type: string,
): message is OriginRuntimeMessage {
  return Boolean(
    message &&
    typeof message === 'object' &&
    'type' in message &&
    message.type === type &&
    'payload' in message &&
    typeof message.payload === 'object' &&
    message.payload &&
    'origin' in message.payload &&
    typeof message.payload.origin === 'string' &&
    message.payload.origin.length > 0,
  )
}
