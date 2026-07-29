export enum QueryActiveTabLoginDetectionMessageType {
  NookQueryActiveTabLoginDetection = 'nook:query-active-tab-login-detection',
}

export type QueryActiveTabLoginDetectionMessage = {
  type: QueryActiveTabLoginDetectionMessageType.NookQueryActiveTabLoginDetection
}

export enum QueryLoginDetectionMessageType {
  NookQueryLoginDetection = 'nook:query-login-detection',
}

export type QueryLoginDetectionMessage = {
  type: QueryLoginDetectionMessageType.NookQueryLoginDetection
}

export type LoginDetectionStatus = 'detected' | 'not-detected' | 'unavailable'

export type LoginDetectionResponse = {
  ok: true
  status: LoginDetectionStatus
}

export function isQueryActiveTabLoginDetectionMessage(
  message: unknown,
): message is QueryActiveTabLoginDetectionMessage {
  return (
    !!message &&
    typeof message === 'object' &&
    'type' in message &&
    message.type ===
      QueryActiveTabLoginDetectionMessageType.NookQueryActiveTabLoginDetection
  )
}

export function isQueryLoginDetectionMessage(
  message: unknown,
): message is QueryLoginDetectionMessage {
  return (
    !!message &&
    typeof message === 'object' &&
    'type' in message &&
    message.type === QueryLoginDetectionMessageType.NookQueryLoginDetection
  )
}
