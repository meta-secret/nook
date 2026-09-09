import type { StorageProvider } from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import type { ExtensionStorageProviderPayload } from '../../../nook-web-shared/src/extension/runtime-messages'

export type SerializedStorageProvider =
  StorageProvider | ExtensionStorageProviderPayload
export type SerializedExtensionStorageProviders = SerializedStorageProvider[]
export type DecodedExtensionStorageProviders = StorageProvider[]
export type ExtensionStorageProviderIdentities =
  ExtensionStorageProviderPayload[]

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

export type ProviderCredentialCleanupArgs<Result> = {
  providers: StorageProvider[]
  operation: () => Promise<Result>
}

export type StageProviderCredentialsArgs = {
  providers: SerializedExtensionStorageProviders
  decode: (
    providers: SerializedExtensionStorageProviders,
  ) => Promise<DecodedExtensionStorageProviders>
}

export class ProviderCredentialBuffer {
  constructor(
    private readonly providers: SerializedExtensionStorageProviders,
  ) {}
  identities(): ExtensionStorageProviderIdentities {
    const providers = this.providers
    return providers.map((provider) => ({
      id: provider.id,
      type: provider.type,
    }))
  }
  private static isSerializedProviderField(value: unknown): boolean {
    if (typeof value === 'string' || typeof value === 'boolean') return true
    if (typeof value === 'number') return Number.isFinite(value)
    if (Array.isArray(value))
      return value.every(ProviderCredentialBuffer.isSerializedProviderField)
    if (!value || Object.getPrototypeOf(value) !== Object.prototype)
      return false
    return Object.values(value).every(
      ProviderCredentialBuffer.isSerializedProviderField,
    )
  }
  clear(): void {
    const providers = this.providers
    const candidates = providers as ProviderCredentialCandidate[]
    for (const provider of candidates) {
      if (!provider || typeof provider !== 'object') continue
      if (typeof provider.githubPat === 'string') {
        delete provider.githubPat
      } else if ('githubPat' in provider) {
        provider.githubPat = { state: 'missing' }
      }
      if (provider.oauthFile && typeof provider.oauthFile === 'object') {
        const config = provider.oauthFile.config
        if (config && typeof config === 'object' && !Array.isArray(config)) {
          config.accessToken = { state: 'signedOut' }
          config.refreshToken = { state: 'notIssued' }
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
  static async runWithCleanup<Result>(
    args: ProviderCredentialCleanupArgs<Result>,
  ): Promise<Result> {
    try {
      return await args.operation()
    } finally {
      new ProviderCredentialBuffer(args.providers).clear()
    }
  }
  static async stage(
    args: StageProviderCredentialsArgs,
  ): Promise<ProviderCredentialStaging> {
    if (
      !args.providers.every(ProviderCredentialBuffer.isSerializedProviderField)
    ) {
      return { kind: ProviderCredentialStagingKind.InvalidInput }
    }
    const staged = structuredClone(args.providers)
    try {
      const providers = await args.decode(staged)
      return { kind: ProviderCredentialStagingKind.Staged, providers }
    } catch {
      return { kind: ProviderCredentialStagingKind.InvalidInput }
    } finally {
      new ProviderCredentialBuffer(staged).clear()
    }
  }
}
