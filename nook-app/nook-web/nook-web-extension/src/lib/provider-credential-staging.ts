type UnknownRecord = Record<string, unknown>

export enum ProviderCredentialStagingKind {
  InvalidInput = 'invalid-input',
  Staged = 'staged',
}

export type ProviderCredentialStaging =
  | { kind: ProviderCredentialStagingKind.InvalidInput }
  | { kind: ProviderCredentialStagingKind.Staged; providers: unknown[] }

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function cloneProvider(provider: unknown): unknown {
  if (!isRecord(provider)) return provider
  const clone = { ...provider }
  if (isRecord(provider.oauthFile)) {
    clone.oauthFile = { ...provider.oauthFile }
  }
  return clone
}

export function scrubProviderCredentials(providers: unknown): void {
  if (!Array.isArray(providers)) return
  for (const provider of providers) {
    if (!isRecord(provider)) continue
    if ('githubPat' in provider) delete provider.githubPat
    if (isRecord(provider.oauthFile)) {
      provider.oauthFile.accessToken = ''
      if ('refreshToken' in provider.oauthFile) {
        delete provider.oauthFile.refreshToken
      }
    }
  }
}

export function stageProviderCredentials(
  providers: unknown,
): ProviderCredentialStaging {
  if (!Array.isArray(providers)) {
    return { kind: ProviderCredentialStagingKind.InvalidInput }
  }
  const staged = providers.map(cloneProvider)
  scrubProviderCredentials(providers)
  return { kind: ProviderCredentialStagingKind.Staged, providers: staged }
}
