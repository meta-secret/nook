import { Effect, Schema } from "effect";
import * as ParseResult from "effect/ParseResult";
import {
  ExtensionPairingDeliveryKind,
  ExtensionPairingRejectionReason,
  type ExtensionPairingDelivery,
} from "./extension-pairing-delivery";

const strictDecodeOptions = { onExcessProperty: "error" } as const;

export const AcceptedIdentityHandoffResponseSchema = Schema.Struct({
  ok: Schema.Literal(true),
  envelope: Schema.String,
  nextNonce: Schema.String.pipe(Schema.minLength(1)),
});

export type AcceptedIdentityHandoffResponse = Schema.Schema.Type<
  typeof AcceptedIdentityHandoffResponseSchema
>;

export enum ExtensionResponseDecodeFailureKind {
  InvalidResponse = "invalid-response",
}

export class ExtensionResponseDecodeFailure {
  readonly _tag = "ExtensionResponseDecodeFailure";
  readonly kind = ExtensionResponseDecodeFailureKind.InvalidResponse;

  constructor(readonly cause: ParseResult.ParseError) {}
}

export class IdentityHandoffResponseDecoder {
  decode(
    value: object | undefined,
  ): Effect.Effect<
    AcceptedIdentityHandoffResponse,
    ExtensionResponseDecodeFailure
  > {
    return Schema.decodeUnknown(AcceptedIdentityHandoffResponseSchema)(
      value,
      strictDecodeOptions,
    ).pipe(
      Effect.mapError((cause) => new ExtensionResponseDecodeFailure(cause)),
    );
  }
}

export const identityHandoffResponseDecoder =
  new IdentityHandoffResponseDecoder();

const PairingDeliveredResponseSchema = Schema.Struct({
  ok: Schema.Literal(true),
});
const PairingMigrationReasonResponseSchema = Schema.Struct({
  reason: Schema.Literal("auth-provider-plaintext-migration-required"),
});
const PairingMigrationErrorResponseSchema = Schema.Struct({
  error: Schema.Literal("auth-provider-plaintext-migration-required"),
});
const PairingRejectedReasonResponseSchema = Schema.Struct({
  ok: Schema.Literal(false),
  reason: Schema.Enums(ExtensionPairingRejectionReason),
});
const PairingRejectedErrorResponseSchema = Schema.Struct({
  ok: Schema.Literal(false),
  error: Schema.Enums(ExtensionPairingRejectionReason),
});
const PairingRejectedResponseSchema = Schema.Struct({
  ok: Schema.Literal(false),
});

/** Owns admission of the extension's untrusted pairing acknowledgement. */
export class PairingApprovalResponseDecoder {
  decode(
    value: object,
  ): Effect.Effect<ExtensionPairingDelivery, ExtensionResponseDecodeFailure> {
    const delivered = Schema.decodeUnknown(PairingDeliveredResponseSchema)(
      value,
      strictDecodeOptions,
    ).pipe(
      Effect.map((): ExtensionPairingDelivery => ({
        kind: ExtensionPairingDeliveryKind.Delivered,
      })),
    );
    const migrationByReason = Schema.decodeUnknown(
      PairingMigrationReasonResponseSchema,
    )(value, strictDecodeOptions).pipe(
      Effect.map((): ExtensionPairingDelivery => ({
        kind: ExtensionPairingDeliveryKind.PlaintextProviderMigrationRequired,
      })),
    );
    const migrationByError = Schema.decodeUnknown(
      PairingMigrationErrorResponseSchema,
    )(value, strictDecodeOptions).pipe(
      Effect.map((): ExtensionPairingDelivery => ({
        kind: ExtensionPairingDeliveryKind.PlaintextProviderMigrationRequired,
      })),
    );
    const rejectedByReason = Schema.decodeUnknown(
      PairingRejectedReasonResponseSchema,
    )(value, strictDecodeOptions).pipe(
      Effect.map(
        ({ reason }): ExtensionPairingDelivery => ({
          kind: ExtensionPairingDeliveryKind.Rejected,
          reason,
        }),
      ),
    );
    const rejectedByError = Schema.decodeUnknown(
      PairingRejectedErrorResponseSchema,
    )(value, strictDecodeOptions).pipe(
      Effect.map(
        ({ error }): ExtensionPairingDelivery => ({
          kind: ExtensionPairingDeliveryKind.Rejected,
          reason: error,
        }),
      ),
    );
    const rejected = Schema.decodeUnknown(PairingRejectedResponseSchema)(
      value,
      strictDecodeOptions,
    ).pipe(
      Effect.map((): ExtensionPairingDelivery => ({
        kind: ExtensionPairingDeliveryKind.Rejected,
      })),
    );

    return delivered.pipe(
      Effect.orElse(() => migrationByReason),
      Effect.orElse(() => migrationByError),
      Effect.orElse(() => rejectedByReason),
      Effect.orElse(() => rejectedByError),
      Effect.orElse(() => rejected),
      Effect.mapError((cause) => new ExtensionResponseDecodeFailure(cause)),
    );
  }
}

export const pairingApprovalResponseDecoder =
  new PairingApprovalResponseDecoder();
