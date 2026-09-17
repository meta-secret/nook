import { Schema } from 'effect'

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class OriginRuntimeMessage {
  private constructor() {}
  declare readonly type: string
  declare readonly payload: { origin: string }
  static decode(message: unknown) {
    return Schema.decodeUnknown(originRuntimeMessageSchema)(message)
  }
}

const originRuntimeMessageSchema = Schema.Struct({
  type: Schema.String.pipe(Schema.minLength(1)),
  payload: Schema.Struct({
    origin: Schema.String.pipe(Schema.minLength(1)),
  }),
}) satisfies Schema.Schema<OriginRuntimeMessage>
