import { Effect, Result, Schema } from 'effect'

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
  readonly onFailure: () => BrowserRuntimeMessageAdmission
  readonly onSuccess: (
    message: BrowserRuntimeMessage,
  ) => BrowserRuntimeMessageAdmission
}

type BrowserRuntimeMessageRecordConfiguration = {
  readonly key: typeof Schema.String
  readonly value: Schema.Codec<BrowserRuntimeMessageValue>
}

type BrowserRuntimeMessageSchemaFields = {
  readonly type: typeof Schema.String
}

/** Concrete browser IPC envelope admitted before schema-specific routing. */
export class BrowserRuntimeMessage {
  private constructor() {}

  declare readonly type: string
  readonly [key: string]: BrowserRuntimeMessageValue

  static decode(value: unknown) {
    return Schema.decodeUnknownEffect(browserRuntimeMessageSchema)(value)
  }

  static from(value: unknown): BrowserRuntimeMessageAdmission {
    if (!new SerializedBrowserRuntimeValue(value).accepted()) {
      return { kind: BrowserRuntimeMessageAdmissionKind.Rejected }
    }
    const decodeResult = Effect.runSync(
      Effect.result(BrowserRuntimeMessage.decode(value)),
    )
    const admissionMatcher: BrowserRuntimeMessageAdmissionMatcher = {
      onFailure: () => ({ kind: BrowserRuntimeMessageAdmissionKind.Rejected }),
      onSuccess: (message) => ({
        kind: BrowserRuntimeMessageAdmissionKind.Accepted,
        message,
      }),
    }
    return Result.match(decodeResult, admissionMatcher)
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

const browserRuntimeMessageValueSchema: Schema.Codec<BrowserRuntimeMessageValue> =
  Schema.suspend(() =>
    Schema.Union([
      Schema.String,
      Schema.Number,
      Schema.Boolean,
      Schema.mutable(Schema.Array(browserRuntimeMessageValueSchema)),
      Schema.Record(
        browserRuntimeMessageRecordConfiguration.key,
        browserRuntimeMessageRecordConfiguration.value,
      ),
    ]),
  )

const browserRuntimeMessageSchemaFields: BrowserRuntimeMessageSchemaFields = {
  type: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
}

const browserRuntimeMessageRestRecordConfiguration: BrowserRuntimeMessageRecordConfiguration =
  {
    key: Schema.String,
    value: browserRuntimeMessageValueSchema,
  }

const browserRuntimeMessageSchema = Schema.StructWithRest(
  Schema.Struct(browserRuntimeMessageSchemaFields),
  [
    Schema.Record(
      browserRuntimeMessageRestRecordConfiguration.key,
      browserRuntimeMessageRestRecordConfiguration.value,
    ),
  ],
) satisfies Schema.Codec<BrowserRuntimeMessage>
