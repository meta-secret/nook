import {
  create_icloud_shared_storage_target,
  type ProviderSecretText,
  type S3Connection,
  type StorageProvider,
} from '../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import { ProviderCredentialBuffer } from '../src/lib/provider-credential-staging'
import {
  LOCAL_S3_BUCKET,
  LOCAL_S3_ENDPOINT,
  LOCAL_S3_REGION,
  LocalS3Identity,
  localS3Credentials,
} from './local-s3'

export type VaultRowRequest = {
  readonly row: StorageProvider
  readonly storeId: string
}
export type ProviderRows = StorageProvider[]

/** Complete provider rows, one builder per stored variant. Each row is
 * unscoped, never synced, created at one time, with an id named after its
 * variant. Credentials are TEST-ONLY texts or the sealed fixture armor. */
export class ProviderRowFixture {
  /** Age armor, as a pairing or import payload carries a credential: Rust's
   * pairing admission requires the marker. TEST-ONLY. */
  static readonly SEALED: ProviderSecretText =
    '-----BEGIN AGE ENCRYPTED FILE-----\nTEST-ONLY-fixture'
  static readonly PLAINTEXT: ProviderSecretText =
    'TEST-ONLY-provider-credential-not-real'
  /** A second credential, for expected rows that must differ from the row
   * under test until both are wiped. */
  static readonly OTHER: ProviderSecretText =
    'TEST-ONLY-other-credential-not-real'
  /** The age specification's example X25519 recipient: a public key only,
   * to seal fixture rows the way Rust seals them for another app. */
  static readonly SEALING_RECIPIENT =
    'age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p'
  static readonly CREATED_AT = '2026-11-01T00:00:00.000Z'

  static local() {
    return {
      id: 'local',
      label: 'This device',
      storeId: { state: 'unscoped' },
      syncCheckpoint: { state: 'neverSynced' },
      createdAt: ProviderRowFixture.CREATED_AT,
      provider: { type: 'local' },
    } satisfies StorageProvider
  }

  static localFolder() {
    return {
      id: 'local-folder',
      label: 'Local backup · Nook Backup',
      storeId: { state: 'unscoped' },
      syncCheckpoint: { state: 'neverSynced' },
      createdAt: ProviderRowFixture.CREATED_AT,
      provider: {
        type: 'local-folder',
        directoryName: 'Nook Backup',
        handleId: 'TEST-ONLY-folder-handle',
      },
    } satisfies StorageProvider
  }

  static github(credential: ProviderSecretText) {
    return {
      id: 'github',
      label: 'GitHub',
      storeId: { state: 'unscoped' },
      syncCheckpoint: { state: 'neverSynced' },
      createdAt: ProviderRowFixture.CREATED_AT,
      provider: {
        type: 'github',
        repository: { state: 'defaultRepository' },
        token: credential,
      },
    } satisfies StorageProvider
  }

  static googleDrive(credential: ProviderSecretText) {
    return {
      id: 'google-drive',
      label: 'Google Drive',
      storeId: { state: 'unscoped' },
      syncCheckpoint: { state: 'neverSynced' },
      createdAt: ProviderRowFixture.CREATED_AT,
      provider: {
        type: 'oauth-file',
        preset: 'google-drive',
        authorization: {
          accessToken: credential,
          expiresAt: '2030-01-01T00:00:00Z',
        },
        account: { state: 'unknown' },
        folderId: 'TEST-ONLY-drive-folder',
      },
    } satisfies StorageProvider
  }

  static icloud(credential: ProviderSecretText) {
    return {
      id: 'icloud',
      label: 'iCloud',
      storeId: { state: 'unscoped' },
      syncCheckpoint: { state: 'neverSynced' },
      createdAt: ProviderRowFixture.CREATED_AT,
      provider: {
        type: 'oauth-file',
        preset: 'icloud',
        webAuthToken: credential,
        account: { state: 'unknown' },
        shareTarget: create_icloud_shared_storage_target(
          'owner',
          'nook-zone',
          'owner-record',
          'root-record',
          'short-guid',
        ),
      },
    } satisfies StorageProvider
  }

  /** The S3 provider's connection on the local dev S3 server, as
   * `provider_wasm_args` carries it. */
  static s3Connection(credential: ProviderSecretText) {
    return {
      endpoint: LOCAL_S3_ENDPOINT,
      region: LOCAL_S3_REGION,
      bucket: LOCAL_S3_BUCKET,
      keyPrefix: { state: 'prefix', value: 'e2e' },
      accessKeyId: localS3Credentials(LocalS3Identity.DeviceA).accessKeyId,
      secretAccessKey: credential,
      // A spare key saved for invites holds a credential too.
      spareKeys: [
        {
          accessKeyId: localS3Credentials(LocalS3Identity.DeviceB).accessKeyId,
          secretAccessKey: credential,
        },
      ],
    } satisfies S3Connection
  }

  static s3(credential: ProviderSecretText) {
    return {
      id: 's3',
      label: `S3 · ${LOCAL_S3_BUCKET}/e2e`,
      storeId: { state: 'unscoped' },
      syncCheckpoint: { state: 'neverSynced' },
      createdAt: ProviderRowFixture.CREATED_AT,
      provider: { type: 's3', ...ProviderRowFixture.s3Connection(credential) },
    } satisfies StorageProvider
  }

  static inVault(request: VaultRowRequest): StorageProvider {
    return {
      ...request.row,
      storeId: { state: 'storeId', value: request.storeId },
    }
  }

  /** One row of each stored variant; credential-bearing rows hold `credential`. */
  static every(credential: ProviderSecretText) {
    return [
      ProviderRowFixture.local(),
      ProviderRowFixture.localFolder(),
      ProviderRowFixture.github(credential),
      ProviderRowFixture.googleDrive(credential),
      ProviderRowFixture.icloud(credential),
      ProviderRowFixture.s3(credential),
    ]
  }

  /** The rows as the production wipe leaves them: the expected value for a
   * path that must wipe. It never names the wipe value. */
  static afterWipe<Rows extends ProviderRows>(rows: Rows): Rows {
    new ProviderCredentialBuffer(rows).clear()
    return rows
  }
}
