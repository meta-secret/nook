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
      Effect.mapError((cause) =>
        RuntimeMessageDecodeFailure.fromParseError({
          kind: RuntimeMessageDecodeFailureKind.OpenCompanionLauncher,
          cause,
        }),
      ),
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

const NormalizedOpenCompanionLauncherMessageSchema = Schema.Struct({
  type: Schema.Literal(
    OpenCompanionLauncherMessageType.NookOpenCompanionLauncher,
  ),
  payload: Schema.optional(
    Schema.Struct({
      intent: Schema.Literal(OpenCompanionLauncherIntent.Pair),
    }),
  ),
});
