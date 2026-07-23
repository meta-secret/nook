type UnknownRecord = Record<string, unknown>

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
    if ('githubPat' in provider) provider.githubPat = undefined
    if (isRecord(provider.oauthFile)) {
      provider.oauthFile.accessToken = ''
      if ('refreshToken' in provider.oauthFile) {
        provider.oauthFile.refreshToken = undefined
      }
    }
  }
}

export function stageProviderCredentials(
  providers: unknown,
): unknown[] | undefined {
  if (!Array.isArray(providers)) return undefined
  const staged = providers.map(cloneProvider)
  scrubProviderCredentials(providers)
  return staged
}
