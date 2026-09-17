import { Effect, Schema } from "effect";
import * as ParseResult from "effect/ParseResult";
import {
  ExtensionPairingDeliveryKind,
  ExtensionPairingRejectionReason,
  type ExtensionPairingDelivery,
} from "./extension-pairing-delivery";

const strictDecodeOptions = { onExcessProperty: "error" } as const;

export type ExtensionRuntimeResponseValue =
  | string
  | number
  | boolean
  | ExtensionRuntimeResponseValue[]
  | { readonly [key: string]: ExtensionRuntimeResponseValue };

const extensionRuntimeResponseValueSchema: Schema.Schema<ExtensionRuntimeResponseValue> =
  Schema.suspend(() =>
    Schema.Union(
      Schema.String,
      Schema.Number,
      Schema.Boolean,
      Schema.mutable(Schema.Array(extensionRuntimeResponseValueSchema)),
      Schema.Record({
        key: Schema.String,
        value: extensionRuntimeResponseValueSchema,
      }),
    ),
  );

const extensionRuntimeResponseObjectSchema = Schema.Record({
  key: Schema.String,
  value: extensionRuntimeResponseValueSchema,
});

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

const CompanionLauncherResponseSchema = Schema.Struct({
  ok: Schema.Literal(true),
});

const CompanionIdentityDiscoveryResponseSchema = Schema.Struct({
  ok: Schema.Literal(true),
  status: extensionRuntimeResponseObjectSchema,
});

const CompanionUnlockResponseSchema = Schema.Struct({
  ok: Schema.Literal(true),
  requestId: Schema.String.pipe(Schema.minLength(1)),
  vaultStoreId: Schema.String.pipe(Schema.minLength(1)),
});

const CompanionIdentityHandoffResponseSchema = Schema.Struct({
  ok: Schema.Literal(true),
  response: extensionRuntimeResponseObjectSchema,
});

type CompanionLauncherResponse = Schema.Schema.Type<
  typeof CompanionLauncherResponseSchema
>;
type CompanionIdentityDiscoveryResponse = Schema.Schema.Type<
  typeof CompanionIdentityDiscoveryResponseSchema
>;
type CompanionUnlockResponse = Schema.Schema.Type<
  typeof CompanionUnlockResponseSchema
>;
type CompanionIdentityHandoffResponse = Schema.Schema.Type<
  typeof CompanionIdentityHandoffResponseSchema
>;

/** Owns structural admission for responses from the companion runtime. */
export class CompanionResponseDecoder {
  decodeLauncher(
    value: object,
  ): Effect.Effect<CompanionLauncherResponse, ExtensionResponseDecodeFailure> {
    return Schema.decodeUnknown(CompanionLauncherResponseSchema)(
      value,
      strictDecodeOptions,
    ).pipe(
      Effect.mapError((cause) => new ExtensionResponseDecodeFailure(cause)),
    );
  }
  decodeIdentityDiscovery(
    value: object,
  ): Effect.Effect<
    CompanionIdentityDiscoveryResponse,
    ExtensionResponseDecodeFailure
  > {
    return Schema.decodeUnknown(CompanionIdentityDiscoveryResponseSchema)(
      value,
      strictDecodeOptions,
    ).pipe(
      Effect.mapError((cause) => new ExtensionResponseDecodeFailure(cause)),
    );
  }
  decodeUnlock(
    value: object,
  ): Effect.Effect<CompanionUnlockResponse, ExtensionResponseDecodeFailure> {
    return Schema.decodeUnknown(CompanionUnlockResponseSchema)(
      value,
      strictDecodeOptions,
    ).pipe(
      Effect.mapError((cause) => new ExtensionResponseDecodeFailure(cause)),
    );
  }
  decodeIdentityHandoff(
    value: object,
  ): Effect.Effect<
    CompanionIdentityHandoffResponse,
    ExtensionResponseDecodeFailure
  > {
    return Schema.decodeUnknown(CompanionIdentityHandoffResponseSchema)(
      value,
      strictDecodeOptions,
    ).pipe(
      Effect.mapError((cause) => new ExtensionResponseDecodeFailure(cause)),
    );
  }
}

export const companionResponseDecoder = new CompanionResponseDecoder();

const PairingDeliveredResponseSchema = Schema.Struct({
  ok: Schema.Literal(true),
  eventCount: Schema.Number.pipe(
    Schema.filter(
      (eventCount) => Number.isSafeInteger(eventCount) && eventCount >= 0,
      { message: () => "eventCount must be a nonnegative safe integer" },
    ),
  ),
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
      Effect.map(({ eventCount }): ExtensionPairingDelivery => ({
        kind: ExtensionPairingDeliveryKind.Delivered,
        eventCount,
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
