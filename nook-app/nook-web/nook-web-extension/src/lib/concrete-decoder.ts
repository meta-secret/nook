import { Effect, Either } from 'effect'

export enum ConcreteDecoderResultKind {
  Decoded = 'decoded',
  Rejected = 'rejected',
}

export type ConcreteDecoderResult<Value, Failure> =
  | { kind: ConcreteDecoderResultKind.Decoded; value: Value }
  | { kind: ConcreteDecoderResultKind.Rejected; failure: Failure }

export function runConcreteDecoder<Input, Value, Failure>(
  decode: (value: Input) => Effect.Effect<Value, Failure>,
  value: Input,
): ConcreteDecoderResult<Value, Failure> {
  const result = Effect.runSync(Effect.either(decode(value)))
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
