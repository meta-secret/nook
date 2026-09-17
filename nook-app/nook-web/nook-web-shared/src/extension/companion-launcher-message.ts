import { Effect, Schema } from "effect";

import {
  RuntimeMessageDecodeFailure,
  RuntimeMessageDecodeFailureKind,
} from "./runtime-message-decode-failure";

export enum OpenCompanionLauncherMessageType {
  NookOpenCompanionLauncher = "nook:open-companion-launcher",
}

export enum OpenCompanionLauncherIntent {
  Default = "default",
  Pair = "pair",
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class OpenCompanionLauncherMessage {
  private constructor() {}
  declare readonly type: OpenCompanionLauncherMessageType.NookOpenCompanionLauncher;
  declare readonly payload?: {
    intent: OpenCompanionLauncherIntent.Pair;
  };
  static decode<WireMessage>(
    message: WireMessage,
  ): Effect.Effect<
    NormalizedOpenCompanionLauncherMessage,
    RuntimeMessageDecodeFailure
  > {
    return NormalizedOpenCompanionLauncherMessage.decode(message);
  }
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class NormalizedOpenCompanionLauncherMessage {
  private constructor() {}
  declare readonly type: OpenCompanionLauncherMessageType.NookOpenCompanionLauncher;
  declare readonly intent: OpenCompanionLauncherIntent;

  static decode<WireMessage>(
    message: WireMessage,
  ): Effect.Effect<
    NormalizedOpenCompanionLauncherMessage,
    RuntimeMessageDecodeFailure
  > {
    return Schema.decodeUnknown(NormalizedOpenCompanionLauncherMessageSchema)(
      message,
    ).pipe(
      Effect.mapError((cause) => {
        const failureRequest: Parameters<
          typeof RuntimeMessageDecodeFailure.fromParseError
        >[0] = {
          kind: RuntimeMessageDecodeFailureKind.OpenCompanionLauncher,
          cause,
        };
        return RuntimeMessageDecodeFailure.fromParseError(failureRequest);
      }),
      Effect.map(({ type, payload }) => ({
        type,
        intent:
          payload?.intent === OpenCompanionLauncherIntent.Pair
            ? OpenCompanionLauncherIntent.Pair
            : OpenCompanionLauncherIntent.Default,
      })),
    );
  }
}

const intentSchema = Schema.Literal(OpenCompanionLauncherIntent.Pair);
const OpenCompanionLauncherPayloadFields: {
  readonly intent: typeof intentSchema;
} = { intent: intentSchema };
const typeSchema = Schema.Literal(
  OpenCompanionLauncherMessageType.NookOpenCompanionLauncher,
);
const payloadSchema = Schema.optional(
  Schema.Struct(OpenCompanionLauncherPayloadFields),
);
const NormalizedOpenCompanionLauncherMessageFields: {
  readonly type: typeof typeSchema;
  readonly payload: typeof payloadSchema;
} = {
  type: typeSchema,
  payload: payloadSchema,
};
const NormalizedOpenCompanionLauncherMessageSchema = Schema.Struct(
  NormalizedOpenCompanionLauncherMessageFields,
);
