import {
  isExternalValue,
  type ExternalValue,
  type ExternalValueCandidate,
} from './external-value'
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

type MutableExternalValue =
  | string
  | number
  | boolean
  | MutableExternalValue[]
  | MutableExternalObject

interface MutableExternalObject {
  [key: string]: MutableExternalValue
}

function isRecord(value: MutableExternalValue): value is MutableExternalObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
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

export function scrubProviderCredentials(providers: object): void {
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

export type ProviderCredentialCleanupArgs<Result> = {
  providers: object
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
  providers: ExternalValueCandidate
  decode: (providers: object) => Promise<StorageProvider[]>
}

export async function stageProviderCredentials(
  args: StageProviderCredentialsArgs,
): Promise<ProviderCredentialStaging> {
  if (!isExternalValueArray(args.providers)) {
    return { kind: ProviderCredentialStagingKind.InvalidInput }
  }
  const staged = args.providers.map(cloneExternalValue)
  try {
    const providers = await args.decode(staged)
    return { kind: ProviderCredentialStagingKind.Staged, providers }
  } catch {
    return { kind: ProviderCredentialStagingKind.InvalidInput }
  } finally {
    scrubProviderCredentials(staged)
  }
}
