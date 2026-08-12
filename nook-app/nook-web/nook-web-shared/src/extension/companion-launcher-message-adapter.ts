import {
  OpenCompanionLauncherMessageType,
  type OpenCompanionLauncherMessage,
} from './companion-launcher-message'

export function isOpenCompanionLauncherMessage(
  message: unknown,
): message is OpenCompanionLauncherMessage {
  if (
    !message ||
    typeof message !== 'object' ||
    !('type' in message) ||
    message.type !== OpenCompanionLauncherMessageType.NookOpenCompanionLauncher
  ) {
    return false
  }
  if (!('payload' in message)) return true
  const payload = message.payload
  return (
    !!payload &&
    typeof payload === 'object' &&
    'intent' in payload &&
    payload.intent === 'pair'
  )
}
