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
  PilotAuth = "pilot-auth",
}

type NormalizedCompanionLauncherPayload = {
  readonly intent:
    | OpenCompanionLauncherIntent.Pair
    | OpenCompanionLauncherIntent.PilotAuth;
};

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class OpenCompanionLauncherMessage {
  private constructor() {}
  declare readonly type: OpenCompanionLauncherMessageType.NookOpenCompanionLauncher;
  declare readonly payload?: {
    intent:
      | OpenCompanionLauncherIntent.Pair
      | OpenCompanionLauncherIntent.PilotAuth;
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
        intent: OpenCompanionLauncherMessage.intent(payload),
      })),
    );
  }

  static intent(
    payload: NormalizedCompanionLauncherPayload | undefined,
  ): OpenCompanionLauncherIntent {
    switch (typeof payload) {
      case 'undefined':
        return OpenCompanionLauncherIntent.Default;
      case 'object':
        switch (payload.intent) {
          case OpenCompanionLauncherIntent.Pair:
            return OpenCompanionLauncherIntent.Pair;
          case OpenCompanionLauncherIntent.PilotAuth:
            return OpenCompanionLauncherIntent.PilotAuth;
        }
    }
  }
}

const normalizedCompanionLauncherIntentSchema = Schema.Literal(
  OpenCompanionLauncherIntent.Pair,
  OpenCompanionLauncherIntent.PilotAuth,
);
type NormalizedCompanionLauncherPayloadFields = {
  readonly intent: typeof normalizedCompanionLauncherIntentSchema;
};
const normalizedCompanionLauncherPayloadFields: NormalizedCompanionLauncherPayloadFields =
  {
    intent: normalizedCompanionLauncherIntentSchema,
  };

const normalizedCompanionLauncherTypeSchema = Schema.Literal(
  OpenCompanionLauncherMessageType.NookOpenCompanionLauncher,
);
const normalizedCompanionLauncherPayloadSchema = Schema.Struct(
  normalizedCompanionLauncherPayloadFields,
);
const normalizedCompanionLauncherOptionalPayloadSchema = Schema.optional(
  normalizedCompanionLauncherPayloadSchema,
);
type NormalizedCompanionLauncherMessageFields = {
  readonly type: typeof normalizedCompanionLauncherTypeSchema;
  readonly payload: typeof normalizedCompanionLauncherOptionalPayloadSchema;
};
const normalizedCompanionLauncherMessageFields: NormalizedCompanionLauncherMessageFields =
  {
    type: normalizedCompanionLauncherTypeSchema,
    payload: normalizedCompanionLauncherOptionalPayloadSchema,
  };

const NormalizedOpenCompanionLauncherMessageSchema = Schema.Struct(
  normalizedCompanionLauncherMessageFields,
);
