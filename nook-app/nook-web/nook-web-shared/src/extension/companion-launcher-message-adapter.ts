import {
  OpenCompanionLauncherIntent,
  OpenCompanionLauncherMessageType,
  type OpenCompanionLauncherMessage,
  type NormalizedOpenCompanionLauncherMessage,
} from './companion-launcher-message'

export enum OpenCompanionLauncherNormalizationKind {
  NotLauncher = 'not-launcher',
  Normalized = 'normalized',
}

export type OpenCompanionLauncherNormalization =
  | { kind: OpenCompanionLauncherNormalizationKind.NotLauncher }
  | {
      kind: OpenCompanionLauncherNormalizationKind.Normalized
      message: NormalizedOpenCompanionLauncherMessage
    }

export function normalizeOpenCompanionLauncherMessage(
  message: unknown,
): OpenCompanionLauncherNormalization {
  if (
    !message ||
    typeof message !== 'object' ||
    !('type' in message) ||
    message.type !== OpenCompanionLauncherMessageType.NookOpenCompanionLauncher
  ) {
    return { kind: OpenCompanionLauncherNormalizationKind.NotLauncher }
  }
  if (!('payload' in message)) {
    return {
      kind: OpenCompanionLauncherNormalizationKind.Normalized,
      message: {
        type: OpenCompanionLauncherMessageType.NookOpenCompanionLauncher,
        intent: OpenCompanionLauncherIntent.Default,
      },
    }
  }
  const payload = message.payload
  if (
    !payload ||
    typeof payload !== 'object' ||
    !('intent' in payload) ||
    payload.intent !== OpenCompanionLauncherIntent.Pair
  ) {
    return { kind: OpenCompanionLauncherNormalizationKind.NotLauncher }
  }
  return {
    kind: OpenCompanionLauncherNormalizationKind.Normalized,
    message: {
      type: OpenCompanionLauncherMessageType.NookOpenCompanionLauncher,
      intent: OpenCompanionLauncherIntent.Pair,
    },
  }
}

export function isOpenCompanionLauncherMessage(
  message: unknown,
): message is OpenCompanionLauncherMessage {
  return (
    normalizeOpenCompanionLauncherMessage(message).kind ===
    OpenCompanionLauncherNormalizationKind.Normalized
  )
}
