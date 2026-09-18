import { Effect, Schema } from "effect";
import type { ExtensionEventLogRecord as RustExtensionEventLogRecord } from "./nook-companion-wasm/nook_companion_wasm.js";
import {
  RuntimeMessageDecodeFailure,
  RuntimeMessageDecodeFailureKind,
} from "./runtime-message-decode-failure";

type RuntimeMessageDecodeRequest<DecodedMessage, WireMessage> = {
  readonly schema: Schema.Schema<DecodedMessage>;
  readonly value: WireMessage;
  readonly kind: RuntimeMessageDecodeFailureKind;
};

function decodeRuntimeMessage<DecodedMessage, WireMessage>(
  request: RuntimeMessageDecodeRequest<DecodedMessage, WireMessage>,
): Effect.Effect<DecodedMessage, RuntimeMessageDecodeFailure> {
  return Schema.decodeUnknown(request.schema)(request.value).pipe(
    Effect.mapError((cause) => {
      const failureRequest: Parameters<
        typeof RuntimeMessageDecodeFailure.fromParseError
      >[0] = {
        kind: request.kind,
        cause,
      };
      return RuntimeMessageDecodeFailure.fromParseError(failureRequest);
    }),
  );
}

export enum OpenSimpleVaultMessageType {
  NookOpenSimpleVault = "nook:open-simple-vault",
}

const openSimpleVaultTypeSchema = Schema.Literal(
  OpenSimpleVaultMessageType.NookOpenSimpleVault,
);
type OpenSimpleVaultMessageFields = {
  readonly type: typeof openSimpleVaultTypeSchema;
};

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class OpenSimpleVaultMessage {
  private constructor() {}
  declare readonly type: OpenSimpleVaultMessageType.NookOpenSimpleVault;
  static decode<WireMessage>(
    message: WireMessage,
  ): Effect.Effect<OpenSimpleVaultMessage, RuntimeMessageDecodeFailure> {
    const schemaFields: OpenSimpleVaultMessageFields = {
      type: openSimpleVaultTypeSchema,
    };
    const request: RuntimeMessageDecodeRequest<
      OpenSimpleVaultMessage,
      WireMessage
    > = {
      schema: Schema.Struct(schemaFields),
      value: message,
      kind: RuntimeMessageDecodeFailureKind.OpenSimpleVault,
    };
    return decodeRuntimeMessage(request);
  }
}

export enum BeginExtensionPairingMessageType {
  NookBeginExtensionPairing = "nook:begin-extension-pairing",
}

const beginExtensionPairingTypeSchema = Schema.Literal(
  BeginExtensionPairingMessageType.NookBeginExtensionPairing,
);
const beginExtensionPairingDeviceIdSchema = Schema.String.pipe(
  Schema.minLength(1),
);
const beginExtensionPairingDevicePublicKeySchema = Schema.String.pipe(
  Schema.minLength(1),
);
const beginExtensionPairingDeviceSigningPublicKeySchema = Schema.String.pipe(
  Schema.minLength(1),
);
const beginExtensionPairingDeviceLabelSchema = Schema.String.pipe(
  Schema.minLength(1),
);
type BeginExtensionPairingPayloadFields = {
  readonly deviceId: typeof beginExtensionPairingDeviceIdSchema;
  readonly devicePublicKey: typeof beginExtensionPairingDevicePublicKeySchema;
  readonly deviceSigningPublicKey: typeof beginExtensionPairingDeviceSigningPublicKeySchema;
  readonly deviceLabel: typeof beginExtensionPairingDeviceLabelSchema;
};
const beginExtensionPairingPayloadFields: BeginExtensionPairingPayloadFields = {
  deviceId: beginExtensionPairingDeviceIdSchema,
  devicePublicKey: beginExtensionPairingDevicePublicKeySchema,
  deviceSigningPublicKey: beginExtensionPairingDeviceSigningPublicKeySchema,
  deviceLabel: beginExtensionPairingDeviceLabelSchema,
};
const beginExtensionPairingPayloadSchema = Schema.Struct(
  beginExtensionPairingPayloadFields,
);
type BeginExtensionPairingMessageFields = {
  readonly type: typeof beginExtensionPairingTypeSchema;
  readonly payload: typeof beginExtensionPairingPayloadSchema;
};

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class BeginExtensionPairingMessage {
  private constructor() {}
  declare readonly type: BeginExtensionPairingMessageType.NookBeginExtensionPairing;
  declare readonly payload: {
    deviceId: string;
    devicePublicKey: string;
    deviceSigningPublicKey: string;
    deviceLabel: string;
  };
  static decode<WireMessage>(
    message: WireMessage,
  ): Effect.Effect<BeginExtensionPairingMessage, RuntimeMessageDecodeFailure> {
    const schemaFields: BeginExtensionPairingMessageFields = {
      type: beginExtensionPairingTypeSchema,
      payload: beginExtensionPairingPayloadSchema,
    };
    const request: RuntimeMessageDecodeRequest<
      BeginExtensionPairingMessage,
      WireMessage
    > = {
      schema: Schema.Struct(schemaFields),
      value: message,
      kind: RuntimeMessageDecodeFailureKind.BeginExtensionPairing,
    };
    return decodeRuntimeMessage(request);
  }
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export type ExtensionEventLogRecord = RustExtensionEventLogRecord;
export type ExtensionEventLogRecordRuntime = {
  readonly decode_extension_event_log_record: typeof import("./nook-companion-wasm/nook_companion_wasm.js").decode_extension_event_log_record;
};

enum ExtensionEventLogRecordRuntimeStateKind {
  Unconfigured = "unconfigured",
  Configured = "configured",
}

type ExtensionEventLogRecordRuntimeState =
  | { readonly kind: ExtensionEventLogRecordRuntimeStateKind.Unconfigured }
  | {
      readonly kind: ExtensionEventLogRecordRuntimeStateKind.Configured;
      readonly runtime: ExtensionEventLogRecordRuntime;
    };

export class ExtensionEventLogRecordAdmission {
  private constructor() {}
  private static runtimeState: ExtensionEventLogRecordRuntimeState = {
    kind: ExtensionEventLogRecordRuntimeStateKind.Unconfigured,
  };

  static configure(runtime: ExtensionEventLogRecordRuntime): void {
    ExtensionEventLogRecordAdmission.runtimeState = {
      kind: ExtensionEventLogRecordRuntimeStateKind.Configured,
      runtime,
    };
  }

  static decode<WireValue>(
    value: WireValue,
  ): Effect.Effect<ExtensionEventLogRecord, RuntimeMessageDecodeFailure> {
    switch (ExtensionEventLogRecordAdmission.runtimeState.kind) {
      case ExtensionEventLogRecordRuntimeStateKind.Unconfigured: {
        const failureRequest: Parameters<
          typeof RuntimeMessageDecodeFailure.fromCause
        >[0] = {
          kind: RuntimeMessageDecodeFailureKind.ExtensionEventLogRecord,
          cause: new Error("Extension event-log decoder is not configured."),
        };
        const failure = RuntimeMessageDecodeFailure.fromCause(failureRequest);
        return Effect.fail(failure);
      }
      case ExtensionEventLogRecordRuntimeStateKind.Configured: {
        const { runtime } = ExtensionEventLogRecordAdmission.runtimeState;
        return Effect.try(() =>
          runtime.decode_extension_event_log_record(value),
        ).pipe(
          Effect.mapError((cause) => {
            const failureRequest: Parameters<
              typeof RuntimeMessageDecodeFailure.fromCause
            >[0] = {
              kind: RuntimeMessageDecodeFailureKind.ExtensionEventLogRecord,
              cause,
            };
            return RuntimeMessageDecodeFailure.fromCause(failureRequest);
          }),
        );
      }
    }
  }
}

export enum ExtensionLocalEventLogUpdatedMessageType {
  NookExtensionLocalEventLogUpdated = "nook:extension-local-event-log-updated",
}

const extensionLocalEventLogUpdatedTypeSchema = Schema.Literal(
  ExtensionLocalEventLogUpdatedMessageType.NookExtensionLocalEventLogUpdated,
);
const extensionLocalEventLogUpdatedVaultStoreIdSchema = Schema.String.pipe(
  Schema.minLength(1),
);
const extensionLocalEventLogUpdatedRecordsSchema = Schema.Array(
  Schema.Unknown,
).pipe(Schema.minItems(1));
type ExtensionLocalEventLogUpdatedPayloadFields = {
  readonly vaultStoreId: typeof extensionLocalEventLogUpdatedVaultStoreIdSchema;
  readonly eventLogRecords: typeof extensionLocalEventLogUpdatedRecordsSchema;
};
const extensionLocalEventLogUpdatedPayloadFields: ExtensionLocalEventLogUpdatedPayloadFields =
  {
    vaultStoreId: extensionLocalEventLogUpdatedVaultStoreIdSchema,
    eventLogRecords: extensionLocalEventLogUpdatedRecordsSchema,
  };
const extensionLocalEventLogUpdatedPayloadSchema = Schema.Struct(
  extensionLocalEventLogUpdatedPayloadFields,
);
type ExtensionLocalEventLogUpdatedEnvelopeFields = {
  readonly type: typeof extensionLocalEventLogUpdatedTypeSchema;
  readonly payload: typeof extensionLocalEventLogUpdatedPayloadSchema;
};

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class ExtensionLocalEventLogUpdatedMessage {
  private constructor() {}
  declare readonly type: ExtensionLocalEventLogUpdatedMessageType.NookExtensionLocalEventLogUpdated;
  declare readonly payload: {
    vaultStoreId: string;
    eventLogRecords: ExtensionEventLogRecord[];
  };
  static decode<WireMessage>(
    message: WireMessage,
  ): Effect.Effect<
    ExtensionLocalEventLogUpdatedMessage,
    RuntimeMessageDecodeFailure
  > {
    const envelopeFields: ExtensionLocalEventLogUpdatedEnvelopeFields = {
      type: extensionLocalEventLogUpdatedTypeSchema,
      payload: extensionLocalEventLogUpdatedPayloadSchema,
    };
    const envelopeSchema = Schema.Struct(envelopeFields);
    type ExtensionLocalEventLogUpdatedEnvelope = Schema.Schema.Type<
      typeof envelopeSchema
    >;
    const request: RuntimeMessageDecodeRequest<
      ExtensionLocalEventLogUpdatedEnvelope,
      WireMessage
    > = {
      schema: envelopeSchema,
      value: message,
      kind: RuntimeMessageDecodeFailureKind.ExtensionLocalEventLogUpdated,
    };
    const eventLogRecordDecodeOptions: { readonly concurrency: "unbounded" } = {
      concurrency: "unbounded",
    };
    return decodeRuntimeMessage(request).pipe(
      Effect.flatMap(({ type, payload }) =>
        Effect.all(
          payload.eventLogRecords.map(ExtensionEventLogRecord.decode),
          eventLogRecordDecodeOptions,
        ).pipe(
          Effect.map((eventLogRecords) => ({
            type,
            payload: { vaultStoreId: payload.vaultStoreId, eventLogRecords },
          })),
        ),
      ),
    );
  }
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class RuntimeMessageEnvelope {
  private constructor() {}
  declare readonly type: string;
  static decode<WireMessage>(
    message: WireMessage,
  ): Effect.Effect<RuntimeMessageEnvelope, RuntimeMessageDecodeFailure> {
    const runtimeMessageEnvelopeFields: {
      readonly type: typeof Schema.String;
    } = {
      type: Schema.String,
    };
    const request: RuntimeMessageDecodeRequest<
      RuntimeMessageEnvelope,
      WireMessage
    > = {
      schema: Schema.Struct(runtimeMessageEnvelopeFields),
      value: message,
      kind: RuntimeMessageDecodeFailureKind.RuntimeMessageEnvelope,
    };
    return decodeRuntimeMessage(request);
  }
}

export const ExtensionEventLogRecord = ExtensionEventLogRecordAdmission;
