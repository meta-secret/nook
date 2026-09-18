import { Effect, Schema } from 'effect'
import * as ParseResult from 'effect/ParseResult'

export enum LandingLocale {
  English = 'en',
  Russian = 'ru',
}

const landingContextSchema = Schema.optional(Schema.String)
const landingTypeSchema = Schema.optional(Schema.String)
const landingNameSchema = Schema.optional(Schema.String)
const landingUrlSchema = Schema.optional(Schema.String)
const landingApplicationCategorySchema = Schema.optional(Schema.String)
const landingOperatingSystemSchema = Schema.optional(Schema.String)
const landingAccessibilitySchema = Schema.optional(Schema.Boolean)
const landingLanguageSchema = Schema.optional(Schema.String)

type LandingStructuredDataSchemaFields = {
  readonly '@context': typeof landingContextSchema
  readonly '@type': typeof landingTypeSchema
  readonly name: typeof landingNameSchema
  readonly url: typeof landingUrlSchema
  readonly description: typeof Schema.String
  readonly applicationCategory: typeof landingApplicationCategorySchema
  readonly operatingSystem: typeof landingOperatingSystemSchema
  readonly isAccessibleForFree: typeof landingAccessibilitySchema
  readonly inLanguage: typeof landingLanguageSchema
}

const landingStructuredDataSchemaFields: LandingStructuredDataSchemaFields = {
  '@context': landingContextSchema,
  '@type': landingTypeSchema,
  name: landingNameSchema,
  url: landingUrlSchema,
  description: Schema.String,
  applicationCategory: landingApplicationCategorySchema,
  operatingSystem: landingOperatingSystemSchema,
  isAccessibleForFree: landingAccessibilitySchema,
  inLanguage: landingLanguageSchema,
}

const LandingStructuredDataSchema = Schema.Struct(
  landingStructuredDataSchemaFields,
)

type LandingStructuredData = Schema.Schema.Type<
  typeof LandingStructuredDataSchema
>

export enum LandingStructuredDataDecodeFailureKind {
  InvalidJson = 'invalid-json',
  InvalidStructuredData = 'invalid-structured-data',
}

export class LandingStructuredDataDecodeFailure extends Error {
  readonly _tag = 'LandingStructuredDataDecodeFailure'

  private constructor(request: LandingStructuredDataDecodeFailureRequest) {
    super(request.kind)
    this.kind = request.kind
    this.cause = request.cause
  }

  readonly kind: LandingStructuredDataDecodeFailureKind
  override readonly cause: Error | ParseResult.ParseError

  static invalidJson(
    cause: Error | ParseResult.ParseError,
  ): LandingStructuredDataDecodeFailure {
    const request: LandingStructuredDataDecodeFailureRequest = {
      kind: LandingStructuredDataDecodeFailureKind.InvalidJson,
      cause,
    }
    return new LandingStructuredDataDecodeFailure(request)
  }

  static invalidStructuredData(
    cause: ParseResult.ParseError,
  ): LandingStructuredDataDecodeFailure {
    const request: LandingStructuredDataDecodeFailureRequest = {
      kind: LandingStructuredDataDecodeFailureKind.InvalidStructuredData,
      cause,
    }
    return new LandingStructuredDataDecodeFailure(request)
  }
}

type LandingStructuredDataDecodeFailureRequest = {
  readonly kind: LandingStructuredDataDecodeFailureKind
  readonly cause: Error | ParseResult.ParseError
}

export class LandingStructuredDataDecoder {
  static decode(
    serialized: string,
  ): Effect.Effect<LandingStructuredData, LandingStructuredDataDecodeFailure> {
    const jsonSchema = Schema.parseJson()
    return Schema.decodeUnknown(jsonSchema)(serialized).pipe(
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

type LocalizeLandingStructuredDataRequest = {
  serialized: string
  description: string
  locale: LandingLocale
}

export function localizeLandingStructuredData(
  request: LocalizeLandingStructuredDataRequest,
): Effect.Effect<string, LandingStructuredDataDecodeFailure> {
  const { serialized, description, locale } = request
  return LandingStructuredDataDecoder.decode(serialized).pipe(
    Effect.map((structuredData) => {
      const localizedData: LandingStructuredData = {
        ...structuredData,
        description,
        inLanguage: locale,
      }
      return JSON.stringify(localizedData)
    }),
  )
}
