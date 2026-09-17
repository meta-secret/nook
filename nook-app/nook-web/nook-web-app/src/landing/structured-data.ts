import { Effect, Schema } from 'effect'
import * as ParseResult from 'effect/ParseResult'

export enum LandingLocale {
  English = 'en',
  Russian = 'ru',
}

type LandingStructuredDataFields = {
  readonly '@context': Schema.optional<typeof Schema.String>
  readonly '@type': Schema.optional<typeof Schema.String>
  readonly name: Schema.optional<typeof Schema.String>
  readonly url: Schema.optional<typeof Schema.String>
  readonly description: typeof Schema.String
  readonly applicationCategory: Schema.optional<typeof Schema.String>
  readonly operatingSystem: Schema.optional<typeof Schema.String>
  readonly isAccessibleForFree: Schema.optional<typeof Schema.Boolean>
  readonly inLanguage: Schema.optional<typeof Schema.String>
}

const landingStructuredDataFields: LandingStructuredDataFields = {
  '@context': Schema.optional(Schema.String),
  '@type': Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
  description: Schema.String,
  applicationCategory: Schema.optional(Schema.String),
  operatingSystem: Schema.optional(Schema.String),
  isAccessibleForFree: Schema.optional(Schema.Boolean),
  inLanguage: Schema.optional(Schema.String),
}

type LandingStructuredDataSchemaDefinition = Schema.Struct<
  typeof landingStructuredDataFields
>

const LandingStructuredDataSchema: LandingStructuredDataSchemaDefinition =
  Schema.Struct(landingStructuredDataFields)

type LandingStructuredData = Schema.Schema.Type<
  typeof LandingStructuredDataSchema
>

export enum LandingStructuredDataDecodeFailureKind {
  InvalidJson = 'invalid-json',
  InvalidStructuredData = 'invalid-structured-data',
}

export class LandingStructuredDataDecodeFailure extends Error {
  readonly _tag = 'LandingStructuredDataDecodeFailure'

  private constructor(details: LandingStructuredDataDecodeFailureDetails) {
    super(details.kind)
    this.kind = details.kind
    this.cause = details.cause
  }

  readonly kind: LandingStructuredDataDecodeFailureKind

  override readonly cause: ParseResult.ParseError

  static invalidJson(
    cause: ParseResult.ParseError,
  ): LandingStructuredDataDecodeFailure {
    const details: LandingStructuredDataDecodeFailureDetails = {
      kind: LandingStructuredDataDecodeFailureKind.InvalidJson,
      cause,
    }
    return new LandingStructuredDataDecodeFailure(details)
  }

  static invalidStructuredData(
    cause: ParseResult.ParseError,
  ): LandingStructuredDataDecodeFailure {
    const details: LandingStructuredDataDecodeFailureDetails = {
      kind: LandingStructuredDataDecodeFailureKind.InvalidStructuredData,
      cause,
    }
    return new LandingStructuredDataDecodeFailure(details)
  }
}

type LandingStructuredDataDecodeFailureDetails = {
  readonly kind: LandingStructuredDataDecodeFailureKind
  readonly cause: ParseResult.ParseError
}

export class LandingStructuredDataDecoder {
  constructor(private readonly serialized: string) {}

  decode(): Effect.Effect<
    LandingStructuredData,
    LandingStructuredDataDecodeFailure
  > {
    return Schema.decodeUnknown(Schema.parseJson())(this.serialized).pipe(
      Effect.mapError(LandingStructuredDataDecodeFailure.invalidJson),
      Effect.flatMap((value) =>
        Schema.decodeUnknown(LandingStructuredDataSchema)(value).pipe(
          Effect.mapError(
            LandingStructuredDataDecodeFailure.invalidStructuredData,
          ),
        ),
      ),
    )
  }
}

export type LandingStructuredDataLocalizationRequest = {
  readonly serialized: string
  readonly description: string
  readonly locale: LandingLocale
}

export class LandingStructuredDataLocalizer {
  constructor(
    private readonly request: LandingStructuredDataLocalizationRequest,
  ) {}

  localize(): Effect.Effect<string, LandingStructuredDataDecodeFailure> {
    const { serialized, description, locale } = this.request
    const decoder = new LandingStructuredDataDecoder(serialized)
    return decoder.decode().pipe(
      Effect.map((structuredData) => {
        const localizedStructuredData: LandingStructuredData = {
          ...structuredData,
          description,
          inLanguage: locale,
        }
        return JSON.stringify(localizedStructuredData)
      }),
    )
  }
}
