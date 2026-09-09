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
  static is(message: unknown): message is OpenCompanionLauncherMessage {
    return (
      NormalizedOpenCompanionLauncherMessage.normalizeOpenCompanionLauncherMessage(
        message,
      ).kind === OpenCompanionLauncherNormalizationKind.Normalized
    );
  }
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class NormalizedOpenCompanionLauncherMessage {
  private constructor() {}
  declare readonly type: OpenCompanionLauncherMessageType.NookOpenCompanionLauncher;
  declare readonly intent: OpenCompanionLauncherIntent;
  static normalizeOpenCompanionLauncherMessage(
    message: unknown,
  ): OpenCompanionLauncherNormalization {
    if (
      !message ||
      typeof message !== "object" ||
      !("type" in message) ||
      message.type !==
        OpenCompanionLauncherMessageType.NookOpenCompanionLauncher
    ) {
      return { kind: OpenCompanionLauncherNormalizationKind.NotLauncher };
    }
    if (!("payload" in message)) {
      return {
        kind: OpenCompanionLauncherNormalizationKind.Normalized,
        message: {
          type: OpenCompanionLauncherMessageType.NookOpenCompanionLauncher,
          intent: OpenCompanionLauncherIntent.Default,
        },
      };
    }
    const payload = message.payload;
    if (
      !payload ||
      typeof payload !== "object" ||
      !("intent" in payload) ||
      payload.intent !== OpenCompanionLauncherIntent.Pair
    ) {
      return { kind: OpenCompanionLauncherNormalizationKind.NotLauncher };
    }
    return {
      kind: OpenCompanionLauncherNormalizationKind.Normalized,
      message: {
        type: OpenCompanionLauncherMessageType.NookOpenCompanionLauncher,
        intent: OpenCompanionLauncherIntent.Pair,
      },
    };
  }
}

export enum OpenCompanionLauncherNormalizationKind {
  NotLauncher = "not-launcher",
  Normalized = "normalized",
}

export type OpenCompanionLauncherNormalization =
  | { kind: OpenCompanionLauncherNormalizationKind.NotLauncher }
  | {
      kind: OpenCompanionLauncherNormalizationKind.Normalized;
      message: NormalizedOpenCompanionLauncherMessage;
    };
