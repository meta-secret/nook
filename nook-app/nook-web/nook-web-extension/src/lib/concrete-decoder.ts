import { Effect, Result } from 'effect'

export enum ConcreteDecoderResultKind {
  Decoded = 'decoded',
  Rejected = 'rejected',
}

export type ConcreteDecoderResult<Value, Failure> =
  | { kind: ConcreteDecoderResultKind.Decoded; value: Value }
  | { kind: ConcreteDecoderResultKind.Rejected; failure: Failure }

export type ConcreteDecoderRequest<
  TransportInput,
  DecodedValue,
  DecodeFailure,
> = {
  readonly decode: (
    input: TransportInput,
  ) => Effect.Effect<DecodedValue, DecodeFailure>
  readonly value: TransportInput
}

type LegacyConcreteDecoderArguments<
  TransportInput,
  DecodedValue,
  DecodeFailure,
> = [
  decoder: (
    input: TransportInput,
  ) => Effect.Effect<DecodedValue, DecodeFailure>,
  value: TransportInput,
]

type ConcreteDecoderRequestArguments<
  TransportInput,
  DecodedValue,
  DecodeFailure,
> = [
  request: ConcreteDecoderRequest<TransportInput, DecodedValue, DecodeFailure>,
]

export function runConcreteDecoder<TransportInput, DecodedValue, DecodeFailure>(
  request: ConcreteDecoderRequest<TransportInput, DecodedValue, DecodeFailure>,
): ConcreteDecoderResult<DecodedValue, DecodeFailure>
export function runConcreteDecoder<TransportInput, DecodedValue, DecodeFailure>(
  ...legacyRequest: LegacyConcreteDecoderArguments<
    TransportInput,
    DecodedValue,
    DecodeFailure
  >
): ConcreteDecoderResult<DecodedValue, DecodeFailure>
export function runConcreteDecoder<TransportInput, DecodedValue, DecodeFailure>(
  ...request:
    | ConcreteDecoderRequestArguments<
        TransportInput,
        DecodedValue,
        DecodeFailure
      >
    | LegacyConcreteDecoderArguments<
        TransportInput,
        DecodedValue,
        DecodeFailure
      >
): ConcreteDecoderResult<DecodedValue, DecodeFailure> {
  const decoderRequest: ConcreteDecoderRequest<
    TransportInput,
    DecodedValue,
    DecodeFailure
  > =
    request.length === 1
      ? request[0]
      : { decode: request[0], value: request[1] }
  const result = Effect.runSync(
    Effect.result(decoderRequest.decode(decoderRequest.value)),
  )
  if (Result.isFailure(result)) {
    return {
      kind: ConcreteDecoderResultKind.Rejected,
      failure: result.failure,
    }
  }
  return {
    kind: ConcreteDecoderResultKind.Decoded,
    value: result.success,
  }
}
