import { Effect, Schema } from "effect";
import * as ParseResult from "effect/ParseResult";
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

const extensionRuntimeResponseValueSchema: Schema.Schema<ExtensionRuntimeResponseValue> =
  Schema.suspend(() => {
    const recursiveRecordFields: RuntimeResponseRecordFields = {
      key: Schema.String,
      value: extensionRuntimeResponseValueSchema,
    };
    return Schema.Union(
      Schema.String,
      Schema.Number,
      Schema.Boolean,
      Schema.mutable(Schema.Array(extensionRuntimeResponseValueSchema)),
      Schema.Record(recursiveRecordFields),
    );
  });

type RuntimeResponseRecordFields = {
  readonly key: typeof Schema.String;
  readonly value: Schema.Schema<ExtensionRuntimeResponseValue>;
};

const runtimeResponseRecordFields: RuntimeResponseRecordFields = {
  key: Schema.String,
  value: extensionRuntimeResponseValueSchema,
};
const extensionRuntimeResponseObjectSchema = Schema.Record(
  runtimeResponseRecordFields,
);

class AcceptedIdentityHandoffResponseFields {
  static build() {
    return {
      ok: Schema.Literal(true),
      envelope: Schema.String,
      nextNonce: Schema.String.pipe(Schema.minLength(1)),
    };
  }
}
export const AcceptedIdentityHandoffResponseSchema = Schema.Struct(
  AcceptedIdentityHandoffResponseFields.build(),
);

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
    value?: ExtensionRuntimeResponseObject,
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

class CompanionLauncherResponseFields {
  static build() {
    return { ok: Schema.Literal(true) };
  }
}
const CompanionLauncherResponseSchema = Schema.Struct(
  CompanionLauncherResponseFields.build(),
);

class CompanionIdentityDiscoveryResponseFields {
  static build() {
    return {
      ok: Schema.Literal(true),
      status: extensionRuntimeResponseObjectSchema,
    };
  }
}
const CompanionIdentityDiscoveryResponseSchema = Schema.Struct(
  CompanionIdentityDiscoveryResponseFields.build(),
);

class CompanionUnlockResponseFields {
  static build() {
    return {
      ok: Schema.Literal(true),
      requestId: Schema.String.pipe(Schema.minLength(1)),
      vaultStoreId: Schema.String.pipe(Schema.minLength(1)),
    };
  }
}
const CompanionUnlockResponseSchema = Schema.Struct(
  CompanionUnlockResponseFields.build(),
);

class CompanionIdentityHandoffResponseFields {
  static build() {
    return {
      ok: Schema.Literal(true),
      response: extensionRuntimeResponseObjectSchema,
    };
  }
}
const CompanionIdentityHandoffResponseSchema = Schema.Struct(
  CompanionIdentityHandoffResponseFields.build(),
);

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
    value: ExtensionRuntimeResponseObject,
  ): Effect.Effect<CompanionLauncherResponse, ExtensionResponseDecodeFailure> {
    return Schema.decodeUnknown(CompanionLauncherResponseSchema)(
      value,
      strictDecodeOptions,
    ).pipe(
      Effect.mapError((cause) => new ExtensionResponseDecodeFailure(cause)),
    );
  }
  decodeIdentityDiscovery(
    value: ExtensionRuntimeResponseObject,
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
    value: ExtensionRuntimeResponseObject,
  ): Effect.Effect<CompanionUnlockResponse, ExtensionResponseDecodeFailure> {
    return Schema.decodeUnknown(CompanionUnlockResponseSchema)(
      value,
      strictDecodeOptions,
    ).pipe(
      Effect.mapError((cause) => new ExtensionResponseDecodeFailure(cause)),
    );
  }
  decodeIdentityHandoff(
    value: ExtensionRuntimeResponseObject,
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

const eventCountFilterOptions: Schema.Annotations.Filter<number> = {
  message: () => "eventCount must be a nonnegative safe integer",
};
class PairingDeliveredResponseFields {
  static build() {
    return {
      ok: Schema.Literal(true),
      eventCount: Schema.Number.pipe(
        Schema.filter(
          (eventCount) => Number.isSafeInteger(eventCount) && eventCount >= 0,
          eventCountFilterOptions,
        ),
      ),
    };
  }
}
const PairingDeliveredResponseSchema = Schema.Struct(
  PairingDeliveredResponseFields.build(),
);
class PairingMigrationReasonResponseFields {
  static build() {
    return {
      reason: Schema.Literal("auth-provider-plaintext-migration-required"),
    };
  }
}
const PairingMigrationReasonResponseSchema = Schema.Struct(
  PairingMigrationReasonResponseFields.build(),
);
class PairingMigrationErrorResponseFields {
  static build() {
    return {
      error: Schema.Literal("auth-provider-plaintext-migration-required"),
    };
  }
}
const PairingMigrationErrorResponseSchema = Schema.Struct(
  PairingMigrationErrorResponseFields.build(),
);
class PairingRejectedReasonResponseFields {
  static build() {
    return {
      ok: Schema.Literal(false),
      reason: Schema.Enums(ExtensionPairingRejectionReason),
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
      error: Schema.Enums(ExtensionPairingRejectionReason),
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
      Effect.map(({ reason }): ExtensionPairingDelivery => ({
        kind: ExtensionPairingDeliveryKind.Rejected,
        reason,
      })),
    );
    const rejectedByError = Schema.decodeUnknown(
      PairingRejectedErrorResponseSchema,
    )(value, strictDecodeOptions).pipe(
      Effect.map(({ error }): ExtensionPairingDelivery => ({
        kind: ExtensionPairingDeliveryKind.Rejected,
        reason: error,
      })),
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
