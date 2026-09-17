import { Effect, Schema } from 'effect'
import * as ParseResult from 'effect/ParseResult'

export enum LandingLocale {
  English = 'en',
  Russian = 'ru',
}

const LandingStructuredDataSchema = Schema.Struct({
  '@context': Schema.optional(Schema.String),
  '@type': Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
  description: Schema.String,
  applicationCategory: Schema.optional(Schema.String),
  operatingSystem: Schema.optional(Schema.String),
  isAccessibleForFree: Schema.optional(Schema.Boolean),
  inLanguage: Schema.optional(Schema.String),
})

type LandingStructuredData = Schema.Schema.Type<
  typeof LandingStructuredDataSchema
>

export enum LandingStructuredDataDecodeFailureKind {
  InvalidJson = 'invalid-json',
  InvalidStructuredData = 'invalid-structured-data',
}

export class LandingStructuredDataDecodeFailure extends Error {
  readonly _tag = 'LandingStructuredDataDecodeFailure'

  private constructor(
    readonly kind: LandingStructuredDataDecodeFailureKind,
    override readonly cause: Error | ParseResult.ParseError,
  ) {
    super(kind)
  }

  static invalidJson(cause: Error): LandingStructuredDataDecodeFailure {
    return new LandingStructuredDataDecodeFailure(
      LandingStructuredDataDecodeFailureKind.InvalidJson,
      cause,
    )
  }

  static invalidStructuredData(
    cause: ParseResult.ParseError,
  ): LandingStructuredDataDecodeFailure {
    return new LandingStructuredDataDecodeFailure(
      LandingStructuredDataDecodeFailureKind.InvalidStructuredData,
      cause,
    )
  }
}

export class LandingStructuredDataDecoder {
  static decode(
    serialized: string,
  ): Effect.Effect<LandingStructuredData, LandingStructuredDataDecodeFailure> {
    return Effect.try({
      try: () => JSON.parse(serialized),
      catch: (cause) =>
        LandingStructuredDataDecodeFailure.invalidJson(
          cause instanceof Error ? cause : new Error(String(cause)),
        ),
    }).pipe(
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
    Effect.map((structuredData) =>
      JSON.stringify({ ...structuredData, description, inLanguage: locale }),
    ),
  )
}
