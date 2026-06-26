import {
  consumeOAuthReturnPath,
  exchangeGoogleAuthCode,
  isGoogleOAuthCallbackPath,
  readOAuthCallbackParams,
  readPkceReturnPath,
} from '$lib/google-oauth'

export async function handleGoogleOAuthCallbackIfPresent(): Promise<boolean> {
  if (typeof window === 'undefined') {
    return false
  }
  if (!isGoogleOAuthCallbackPath(window.location.pathname)) {
    return false
  }

  const { code, state, error } = readOAuthCallbackParams(window.location.search)
  const returnTo =
    (state ? readPkceReturnPath(state) : null) ?? consumeOAuthReturnPath()

  if (window.opener && !window.opener.closed) {
    window.opener.postMessage(
      {
        type: 'nook-google-oauth',
        code,
        state,
        error,
        returnTo,
      },
      window.location.origin,
    )
    window.close()
    return true
  }

  if (error) {
    sessionStorage.setItem('nook_google_oauth_error', error)
    window.location.replace(returnTo)
    return true
  }

  if (!code || !state) {
    sessionStorage.setItem(
      'nook_google_oauth_error',
      'Google sign-in was cancelled.',
    )
    window.location.replace(returnTo)
    return true
  }

  try {
    const tokens = await exchangeGoogleAuthCode(code, state)
    sessionStorage.setItem('nook_google_oauth_tokens', JSON.stringify(tokens))
  } catch (callbackError) {
    sessionStorage.setItem(
      'nook_google_oauth_error',
      callbackError instanceof Error
        ? callbackError.message
        : 'Google sign-in failed.',
    )
  }
  window.location.replace(returnTo)
  return true
}

export function readPendingGoogleOAuthTokens():
  | import('$lib/google-oauth').GoogleOAuthTokens
  | null {
  const raw = sessionStorage.getItem('nook_google_oauth_tokens')
  sessionStorage.removeItem('nook_google_oauth_tokens')
  if (!raw) return null
  try {
    return JSON.parse(raw) as import('$lib/google-oauth').GoogleOAuthTokens
  } catch {
    return null
  }
}

export function readPendingGoogleOAuthError(): string | null {
  const message = sessionStorage.getItem('nook_google_oauth_error')
  sessionStorage.removeItem('nook_google_oauth_error')
  return message
}
