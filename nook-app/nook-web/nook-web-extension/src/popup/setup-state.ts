export type ExtensionConsentScope =
  | 'vault-access'
  | 'password-filling'
  | 'sync-provider-credentials'

export type ExtensionSetupState =
  | { status: 'not-set-up'; deviceLabel: string }
  | { status: 'protecting'; deviceLabel: string }
  | {
      status: 'pairing'
      deviceLabel: string
      deviceId: string
      devicePublicKey: string
      deviceSigningPublicKey: string
      requestNonce: string
      requestUrl: string
      requestedScopes: ExtensionConsentScope[]
    }
  | {
      status: 'pairing-failed'
      deviceLabel: string
      message: string
    }
  | {
      status: 'locked'
      deviceLabel: string
      pairedVaults: string[]
      selectedVaultName?: string | undefined
    }
  | {
      status: 'ready'
      deviceLabel: string
      pairedVaults: string[]
      selectedVaultName?: string | undefined
      syncProviderCount: number
    }
  | {
      status: 'revoked'
      deviceLabel: string
      message: string
    }

export type NormalizedExtensionSetupState = {
  state: ExtensionSetupState
  migrated: boolean
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isConsentScope(value: unknown): value is ExtensionConsentScope {
  return (
    value === 'vault-access' ||
    value === 'password-filling' ||
    value === 'sync-provider-credentials'
  )
}

function isConsentScopeArray(value: unknown): value is ExtensionConsentScope[] {
  return Array.isArray(value) && value.every(isConsentScope)
}

function selectedVaultName(candidate: Record<string, unknown>) {
  return typeof candidate.selectedVaultName === 'string'
    ? candidate.selectedVaultName
    : undefined
}

function legacySyncProviderCount(syncStatus: string): number {
  const match = /^(\d+) sync providers? granted$/i.exec(syncStatus.trim())
  return match ? Number(match[1]) : 0
}

export function normalizeExtensionSetupState(
  value: unknown,
): NormalizedExtensionSetupState | undefined {
  if (typeof value !== 'object' || !value || !('status' in value)) {
    return undefined
  }

  const candidate = value as Record<string, unknown>
  if (typeof candidate.deviceLabel !== 'string') return undefined
  const deviceLabel = candidate.deviceLabel

  if (candidate.status === 'not-set-up' || candidate.status === 'protecting') {
    return { state: { status: candidate.status, deviceLabel }, migrated: false }
  }

  if (
    candidate.status === 'pairing' &&
    typeof candidate.deviceId === 'string' &&
    typeof candidate.devicePublicKey === 'string' &&
    typeof candidate.deviceSigningPublicKey === 'string' &&
    typeof candidate.requestNonce === 'string' &&
    typeof candidate.requestUrl === 'string' &&
    isConsentScopeArray(candidate.requestedScopes)
  ) {
    return {
      state: {
        status: 'pairing',
        deviceLabel,
        deviceId: candidate.deviceId,
        devicePublicKey: candidate.devicePublicKey,
        deviceSigningPublicKey: candidate.deviceSigningPublicKey,
        requestNonce: candidate.requestNonce,
        requestUrl: candidate.requestUrl,
        requestedScopes: candidate.requestedScopes,
      },
      migrated: false,
    }
  }

  if (
    (candidate.status === 'pairing-failed' || candidate.status === 'revoked') &&
    typeof candidate.message === 'string'
  ) {
    return {
      state: {
        status: candidate.status,
        deviceLabel,
        message: candidate.message,
      },
      migrated: false,
    }
  }

  if (candidate.status === 'locked' && isStringArray(candidate.pairedVaults)) {
    return {
      state: {
        status: 'locked',
        deviceLabel,
        pairedVaults: candidate.pairedVaults,
        selectedVaultName: selectedVaultName(candidate),
      },
      migrated: false,
    }
  }

  if (candidate.status === 'ready' && isStringArray(candidate.pairedVaults)) {
    if (
      typeof candidate.syncProviderCount === 'number' &&
      Number.isSafeInteger(candidate.syncProviderCount) &&
      candidate.syncProviderCount >= 0
    ) {
      return {
        state: {
          status: 'ready',
          deviceLabel,
          pairedVaults: candidate.pairedVaults,
          selectedVaultName: selectedVaultName(candidate),
          syncProviderCount: candidate.syncProviderCount,
        },
        migrated: false,
      }
    }
    if (typeof candidate.syncStatus === 'string') {
      return {
        state: {
          status: 'ready',
          deviceLabel,
          pairedVaults: candidate.pairedVaults,
          selectedVaultName: selectedVaultName(candidate),
          syncProviderCount: legacySyncProviderCount(candidate.syncStatus),
        },
        migrated: true,
      }
    }
  }

  return undefined
}
