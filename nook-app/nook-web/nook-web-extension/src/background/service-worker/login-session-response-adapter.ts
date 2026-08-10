import {
  type WebsiteLoginFillResponse,
  isWebsiteLoginFillResponse,
} from '../../lib/login-fill-messages'

export function decodeWebsiteLoginFillResponse(
  response: unknown,
): WebsiteLoginFillResponse {
  if (
    response &&
    typeof response === 'object' &&
    isWebsiteLoginFillResponse(response)
  ) {
    return response
  }
  return { ok: false, reason: 'login-fill-session-invalid' }
}
