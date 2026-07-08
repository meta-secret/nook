import { stripBasePath } from '$lib/routes'

export const EXTENSION_CONNECT_PATH = '/extension-connect'

export type ExtensionConnectScope =
  | 'vault-access'
  | 'password-filling'
  | 'sync-provider-credentials'

export type ExtensionConnectRequest = {
  deviceId: string
  devicePublicKey: string
  deviceSigningPublicKey: string
  extensionRuntimeId: string
  deviceLabel: string
  nonce: string
  scopes: ExtensionConnectScope[]
}

const validScopes = new Set<ExtensionConnectScope>([
  'vault-access',
  'password-filling',
  'sync-provider-credentials',
])

export function isExtensionConnectPath(pathname: string): boolean {
  const normalized = stripBasePath(pathname).replace(/\/$/, '') || '/'
  return normalized === EXTENSION_CONNECT_PATH
}

function parseScopes(raw: string | null): ExtensionConnectScope[] {
  const scopes = (raw ?? '')
    .split(',')
    .map((scope) => scope.trim())
    .filter(Boolean)

  return scopes.filter((scope): scope is ExtensionConnectScope =>
    validScopes.has(scope as ExtensionConnectScope),
  )
}

export function extensionConnectRequestFromLocation(
  location: Location,
): ExtensionConnectRequest | undefined {
  if (!isExtensionConnectPath(location.pathname)) return undefined

  const params = new URLSearchParams(location.search)
  const deviceId = params.get('device_id')?.trim() ?? ''
  const devicePublicKey = params.get('device_public_key')?.trim() ?? ''
  const deviceSigningPublicKey =
    params.get('device_signing_public_key')?.trim() ?? ''
  const extensionRuntimeId = params.get('extension_id')?.trim() ?? ''
  const deviceLabel =
    params.get('device_label')?.trim() ??
    'Nook Extension - this browser profile'
  const nonce = params.get('nonce')?.trim() ?? ''
  const scopes = parseScopes(params.get('scopes'))

  if (
    !deviceId ||
    !devicePublicKey ||
    !deviceSigningPublicKey ||
    !extensionRuntimeId ||
    !nonce ||
    scopes.length === 0
  ) {
    return undefined
  }

  return {
    deviceId,
    devicePublicKey,
    deviceSigningPublicKey,
    extensionRuntimeId,
    deviceLabel,
    nonce,
    scopes,
  }
}

export function scopeLabel(scope: ExtensionConnectScope): string {
  if (scope === 'vault-access') return 'Vault access'
  if (scope === 'password-filling') return 'Password filling'
  return 'Sync provider credentials'
}
