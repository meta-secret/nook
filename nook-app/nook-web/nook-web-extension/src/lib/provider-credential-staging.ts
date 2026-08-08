import {
  isExternalValue,
  type ExternalValue,
  type ExternalValueCandidate,
} from './external-value'

export enum ProviderCredentialStagingKind {
  InvalidInput = 'invalid-input',
  Staged = 'staged',
}

export type ProviderCredentialStaging =
  | { kind: ProviderCredentialStagingKind.InvalidInput }
  | {
      kind: ProviderCredentialStagingKind.Staged
      providers: MutableExternalValue[]
    }

export type MutableExternalValue =
  | string
  | number
  | boolean
  | MutableExternalValue[]
  | MutableExternalObject

export interface MutableExternalObject {
  [key: string]: MutableExternalValue
}

function isRecord(value: MutableExternalValue): value is MutableExternalObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isGithubPat(value: MutableExternalValue): boolean {
  return (
    isRecord(value) &&
    (value.state === 'missing' ||
      (value.state === 'token' && typeof value.value === 'string'))
  )
}

function isGithubRepository(value: MutableExternalValue): boolean {
  return (
    isRecord(value) &&
    (value.state === 'defaultRepository' ||
      (value.state === 'repository' && typeof value.value === 'string'))
  )
}

function isOAuthFile(value: MutableExternalValue): boolean {
  return (
    isRecord(value) &&
    (value.state === 'notApplicable' ||
      (value.state === 'configured' && isRecord(value.config)))
  )
}

function isLocalFolder(value: MutableExternalValue): boolean {
  return (
    isRecord(value) &&
    (value.state === 'notApplicable' ||
      (value.state === 'configured' && isRecord(value.config)))
  )
}

function isProviderVaultScope(value: MutableExternalValue): boolean {
  return (
    isRecord(value) &&
    (value.state === 'unscoped' ||
      (value.state === 'storeId' && typeof value.value === 'string'))
  )
}

function isProviderSyncCheckpoint(value: MutableExternalValue): boolean {
  return (
    isRecord(value) &&
    (value.state === 'neverSynced' ||
      (value.state === 'synced' &&
        isRecord(value.version) &&
        typeof value.syncedAt === 'string' &&
        isRecord(value.revision) &&
        typeof value.commonContentHash === 'string'))
  )
}

function isStorageProvider(value: MutableExternalValue): boolean {
  if (!isRecord(value)) return false
  return (
    typeof value.id === 'string' &&
    (value.type === 'local' ||
      value.type === 'local-folder' ||
      value.type === 'github' ||
      value.type === 'oauth-file') &&
    typeof value.label === 'string' &&
    typeof value.createdAt === 'string' &&
    isGithubPat(value.githubPat) &&
    isGithubRepository(value.githubRepo) &&
    isOAuthFile(value.oauthFile) &&
    isLocalFolder(value.localFolder) &&
    isProviderVaultScope(value.storeId) &&
    isProviderSyncCheckpoint(value.syncCheckpoint)
  )
}

export function isStorageProviderCollection(
  providers: readonly MutableExternalValue[],
): boolean {
  return providers.every(isStorageProvider)
}

function cloneExternalValue(value: ExternalValue): MutableExternalValue {
  if (Array.isArray(value)) {
    return value.map(cloneExternalValue)
  }
  if (!value || typeof value !== 'object') return value
  const entries: [string, MutableExternalValue][] = []
  for (const [key, child] of Object.entries(value)) {
    entries.push([key, cloneExternalValue(child)])
  }
  return Object.fromEntries(entries)
}

function isExternalValueArray(
  value: ExternalValueCandidate,
): value is readonly ExternalValue[] {
  return Array.isArray(value) && value.every(isExternalValue)
}

export function scrubProviderCredentials(
  providers: MutableExternalValue,
): void {
  if (!Array.isArray(providers)) return
  for (const provider of providers) {
    if (!isRecord(provider)) continue
    if (typeof provider.githubPat === 'string') {
      delete provider.githubPat
    } else if ('githubPat' in provider) {
      provider.githubPat = { state: 'missing' }
    }
    if (isRecord(provider.oauthFile)) {
      if (isRecord(provider.oauthFile.config)) {
        provider.oauthFile.config.accessToken = { state: 'signedOut' }
        provider.oauthFile.config.refreshToken = { state: 'notIssued' }
      }
      if (typeof provider.oauthFile.accessToken === 'string') {
        provider.oauthFile.accessToken = ''
      }
      if ('refreshToken' in provider.oauthFile) {
        delete provider.oauthFile.refreshToken
      }
    }
  }
}

export function stageProviderCredentials(
  providers: ExternalValueCandidate,
): ProviderCredentialStaging {
  if (!isExternalValueArray(providers)) {
    return { kind: ProviderCredentialStagingKind.InvalidInput }
  }
  const staged = providers.map(cloneExternalValue)
  return { kind: ProviderCredentialStagingKind.Staged, providers: staged }
}
