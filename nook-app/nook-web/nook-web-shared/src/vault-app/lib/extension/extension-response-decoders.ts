import { Effect, Schema } from "effect";
import * as AST from "effect/SchemaAST";
import { NookExtensionIdentityHandoffProviderOutcome } from "$app-wasm";
import type { NookExtensionIdentityHandoffProviderOutcomeState } from "$app-wasm";
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

const extensionRuntimeResponseValueSchema: Schema.Codec<ExtensionRuntimeResponseValue> =
  Schema.suspend(() => {
    const recursiveRecordFields: RuntimeResponseRecordFields = {
      key: Schema.String,
      value: extensionRuntimeResponseValueSchema,
    };
    return Schema.Union([
      Schema.String,
      Schema.Number,
      Schema.Boolean,
      Schema.mutable(Schema.Array(extensionRuntimeResponseValueSchema)),
      Schema.Record(recursiveRecordFields.key, recursiveRecordFields.value),
    ]);
  });

type RuntimeResponseRecordFields = {
  readonly key: typeof Schema.String;
  readonly value: Schema.Codec<ExtensionRuntimeResponseValue>;
};

const runtimeResponseRecordFields: RuntimeResponseRecordFields = {
  key: Schema.String,
  value: extensionRuntimeResponseValueSchema,
};
const extensionRuntimeResponseObjectSchema = Schema.Record(
  runtimeResponseRecordFields.key,
  runtimeResponseRecordFields.value,
);

class AcceptedIdentityHandoffResponseFields {
  static build() {
    return {
      ok: Schema.Literal(true),
      envelope: Schema.String,
      nextNonce: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
    };
  }
}
export const AcceptedIdentityHandoffResponseSchema = Schema.Struct(
  AcceptedIdentityHandoffResponseFields.build(),
);

export type AcceptedIdentityHandoffResponse = Schema.Schema.Type<
  typeof AcceptedIdentityHandoffResponseSchema
>;

class RejectedIdentityHandoffResponseFields {
  static build() {
    return {
      ok: Schema.Literal(false),
      reason: Schema.String,
    };
  }
}
const RejectedIdentityHandoffResponseSchema = Schema.Struct(
  RejectedIdentityHandoffResponseFields.build(),
);

type RejectedIdentityHandoffResponseInput = Schema.Schema.Type<
  typeof RejectedIdentityHandoffResponseSchema
>;

export type RejectedIdentityHandoffResponse = {
  readonly ok: false;
  readonly state: NookExtensionIdentityHandoffProviderOutcomeState;
};

export type IdentityHandoffResponse =
  AcceptedIdentityHandoffResponse | RejectedIdentityHandoffResponse;

export enum ExtensionResponseDecodeFailureKind {
  InvalidResponse = "invalid-response",
}

export class ExtensionResponseDecodeFailure {
  readonly _tag = "ExtensionResponseDecodeFailure";
  readonly kind = ExtensionResponseDecodeFailureKind.InvalidResponse;

  constructor(readonly cause: Schema.SchemaError) {}
}

export class IdentityHandoffResponseDecoder {
  decode(
    value?: ExtensionRuntimeResponseObject,
  ): Effect.Effect<IdentityHandoffResponse, ExtensionResponseDecodeFailure> {
    const accepted = Schema.decodeUnknownEffect(
      AcceptedIdentityHandoffResponseSchema,
    )(value, strictDecodeOptions).pipe(
      Effect.mapError((cause) => new ExtensionResponseDecodeFailure(cause)),
    );
    const rejected = Schema.decodeUnknownEffect(
      RejectedIdentityHandoffResponseSchema,
    )(value, strictDecodeOptions).pipe(
      Effect.map(
        (
          response: RejectedIdentityHandoffResponseInput,
        ): RejectedIdentityHandoffResponse => {
          const outcome =
            NookExtensionIdentityHandoffProviderOutcome.classify_rejection(
              response.reason,
            );
          try {
            return { ok: false, state: outcome.state };
          } finally {
            outcome.free();
          }
        },
      ),
      Effect.mapError((cause) => new ExtensionResponseDecodeFailure(cause)),
    );
    return accepted.pipe(Effect.catch(() => rejected));
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
      requestId: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
      vaultStoreId: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
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
    return Schema.decodeUnknownEffect(CompanionLauncherResponseSchema)(
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
    return Schema.decodeUnknownEffect(CompanionIdentityDiscoveryResponseSchema)(
      value,
      strictDecodeOptions,
    ).pipe(
      Effect.mapError((cause) => new ExtensionResponseDecodeFailure(cause)),
    );
  }
  decodeUnlock(
    value: ExtensionRuntimeResponseObject,
  ): Effect.Effect<CompanionUnlockResponse, ExtensionResponseDecodeFailure> {
    return Schema.decodeUnknownEffect(CompanionUnlockResponseSchema)(
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
    return Schema.decodeUnknownEffect(CompanionIdentityHandoffResponseSchema)(
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
    const migrationByReason = Schema.decodeUnknownEffect(
      PairingMigrationReasonResponseSchema,
    )(value, strictDecodeOptions).pipe(
      Effect.map((): ExtensionPairingDelivery => ({
        kind: ExtensionPairingDeliveryKind.PlaintextProviderMigrationRequired,
      })),
    );
    const migrationByError = Schema.decodeUnknownEffect(
      PairingMigrationErrorResponseSchema,
    )(value, strictDecodeOptions).pipe(
      Effect.map((): ExtensionPairingDelivery => ({
        kind: ExtensionPairingDeliveryKind.PlaintextProviderMigrationRequired,
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
      Effect.catch(() => migrationByReason),
      Effect.catch(() => migrationByError),
      Effect.catch(() => rejectedByReason),
      Effect.catch(() => rejectedByError),
      Effect.catch(() => rejected),
      Effect.mapError((cause) => new ExtensionResponseDecodeFailure(cause)),
    );
  }
}

export const pairingApprovalResponseDecoder =
  new PairingApprovalResponseDecoder();
