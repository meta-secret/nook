import {
  validate_s3_connection_draft,
  type S3ConnectionDraft,
  type S3Connection,
} from '$app-wasm'

/** The local dev S3 server's connection for device A, with its clearly
 * marked test-only key. */
export class S3ConnectionFixture {
  static readonly SECRET = 'TEST-ONLY-device-a-secret-not-real'

  /** What a person types into the S3 form for it. */
  static draft(): S3ConnectionDraft {
    return {
      endpoint: 'http://127.0.0.1:8333',
      region: 'us-east-1',
      bucket: 'nook-dev',
      keyPrefix: 'e2e',
      accessKeyId: 'device-a',
      secretAccessKey: S3ConnectionFixture.SECRET,
    }
  }

  /** The configuration Rust validates that draft into. */
  static configuration(): S3Connection {
    const validation = validate_s3_connection_draft(S3ConnectionFixture.draft())
    switch (validation.state) {
      case 'valid':
        return validation.configuration
      case 'invalid':
        throw new Error('the S3 fixture draft must validate')
    }
  }
}
