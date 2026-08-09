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

export enum LoginDetectionStatus {
  Detected = 'detected',
  NotDetected = 'not-detected',
  Unavailable = 'unavailable',
}

export type LoginDetectionResponse = {
  ok: true
  status: LoginDetectionStatus
}

export function isQueryActiveTabLoginDetectionMessage(
  message: object,
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
  message: object,
): message is QueryLoginDetectionMessage {
  return (
    !!message &&
    typeof message === 'object' &&
    'type' in message &&
    message.type === QueryLoginDetectionMessageType.NookQueryLoginDetection
  )
}
