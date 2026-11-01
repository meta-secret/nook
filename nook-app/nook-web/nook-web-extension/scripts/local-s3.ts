// The local S3 server for the host-native dev loop and Playwright: the pinned
// SeaweedFS `weed mini` (installed by `task s3:dev`, present in the e2e image),
// bound to loopback with the TEST-ONLY identities in local-s3-identities.json.
// This module owns its command line, ports, bucket, CORS origins, readiness
// probe and fixture keys; local-s3-server.ts runs it. E2e specs import the
// endpoint, region, bucket and keys from here.
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { PlaywrightTestConfig } from '@playwright/test'
import { extensionChannelIdentity } from './channel-identity'
import identitiesFixture from './local-s3-identities.json' with { type: 'json' }

export enum LocalS3Mode {
  /** Serve the persistent dev data directory (`task s3:dev`, `task extension:dev`). */
  Dev = 'dev',
  /** Serve a fresh temporary data directory, deleted when the server exits (Playwright). */
  E2e = 'e2e',
  /** Delete the dev data directory while no server runs (`task s3:dev:reset`). */
  Reset = 'reset',
}

/** The fixture's access keys: three devices with full access to the bucket, one with none. */
export enum LocalS3Identity {
  DeviceA = 'device-a',
  DeviceB = 'device-b',
  DeviceC = 'device-c',
  NoAccess = 'no-access',
}

export type LocalS3Credentials = {
  accessKeyId: string
  secretAccessKey: string
}

export type LocalS3Launch = {
  mode: LocalS3Mode
  dataDir: string
  channel: string
}

export type LocalS3Host = {
  platform: string
  home: string
  xdgDataHome: string
}

type PlaywrightWebServers = Extract<
  NonNullable<PlaywrightTestConfig['webServer']>,
  readonly unknown[]
>
type PlaywrightWebServer = PlaywrightWebServers[number]

const extensionRoot = fileURLToPath(new URL('..', import.meta.url))

// Every listener binds 127.0.0.1, and gRPC listens on each port + 10000. The
// master leaves its 9333 default, which is the dev loop's browser CDP port.
const s3Port = 8333
const filerPort = 8334
const volumePort = 8335
const masterPort = 8336
const adminPort = 8337

export const LOCAL_S3_ENDPOINT = `http://127.0.0.1:${s3Port}`
export const LOCAL_S3_REGION = 'us-east-1'
export const LOCAL_S3_BUCKET = 'nook-dev'
// Answers 404 until `weed mini` has created the bucket, then 200: the fixture's
// anonymous identity may list only this empty prefix. The S3 root answers 403
// from the first second, and Playwright already counts 403 as ready.
export const LOCAL_S3_READY_URL = `${LOCAL_S3_ENDPOINT}/${LOCAL_S3_BUCKET}?list-type=2&prefix=ready-probe%2F`
export const LOCAL_S3_IDENTITIES_PATH = join(
  extensionRoot,
  'scripts',
  'local-s3-identities.json',
)

// The dev loop and `web:dev` vault, the web-app e2e server, and the Simple
// Vault e2e server.
const webOrigins = [
  'https://localhost:5173',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
]

/** CORS allows exactly the web origins and the extension build of this channel. */
export const localS3AllowedOrigins = (channel: string): string[] => [
  ...webOrigins,
  `chrome-extension://${extensionChannelIdentity(channel).extensionId}`,
]

/** The channel of the extension build; scripts/build.ts applies the same default. */
export const localS3ExtensionChannel = (): string =>
  process.env.NOOK_EXTENSION_CHANNEL?.trim() || 'production'

export const localS3Arguments = (launch: LocalS3Launch): string[] => [
  // Dev prints the server log in its terminal. E2e keeps it in the disposable
  // data directory, so Playwright shows only weed's warnings and errors.
  launch.mode === LocalS3Mode.Dev
    ? '-logtostderr'
    : `-logdir=${launch.dataDir}`,
  'mini',
  `-dir=${launch.dataDir}`,
  '-ip=127.0.0.1',
  '-ip.bind=127.0.0.1',
  '-master.telemetry=false',
  '-webdav=false',
  '-admin.ui=false',
  '-s3.port.iceberg=0',
  '-s3.port.lance=0',
  `-s3.port=${s3Port}`,
  `-filer.port=${filerPort}`,
  `-volume.port=${volumePort}`,
  `-master.port=${masterPort}`,
  `-admin.port=${adminPort}`,
  `-s3.config=${LOCAL_S3_IDENTITIES_PATH}`,
  `-s3.allowedOrigins=${localS3AllowedOrigins(launch.channel).join(',')}`,
  `-bucket=${LOCAL_S3_BUCKET}`,
]

export const localS3DevDataDir = (host: LocalS3Host): string => {
  if (host.platform === 'darwin') {
    return join(host.home, 'Library', 'Application Support', 'Nook', 's3-dev')
  }
  if (host.platform === 'linux') {
    const dataHome = host.xdgDataHome || join(host.home, '.local', 'share')
    return join(dataHome, 'nook', 's3-dev')
  }
  throw new Error(
    `The local S3 server supports macOS and Linux hosts, not ${host.platform}.`,
  )
}

/** The TEST-ONLY key pair of a fixture identity. */
export const localS3Credentials = (
  identity: LocalS3Identity,
): LocalS3Credentials => {
  const credential = identitiesFixture.identities.find(
    (entry) => entry.name === identity,
  )?.credentials?.[0]
  if (!credential) {
    throw new Error(`The local S3 fixture has no key for ${identity}.`)
  }
  return {
    accessKeyId: credential.accessKey,
    secretAccessKey: credential.secretKey,
  }
}

/** The webServer entry both Playwright configs append: one server per run. */
export const localS3WebServer = (isCi: boolean): PlaywrightWebServer => ({
  name: 'local-s3',
  // `exec` replaces the shell with the launcher, so Playwright's graceful
  // shutdown waits until weed has stopped and released its ports.
  command: `exec bun scripts/local-s3-server.ts ${LocalS3Mode.E2e}`,
  cwd: extensionRoot,
  url: LOCAL_S3_READY_URL,
  reuseExistingServer: !isCi,
  timeout: isCi ? 120_000 : 30_000,
  // weed mini waits up to 10 s for its admin component, then stops the filer
  // and volume server.
  gracefulShutdown: { signal: 'SIGTERM', timeout: 20_000 },
})
