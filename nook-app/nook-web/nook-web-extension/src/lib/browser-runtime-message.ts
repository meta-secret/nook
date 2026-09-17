import { Effect, Either, Schema } from 'effect'

export enum BrowserRuntimeMessageAdmissionKind {
  Accepted = 'accepted',
  Rejected = 'rejected',
}

export type BrowserRuntimeMessageAdmission =
  | {
      readonly kind: BrowserRuntimeMessageAdmissionKind.Accepted
      readonly message: BrowserRuntimeMessage
    }
  | { readonly kind: BrowserRuntimeMessageAdmissionKind.Rejected }

/** Concrete browser IPC envelope admitted before schema-specific routing. */
export class BrowserRuntimeMessage {
  private constructor() {}

  declare readonly type: string

  static decode(value: unknown) {
    return Schema.decodeUnknown(browserRuntimeMessageSchema)(value)
  }

  static from(value: unknown): BrowserRuntimeMessageAdmission {
    const decodeResult = Effect.runSync(
      Effect.either(BrowserRuntimeMessage.decode(value)),
    )
    return Either.match(decodeResult, {
      onLeft: () => ({ kind: BrowserRuntimeMessageAdmissionKind.Rejected }),
      onRight: (message) => ({
        kind: BrowserRuntimeMessageAdmissionKind.Accepted,
        message,
      }),
    })
  }
}

const browserRuntimeMessageSchema = Schema.Struct(
  {
    type: Schema.String.pipe(Schema.minLength(1)),
  },
  Schema.Record({ key: Schema.String, value: Schema.Unknown }),
) satisfies Schema.Schema<BrowserRuntimeMessage>
