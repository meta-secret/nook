import {
  isExternalValue,
  type ExternalObject,
  type ExternalValue,
  type ExternalValueCandidate,
} from './external-value'

export enum ProviderCredentialStagingKind {
  InvalidInput = 'invalid-input',
  Staged = 'staged',
}

export type ProviderCredentialStaging =
  | { kind: ProviderCredentialStagingKind.InvalidInput }
  | { kind: ProviderCredentialStagingKind.Staged; providers: ExternalValue[] }

function isRecord(value: ExternalValue): value is ExternalObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function cloneProvider(provider: ExternalValue): ExternalValue {
  if (!isRecord(provider)) return provider
  const clone = { ...provider }
  if (isRecord(provider.oauthFile)) {
    clone.oauthFile = {
      ...provider.oauthFile,
      ...(isRecord(provider.oauthFile.config)
        ? { config: { ...provider.oauthFile.config } }
        : {}),
    }
  }
  return clone
}

function isExternalValueArray(
  value: ExternalValueCandidate,
): value is ExternalValue[] {
  return Array.isArray(value) && value.every(isExternalValue)
}

export function scrubProviderCredentials(providers: ExternalValue): void {
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
  const staged = providers.map(cloneProvider)
  scrubProviderCredentials(providers)
  return { kind: ProviderCredentialStagingKind.Staged, providers: staged }
}
