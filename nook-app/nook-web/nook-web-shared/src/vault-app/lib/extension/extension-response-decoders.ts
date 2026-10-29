import { Effect, Schema } from "effect";
import * as AST from "effect/SchemaAST";
import {
  ExtensionPairingDeliveryKind,
  ExtensionPairingRejectionReason,
  type ExtensionPairingDelivery,
} from "./extension-pairing-delivery";

const strictDecodeOptions: AST.ParseOptions = {
  onExcessProperty: "error",
};

export type ExtensionRuntimeResponseValue =
  | string
  | number
  | boolean
  | ExtensionRuntimeResponseValue[]
  | ExtensionRuntimeResponseObject;

export type ExtensionRuntimeResponseObject = {
  readonly [key: string]: ExtensionRuntimeResponseValue;
};

export enum ExtensionResponseDecodeFailureKind {
  InvalidResponse = "invalid-response",
}

export class ExtensionResponseDecodeFailure {
  readonly _tag = "ExtensionResponseDecodeFailure";
  readonly kind = ExtensionResponseDecodeFailureKind.InvalidResponse;

  constructor(readonly cause: Schema.SchemaError) {}
}

class AcknowledgedResponseFields {
  static build() {
    return { ok: Schema.Literal(true) };
  }
}
const AcknowledgedResponseSchema = Schema.Struct(
  AcknowledgedResponseFields.build(),
);

type AcknowledgedResponse = Schema.Schema.Type<
  typeof AcknowledgedResponseSchema
>;

/** Owns structural admission for responses from the companion runtime. */
export class CompanionResponseDecoder {
  /** A plain `{ ok: true }` acknowledgement. */
  decodeAcknowledged(
    value: ExtensionRuntimeResponseObject,
  ): Effect.Effect<AcknowledgedResponse, ExtensionResponseDecodeFailure> {
    return Schema.decodeUnknownEffect(AcknowledgedResponseSchema)(
      value,
      strictDecodeOptions,
    ).pipe(
      Effect.mapError((cause) => new ExtensionResponseDecodeFailure(cause)),
    );
  }
}

export const companionResponseDecoder = new CompanionResponseDecoder();

const eventCountFilterOptions: Schema.Annotations.Filter = {
  message: "eventCount must be a nonnegative safe integer",
};
class PairingDeliveredResponseFields {
  static build() {
    return {
      ok: Schema.Literal(true),
      eventCount: Schema.Number.pipe(
        Schema.check(
          Schema.makeFilter(
            (eventCount) => Number.isSafeInteger(eventCount) && eventCount >= 0,
            eventCountFilterOptions,
          ),
        ),
      ),
    };
  }
}
const PairingDeliveredResponseSchema = Schema.Struct(
  PairingDeliveredResponseFields.build(),
);
class PairingRejectedReasonResponseFields {
  static build() {
    return {
      ok: Schema.Literal(false),
      reason: Schema.Enum(ExtensionPairingRejectionReason),
    };
  }
}
const PairingRejectedReasonResponseSchema = Schema.Struct(
  PairingRejectedReasonResponseFields.build(),
);
class PairingRejectedErrorResponseFields {
  static build() {
    return {
      ok: Schema.Literal(false),
      error: Schema.Enum(ExtensionPairingRejectionReason),
    };
  }
}
const PairingRejectedErrorResponseSchema = Schema.Struct(
  PairingRejectedErrorResponseFields.build(),
);
class PairingRejectedResponseFields {
  static build() {
    return { ok: Schema.Literal(false) };
  }
}
const PairingRejectedResponseSchema = Schema.Struct(
  PairingRejectedResponseFields.build(),
);

/** Owns admission of the extension's untrusted pairing acknowledgement. */
export class PairingApprovalResponseDecoder {
  decode(
    value: ExtensionRuntimeResponseObject,
  ): Effect.Effect<ExtensionPairingDelivery, ExtensionResponseDecodeFailure> {
    const delivered = Schema.decodeUnknownEffect(
      PairingDeliveredResponseSchema,
    )(value, strictDecodeOptions).pipe(
      Effect.map(({ eventCount }): ExtensionPairingDelivery => ({
        kind: ExtensionPairingDeliveryKind.Delivered,
        eventCount,
      })),
    );
    const rejectedByReason = Schema.decodeUnknownEffect(
      PairingRejectedReasonResponseSchema,
    )(value, strictDecodeOptions).pipe(
      Effect.map(({ reason }): ExtensionPairingDelivery => ({
        kind: ExtensionPairingDeliveryKind.Rejected,
        reason,
      })),
    );
    const rejectedByError = Schema.decodeUnknownEffect(
      PairingRejectedErrorResponseSchema,
    )(value, strictDecodeOptions).pipe(
      Effect.map(({ error }): ExtensionPairingDelivery => ({
        kind: ExtensionPairingDeliveryKind.Rejected,
        reason: error,
      })),
    );
    const rejected = Schema.decodeUnknownEffect(PairingRejectedResponseSchema)(
      value,
      strictDecodeOptions,
    ).pipe(
      Effect.map((): ExtensionPairingDelivery => ({
        kind: ExtensionPairingDeliveryKind.Rejected,
      })),
    );

    return delivered.pipe(
      Effect.catch(() => rejectedByReason),
      Effect.catch(() => rejectedByError),
      Effect.catch(() => rejected),
      Effect.mapError((cause) => new ExtensionResponseDecodeFailure(cause)),
    );
  }
}

export const pairingApprovalResponseDecoder =
  new PairingApprovalResponseDecoder();
