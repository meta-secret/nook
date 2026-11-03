import { err, ok, type Result } from 'neverthrow'
import type {
  OAuthFileProvider,
  ProviderSecretText,
  StorageProvider,
} from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import type { ExtensionStorageProviderIdentity } from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

type ProviderCredentialList = StorageProvider[]

export enum ProviderCredentialFailure {
  InvalidTransport = 'invalid-provider-transport',
  AdmissionRejected = 'provider-admission-rejected',
}

export type ProviderCredentialDecoder = (
  providers: ProviderCredentialList,
) => Promise<ProviderCredentialList>

export type StageProviderCredentialsArgs = {
  decode: ProviderCredentialDecoder
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
  /** What a wiped credential holds: blank text. Rust refuses a blank
   * credential (`ProviderSecretRequired`), so a wiped row can never be
   * admitted, sealed or connected again. JavaScript cannot zero a string;
   * the wipe drops the row's reference to it. It is only ever written. */
  static readonly WIPED_CREDENTIAL: ProviderSecretText = ''

  constructor(private readonly providers: ProviderCredentialList) {}

  /** The rows as the companion protocol names them: no setting and no
   * credential reaches its request decoder. */
  identities(): ExtensionStorageProviderIdentity[] {
    return this.providers.map((row) => ({
      id: row.id,
      type: row.provider.type,
    }))
  }

  /** Wipe each row's credentials in place, by the row's own provider. */
  clear(): void {
    for (const row of this.providers) this.wipe(row)
  }

  /** None for this browser's store or a local folder; the token for GitHub;
   * the access token for Google Drive; the web-auth token for iCloud; the
   * secret access key of S3's own key and of each spare: the credentials
   * Rust's `StoredProvider::secrets()` walks. A test holds the two together. */
  private wipe(row: StorageProvider): void {
    const provider = row.provider
    switch (provider.type) {
      case 'local':
      case 'local-folder':
        return
      case 'github':
        provider.token = ProviderCredentialBuffer.WIPED_CREDENTIAL
        return
      case 'oauth-file':
        this.wipeOAuthFile(provider)
        return
      case 's3':
        provider.secretAccessKey = ProviderCredentialBuffer.WIPED_CREDENTIAL
        for (const spare of provider.spareKeys)
          spare.secretAccessKey = ProviderCredentialBuffer.WIPED_CREDENTIAL
        return
    }
  }

  private wipeOAuthFile(provider: OAuthFileProvider): void {
    switch (provider.preset) {
      case 'google-drive':
        provider.authorization.accessToken =
          ProviderCredentialBuffer.WIPED_CREDENTIAL
        return
      case 'icloud':
        provider.webAuthToken = ProviderCredentialBuffer.WIPED_CREDENTIAL
        return
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
  ): Promise<Result<ProviderCredentialList, ProviderCredentialFailure>> {
    // Only the external structured-clone and WASM admission boundaries may reject.
    let staged: ProviderCredentialList
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
      const admitted = await args.decode(staged)
      return ok(admitted)
    } catch {
      return err(ProviderCredentialFailure.AdmissionRejected)
    } finally {
      new ProviderCredentialBuffer(staged).clear()
    }
  }
}
