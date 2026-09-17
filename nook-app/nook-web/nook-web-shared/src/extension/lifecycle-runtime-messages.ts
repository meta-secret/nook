import { Effect, Schema } from "effect";
import {
  decode_extension_event_log_record,
  type ExtensionEventLogRecord as RustExtensionEventLogRecord,
} from "./nook-companion-wasm/nook_companion_wasm.js";
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
    Effect.mapError((cause) =>
      RuntimeMessageDecodeFailure.fromParseError({
        kind: request.kind,
        cause,
      }),
    ),
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
    return decodeRuntimeMessage(
      {
        schema: Schema.Struct({
          type: Schema.Literal(OpenSimpleVaultMessageType.NookOpenSimpleVault),
        }),
        value: message,
        kind: RuntimeMessageDecodeFailureKind.OpenSimpleVault,
      },
    );
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
    return decodeRuntimeMessage(
      {
        schema: Schema.Struct({
          type: Schema.Literal(
            BeginExtensionPairingMessageType.NookBeginExtensionPairing,
          ),
          payload: Schema.Struct({
            deviceId: Schema.String.pipe(Schema.minLength(1)),
            devicePublicKey: Schema.String.pipe(Schema.minLength(1)),
            deviceSigningPublicKey: Schema.String.pipe(Schema.minLength(1)),
            deviceLabel: Schema.String.pipe(Schema.minLength(1)),
          }),
        }),
        value: message,
        kind: RuntimeMessageDecodeFailureKind.BeginExtensionPairing,
      },
    );
  }
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export type ExtensionEventLogRecord = RustExtensionEventLogRecord;
export class ExtensionEventLogRecordAdmission {
  private constructor() {}
  static decode<WireValue>(
    value: WireValue,
  ): Effect.Effect<ExtensionEventLogRecord, RuntimeMessageDecodeFailure> {
    return Effect.try({
      try: () => decode_extension_event_log_record(value),
      catch: (cause) =>
        RuntimeMessageDecodeFailure.fromCause({
          kind: RuntimeMessageDecodeFailureKind.ExtensionEventLogRecord,
          cause,
        }),
    });
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
    const envelopeSchema = Schema.Struct({
      type: Schema.Literal(
        ExtensionLocalEventLogUpdatedMessageType.NookExtensionLocalEventLogUpdated,
      ),
      payload: Schema.Struct({
        vaultStoreId: Schema.String.pipe(Schema.minLength(1)),
        eventLogRecords: Schema.Array(Schema.Unknown).pipe(
          Schema.minItems(1),
        ),
      }),
    });
    return decodeRuntimeMessage(
      {
        schema: envelopeSchema,
        value: message,
        kind: RuntimeMessageDecodeFailureKind.ExtensionLocalEventLogUpdated,
      },
    ).pipe(
      Effect.flatMap(({ type, payload }) =>
        Effect.all(payload.eventLogRecords.map(ExtensionEventLogRecord.decode), {
          concurrency: "unbounded",
        }).pipe(
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
    return decodeRuntimeMessage(
      {
        schema: Schema.Struct({ type: Schema.String }),
        value: message,
        kind: RuntimeMessageDecodeFailureKind.RuntimeMessageEnvelope,
      },
    );
  }
}

export const ExtensionEventLogRecord = ExtensionEventLogRecordAdmission;
