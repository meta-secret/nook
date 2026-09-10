import { err, ok, type Result } from 'neverthrow'
import type { StorageProvider } from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import { ExtensionStorageProviderPayload } from '../../../nook-web-shared/src/extension/runtime-messages'

/** Untrusted browser transport, admitted before stored-provider use. */
export type SerializedStorageProvider = unknown
export type SerializedExtensionStorageProviders = SerializedStorageProvider[]
export type DecodedExtensionStorageProviders = StorageProvider[]
export type ExtensionStorageProviderIdentities =
  ExtensionStorageProviderPayload[]

export enum ProviderCredentialFailure {
  InvalidIdentity = 'invalid-provider-identity',
  InvalidTransport = 'invalid-provider-transport',
  AdmissionRejected = 'provider-admission-rejected',
}

export type StageProviderCredentialsArgs = {
  decode: (
    providers: SerializedExtensionStorageProviders,
  ) => Promise<DecodedExtensionStorageProviders>
}

enum SerializedProviderFieldAdmission {
  Accepted = 'accepted',
  Rejected = 'rejected',
}
class SerializedProviderField {
  constructor(private readonly value: unknown) {}
  admission(): SerializedProviderFieldAdmission {
    const value = this.value
    if (typeof value === 'string' || typeof value === 'boolean')
      return SerializedProviderFieldAdmission.Accepted
    if (typeof value === 'number')
      return Number.isFinite(value)
        ? SerializedProviderFieldAdmission.Accepted
        : SerializedProviderFieldAdmission.Rejected
    const values = Array.isArray(value)
      ? value
      : value && Object.getPrototypeOf(value) === Object.prototype
        ? Object.values(value)
        : false
    if (!values) return SerializedProviderFieldAdmission.Rejected
    return values.every(
      (entry) =>
        new SerializedProviderField(entry).admission() ===
        SerializedProviderFieldAdmission.Accepted,
    )
      ? SerializedProviderFieldAdmission.Accepted
      : SerializedProviderFieldAdmission.Rejected
  }
}

export class ProviderCredentialBuffer {
  constructor(
    private readonly providers: SerializedExtensionStorageProviders,
  ) {}
  identities(): Result<
    ExtensionStorageProviderIdentities,
    ProviderCredentialFailure
  > {
    const identities: ExtensionStorageProviderIdentities = []
    for (const provider of this.providers) {
      const identity = new ExtensionStorageProviderPayload(provider).parse()
      if (identity.isErr())
        return err(ProviderCredentialFailure.InvalidIdentity)
      identities.push(identity.value)
    }
    return ok(identities)
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
        if (
          'config' in oauth &&
          oauth.config &&
          typeof oauth.config === 'object'
        ) {
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

  async runWithCleanup<Outcome>(
    operation: () => Promise<Outcome>,
  ): Promise<Outcome> {
    try {
      return await operation()
    } finally {
      this.clear()
    }
  }
  async stage(
    args: StageProviderCredentialsArgs,
  ): Promise<
    Result<DecodedExtensionStorageProviders, ProviderCredentialFailure>
  > {
    // Only the external structured-clone and WASM admission boundaries may reject.
    let staged: SerializedExtensionStorageProviders
    try {
      if (
        new SerializedProviderField(this.providers).admission() !==
        SerializedProviderFieldAdmission.Accepted
      )
        return err(ProviderCredentialFailure.InvalidTransport)
      staged = structuredClone(this.providers)
    } catch {
      return err(ProviderCredentialFailure.InvalidTransport)
    }
    try {
      return ok(await args.decode(staged))
    } catch {
      return err(ProviderCredentialFailure.AdmissionRejected)
    } finally {
      new ProviderCredentialBuffer(staged).clear()
    }
  }
}
