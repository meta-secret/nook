// The local dev and e2e S3 server's location and its TEST-ONLY keys, from
// the checked-in fixture the server loads (local-s3-identities.json). Safe in
// a browser: the dev build's S3 form fills them in, and the dev scripts,
// e2e helpers and scenarios connect with them. A production build imports
// none of this.
import identities from '../../../nook-web-extension/scripts/local-s3-identities.json' with { type: 'json' }

export const LOCAL_S3_ENDPOINT = 'http://127.0.0.1:8333'
export const LOCAL_S3_REGION = 'us-east-1'
export const LOCAL_S3_BUCKET = 'nook-dev'

/** The fixture's keys: three devices with full access to the bucket, one with none. */
export enum LocalS3Identity {
  DeviceA = 'device-a',
  DeviceB = 'device-b',
  /** @public A third device's key, for flows with three apps. */
  DeviceC = 'device-c',
  NoAccess = 'no-access',
}

export type LocalS3Credentials = {
  readonly accessKeyId: string
  readonly secretAccessKey: string
}

/** The TEST-ONLY key pair of a fixture identity. */
export function localS3Credentials(
  identity: LocalS3Identity,
): LocalS3Credentials {
  const entry = identities.identities.find(
    (candidate) => candidate.name === identity,
  )
  const credentials = entry && entry.credentials ? entry.credentials : []
  const [credential] = credentials
  if (!credential) {
    throw new Error(`The local S3 fixture has no key for ${identity}.`)
  }
  return {
    accessKeyId: credential.accessKey,
    secretAccessKey: credential.secretKey,
  }
}
