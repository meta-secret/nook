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

export type BrowserRuntimeMessageValue =
  | string
  | number
  | boolean
  | readonly BrowserRuntimeMessageValue[]
  | { readonly [key: string]: BrowserRuntimeMessageValue }

/** Concrete browser IPC envelope admitted before schema-specific routing. */
export class BrowserRuntimeMessage {
  private constructor() {}

  declare readonly type: string
  readonly [key: string]: BrowserRuntimeMessageValue

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

const browserRuntimeMessageValueSchema: Schema.Schema<BrowserRuntimeMessageValue> =
  Schema.suspend(() =>
    Schema.Union(
      Schema.String,
      Schema.Number,
      Schema.Boolean,
      Schema.Array(browserRuntimeMessageValueSchema),
      Schema.Record({
        key: Schema.String,
        value: browserRuntimeMessageValueSchema,
      }),
    ),
  )

const browserRuntimeMessageSchema = Schema.Struct(
  {
    type: Schema.String.pipe(Schema.minLength(1)),
  },
  Schema.Record({ key: Schema.String, value: browserRuntimeMessageValueSchema }),
) satisfies Schema.Schema<BrowserRuntimeMessage>
