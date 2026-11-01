import { S3_PROVIDER_TYPE } from '../../nook-web-shared/src/vault-app/lib/auth/provider-types'

/** An S3 sync provider row on the local dev S3 server. */
export class S3ProviderFixture {
  static readonly ID = 's3'
  /** The clearly marked test-only key, as the unlocked session holds it. */
  static readonly SECRET = 'TEST-ONLY-device-a-secret-not-real'
  /** The key as a pairing or import payload carries it: sealed to this
   * extension's app key, which Rust requires before admitting the row. */
  static readonly SEALED_SECRET =
    '-----BEGIN AGE ENCRYPTED FILE-----\nTEST-ONLY-fixture'

  /** A literal row, so it serves both as a decoded provider and as the
   * raw value a runtime message carries. */
  static row(secretAccessKey: string) {
    return {
      id: S3ProviderFixture.ID,
      type: S3_PROVIDER_TYPE,
      label: 'nook-dev/e2e',
      githubPat: { state: 'missing' },
      githubRepo: { state: 'defaultRepository' },
      oauthFile: { state: 'notApplicable' },
      localFolder: { state: 'notApplicable' },
      s3: {
        state: 'configured',
        config: {
          endpoint: 'http://127.0.0.1:8333',
          region: 'us-east-1',
          bucket: 'nook-dev',
          keyPrefix: 'e2e',
          accessKeyId: 'device-a',
          secretAccessKey,
        },
      },
      storeId: { state: 'unscoped' },
      syncCheckpoint: { state: 'neverSynced' },
      createdAt: '2026-10-30T00:00:00.000Z',
    } as const
  }
}
