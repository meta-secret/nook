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

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class OpenSimpleVaultMessage {
  private constructor() {}
  declare readonly type: OpenSimpleVaultMessageType.NookOpenSimpleVault;
  static decode<WireMessage>(
    message: WireMessage,
  ): Effect.Effect<OpenSimpleVaultMessage, RuntimeMessageDecodeFailure> {
    const schemaFields: Schema.Struct.Fields = {
      type: Schema.Literal(OpenSimpleVaultMessageType.NookOpenSimpleVault),
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
    const payloadFields: Schema.Struct.Fields = {
      deviceId: Schema.String.pipe(Schema.minLength(1)),
      devicePublicKey: Schema.String.pipe(Schema.minLength(1)),
      deviceSigningPublicKey: Schema.String.pipe(Schema.minLength(1)),
      deviceLabel: Schema.String.pipe(Schema.minLength(1)),
    };
    const schemaFields: Schema.Struct.Fields = {
      type: Schema.Literal(
        BeginExtensionPairingMessageType.NookBeginExtensionPairing,
      ),
      payload: Schema.Struct(payloadFields),
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
        const decodeAttempt: Parameters<typeof Effect.try>[0] = {
          try: () => runtime.decode_extension_event_log_record(value),
          catch: (cause) => {
            const failureRequest: Parameters<
              typeof RuntimeMessageDecodeFailure.fromCause
            >[0] = {
              kind: RuntimeMessageDecodeFailureKind.ExtensionEventLogRecord,
              cause,
            };
            return RuntimeMessageDecodeFailure.fromCause(failureRequest);
          },
        };
        return Effect.try(decodeAttempt);
      }
    }
  }
}

export enum ExtensionLocalEventLogUpdatedMessageType {
  NookExtensionLocalEventLogUpdated = "nook:extension-local-event-log-updated",
}

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
    const payloadFields: Schema.Struct.Fields = {
      vaultStoreId: Schema.String.pipe(Schema.minLength(1)),
      eventLogRecords: Schema.Array(Schema.Unknown).pipe(Schema.minItems(1)),
    };
    const envelopeFields: Schema.Struct.Fields = {
      type: Schema.Literal(
        ExtensionLocalEventLogUpdatedMessageType.NookExtensionLocalEventLogUpdated,
      ),
      payload: Schema.Struct(payloadFields),
    };
    const envelopeSchema = Schema.Struct(envelopeFields);
    const request: RuntimeMessageDecodeRequest<
      ExtensionLocalEventLogUpdatedMessage,
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
    const schemaFields: Schema.Struct.Fields = { type: Schema.String };
    const request: RuntimeMessageDecodeRequest<
      RuntimeMessageEnvelope,
      WireMessage
    > = {
      schema: Schema.Struct(schemaFields),
      value: message,
      kind: RuntimeMessageDecodeFailureKind.RuntimeMessageEnvelope,
    };
    return decodeRuntimeMessage(request);
  }
}

export const ExtensionEventLogRecord = ExtensionEventLogRecordAdmission;
