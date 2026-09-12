/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class OriginRuntimeMessage {
  private constructor() {}
  declare readonly type: string
  declare readonly payload: { origin: string }
  static is(message: unknown): message is OriginRuntimeMessage {
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
}
