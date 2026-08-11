export type OriginRuntimeMessage = {
  type: string
  payload: { origin: string }
}

export function hasOriginPayload(
  message: unknown,
): message is OriginRuntimeMessage {
  return Boolean(
    message &&
    typeof message === 'object' &&
    'type' in message &&
    typeof message.type === 'string' &&
    message.type.length > 0 &&
    'payload' in message &&
    typeof message.payload === 'object' &&
    message.payload &&
    'origin' in message.payload &&
    typeof message.payload.origin === 'string' &&
    message.payload.origin.length > 0,
  )
}
