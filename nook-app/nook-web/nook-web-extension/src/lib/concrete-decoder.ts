import { Effect, Either } from 'effect'

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

export function runConcreteDecoder<TransportInput, DecodedValue, DecodeFailure>(
  request: ConcreteDecoderRequest<TransportInput, DecodedValue, DecodeFailure>,
): ConcreteDecoderResult<DecodedValue, DecodeFailure> {
  const result = Effect.runSync(Effect.either(request.decode(request.value)))
  if (Either.isLeft(result)) {
    return {
      kind: ConcreteDecoderResultKind.Rejected,
      failure: result.left,
    }
  }
  return {
    kind: ConcreteDecoderResultKind.Decoded,
    value: result.right,
  }
}
