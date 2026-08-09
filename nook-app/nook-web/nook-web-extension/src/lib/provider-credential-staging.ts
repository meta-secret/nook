import type { StorageProvider } from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'

export enum ProviderCredentialStagingKind {
  InvalidInput = 'invalid-input',
  Staged = 'staged',
}

export type ProviderCredentialStaging =
  | { kind: ProviderCredentialStagingKind.InvalidInput }
  | {
      kind: ProviderCredentialStagingKind.Staged
      providers: StorageProvider[]
    }

type ProviderCredentialCandidate = {
  githubPat?: string | { state: string }
  oauthFile?: {
    config?: {
      accessToken?: string | { state: string }
      refreshToken?: string | { state: string }
    }
    accessToken?: string
    refreshToken?: string
  }
}

function isSerializedProviderField(
  value: object | string | number | boolean,
): boolean {
  if (typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isSerializedProviderField)
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) return false
  return Object.values(value).every(isSerializedProviderField)
}

export function scrubProviderCredentials(providers: StorageProvider[]): void {
  const candidates = providers as ProviderCredentialCandidate[]
  for (const provider of candidates) {
    if (!provider || typeof provider !== 'object') continue
    if (typeof provider.githubPat === 'string') {
      delete provider.githubPat
    } else if ('githubPat' in provider) {
      provider.githubPat = { state: 'missing' }
    }
    if (provider.oauthFile && typeof provider.oauthFile === 'object') {
      if (provider.oauthFile.config) {
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

export type ProviderCredentialCleanupArgs<Result> = {
  providers: StorageProvider[]
  operation: () => Promise<Result>
}

export async function runWithProviderCredentialCleanup<Result>(
  args: ProviderCredentialCleanupArgs<Result>,
): Promise<Result> {
  try {
    return await args.operation()
  } finally {
    scrubProviderCredentials(args.providers)
  }
}

export type StageProviderCredentialsArgs = {
  providers: StorageProvider[]
  decode: (providers: object) => Promise<StorageProvider[]>
}

export async function stageProviderCredentials(
  args: StageProviderCredentialsArgs,
): Promise<ProviderCredentialStaging> {
  if (!args.providers.every(isSerializedProviderField)) {
    return { kind: ProviderCredentialStagingKind.InvalidInput }
  }
  const staged = structuredClone(args.providers)
  try {
    const providers = await args.decode(staged)
    return { kind: ProviderCredentialStagingKind.Staged, providers }
  } catch {
    return { kind: ProviderCredentialStagingKind.InvalidInput }
  } finally {
    scrubProviderCredentials(staged)
  }
}
