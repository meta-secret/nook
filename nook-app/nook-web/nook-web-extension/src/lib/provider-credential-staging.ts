import type { StorageProvider } from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import { ExtensionStorageProviderPayload } from '../../../nook-web-shared/src/extension/runtime-messages'

/** Untrusted browser transport, admitted before stored-provider use. */
export type SerializedStorageProvider = unknown
export type SerializedExtensionStorageProviders = SerializedStorageProvider[]
export type DecodedExtensionStorageProviders = StorageProvider[]
export type ExtensionStorageProviderIdentities = ExtensionStorageProviderPayload[]

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

export type ProviderCredentialCleanupArgs<Result> = {
  providers: SerializedExtensionStorageProviders
  operation: () => Promise<Result>
}

export type StageProviderCredentialsArgs = {
  providers: SerializedExtensionStorageProviders
  decode: (
    providers: SerializedExtensionStorageProviders,
  ) => Promise<DecodedExtensionStorageProviders>
}

export class ProviderCredentialBuffer {
  constructor(private readonly providers: SerializedExtensionStorageProviders) {}
  identities(): ExtensionStorageProviderIdentities {
    const providers = this.providers
    return providers.map((provider) => {
      if (!ExtensionStorageProviderPayload.is(provider))
        throw new Error('Invalid provider identity.')
      return { id: provider.id, type: provider.type }
    })
  }
  private static isSerializedProviderField(value: unknown): boolean {
    if (typeof value === 'string' || typeof value === 'boolean') return true
    if (typeof value === 'number') return Number.isFinite(value)
    if (Array.isArray(value))
      return value.every(ProviderCredentialBuffer.isSerializedProviderField)
    if (!value || Object.getPrototypeOf(value) !== Object.prototype) return false
    return Object.values(value).every(
      ProviderCredentialBuffer.isSerializedProviderField,
    )
  }
  clear(): void {
    const providers = this.providers
    for (const provider of providers) {
      if (!provider || typeof provider !== 'object') continue
      if ('githubPat' in provider) {
        if (typeof provider.githubPat === 'string') delete provider.githubPat
        else provider.githubPat = { state: 'missing' }
      }
      if (
        'oauthFile' in provider &&
        provider.oauthFile &&
        typeof provider.oauthFile === 'object'
      ) {
        const oauth = provider.oauthFile
        if ('config' in oauth && oauth.config && typeof oauth.config === 'object') {
          if ('accessToken' in oauth.config)
            oauth.config.accessToken = { state: 'signedOut' }
          if ('refreshToken' in oauth.config)
            oauth.config.refreshToken = { state: 'notIssued' }
        }
        if ('accessToken' in oauth && typeof oauth.accessToken === 'string')
          oauth.accessToken = ''
        if ('refreshToken' in oauth) delete oauth.refreshToken
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
    if (!args.providers.every(ProviderCredentialBuffer.isSerializedProviderField)) {
      return { kind: ProviderCredentialStagingKind.InvalidInput }
    }
    try {
      const staged = structuredClone(args.providers)
      try {
        const providers = await args.decode(staged)
        return { kind: ProviderCredentialStagingKind.Staged, providers }
      } finally {
        new ProviderCredentialBuffer(staged).clear()
      }
    } catch {
      return { kind: ProviderCredentialStagingKind.InvalidInput }
    }
  }
}
