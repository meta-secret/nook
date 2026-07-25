export type QueryActiveTabLoginDetectionMessage = {
  type: 'nook:query-active-tab-login-detection'
}

export type QueryLoginDetectionMessage = {
  type: 'nook:query-login-detection'
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
    message.type === 'nook:query-active-tab-login-detection'
  )
}

export function isQueryLoginDetectionMessage(
  message: unknown,
): message is QueryLoginDetectionMessage {
  return (
    !!message &&
    typeof message === 'object' &&
    'type' in message &&
    message.type === 'nook:query-login-detection'
  )
}
