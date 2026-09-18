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
  | BrowserRuntimeMessageValue[]
  | { readonly [key: string]: BrowserRuntimeMessageValue }

type BrowserRuntimeMessageAdmissionMatcher = {
  readonly onLeft: () => BrowserRuntimeMessageAdmission
  readonly onRight: (
    message: BrowserRuntimeMessage,
  ) => BrowserRuntimeMessageAdmission
}

type BrowserRuntimeMessageRecordConfiguration = {
  readonly key: typeof Schema.String
  readonly value: Schema.Schema<BrowserRuntimeMessageValue>
}

type BrowserRuntimeMessageSchemaFields = {
  readonly type: Schema.filter<typeof Schema.String>
}

/** Concrete browser IPC envelope admitted before schema-specific routing. */
export class BrowserRuntimeMessage {
  private constructor() {}

  declare readonly type: string
  readonly [key: string]: BrowserRuntimeMessageValue

  static decode(value: unknown) {
    return Schema.decodeUnknown(browserRuntimeMessageSchema)(value)
  }

  static from(value: unknown): BrowserRuntimeMessageAdmission {
    if (!new SerializedBrowserRuntimeValue(value).accepted()) {
      return { kind: BrowserRuntimeMessageAdmissionKind.Rejected }
    }
    const decodeResult = Effect.runSync(
      Effect.either(BrowserRuntimeMessage.decode(value)),
    )
    const admissionMatcher: BrowserRuntimeMessageAdmissionMatcher = {
      onLeft: () => ({ kind: BrowserRuntimeMessageAdmissionKind.Rejected }),
      onRight: (message) => ({
        kind: BrowserRuntimeMessageAdmissionKind.Accepted,
        message,
      }),
    }
    return Either.match(decodeResult, admissionMatcher)
  }
}

class SerializedBrowserRuntimeValue {
  constructor(private readonly value: unknown) {}

  accepted(): boolean {
    const value = this.value
    if (
      typeof value === 'string' ||
      typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value))
    ) {
      return true
    }
    if (Array.isArray(value)) {
      return value.every((entry) =>
        new SerializedBrowserRuntimeValue(entry).accepted(),
      )
    }
    if (!value || Object.getPrototypeOf(value) !== Object.prototype) {
      return false
    }
    return Object.values(value).every((entry) =>
      new SerializedBrowserRuntimeValue(entry).accepted(),
    )
  }
}

const browserRuntimeMessageRecordConfiguration: BrowserRuntimeMessageRecordConfiguration =
  {
    key: Schema.String,
    value: Schema.suspend(() => browserRuntimeMessageValueSchema),
  }

const browserRuntimeMessageValueSchema: Schema.Schema<BrowserRuntimeMessageValue> =
  Schema.suspend(() =>
    Schema.Union(
      Schema.String,
      Schema.Number,
      Schema.Boolean,
      Schema.mutable(Schema.Array(browserRuntimeMessageValueSchema)),
      Schema.Record(browserRuntimeMessageRecordConfiguration),
    ),
  )

const browserRuntimeMessageSchemaFields: BrowserRuntimeMessageSchemaFields = {
  type: Schema.String.pipe(Schema.minLength(1)),
}

const browserRuntimeMessageRestRecordConfiguration: BrowserRuntimeMessageRecordConfiguration =
  {
    key: Schema.String,
    value: browserRuntimeMessageValueSchema,
  }

const browserRuntimeMessageSchema = Schema.Struct(
  browserRuntimeMessageSchemaFields,
  Schema.Record(browserRuntimeMessageRestRecordConfiguration),
) satisfies Schema.Schema<BrowserRuntimeMessage>
