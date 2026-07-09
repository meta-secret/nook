export type BrowserOAuthProvider = 'google-drive' | 'icloud'

export type OAuthOriginSupport = {
  supported: boolean
  origin: string
  reason?: 'cloudflare-pr-preview' | 'unregistered-origin'
}

type BrowserLocation = Pick<Location, 'origin' | 'hostname'>

const GOOGLE_AUTHORIZED_ORIGINS = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'https://nokey.sh',
  'https://dev.nokey.sh',
])
const ICLOUD_AUTHORIZED_ORIGINS = new Set([
  'https://nokey.sh',
  'https://dev.nokey.sh',
])
const CLOUDFLARE_PR_PREVIEW_HOST = /^pr-\d+\.nook-1n8\.pages\.dev$/i

function currentLocation(): BrowserLocation | undefined {
  return typeof window === 'undefined' ? undefined : window.location
}

function isAuthorizedOrigin(
  provider: BrowserOAuthProvider,
  origin: string,
): boolean {
  const origins =
    provider === 'icloud'
      ? ICLOUD_AUTHORIZED_ORIGINS
      : GOOGLE_AUTHORIZED_ORIGINS
  return origins.has(origin)
}

export function isCloudflarePrPreviewHost(hostname: string): boolean {
  return CLOUDFLARE_PR_PREVIEW_HOST.test(hostname)
}

export function resolveOAuthOriginSupport(
  provider: BrowserOAuthProvider,
  location: BrowserLocation | undefined = currentLocation(),
): OAuthOriginSupport {
  if (!location) {
    return { supported: true, origin: '' }
  }

  const origin = location.origin
  if (isAuthorizedOrigin(provider, origin)) {
    return { supported: true, origin }
  }

  return {
    supported: false,
    origin,
    reason: isCloudflarePrPreviewHost(location.hostname)
      ? 'cloudflare-pr-preview'
      : 'unregistered-origin',
  }
}
