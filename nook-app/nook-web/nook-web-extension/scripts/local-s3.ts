// The local S3 server of the dev loop and Playwright: the pinned SeaweedFS
// `weed mini` (installed by `task s3:dev`, present in the e2e image) with the
// fixed flags in local-s3.options: loopback listeners on 8333-8337 (the master
// leaves its 9333 default, the dev loop's browser CDP port), bucket nook-dev,
// and the TEST-ONLY keys in local-s3-identities.json.
//
//   bun scripts/local-s3.ts        serve the persistent dev data until stopped
//   bun scripts/local-s3.ts reset  delete that data while no server runs
import { spawn } from 'node:child_process'
import { mkdir, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { PlaywrightTestConfig } from '@playwright/test'
import {
  extensionChannelIdentity,
  resolveExtensionChannel,
} from './channel-identity'
import {
  LOCAL_S3_BUCKET,
  LOCAL_S3_ENDPOINT,
} from '../../nook-web-shared/src/dev/local-s3-fixture'

export {
  LOCAL_S3_BUCKET,
  LOCAL_S3_ENDPOINT,
  LOCAL_S3_REGION,
  LocalS3Identity,
  localS3Credentials,
} from '../../nook-web-shared/src/dev/local-s3-fixture'

const extensionRoot = fileURLToPath(new URL('..', import.meta.url))

/** Where weed logs, where it keeps its data, and CORS: the dev and e2e web
 * origins plus the extension build of `channel`. */
const weedArguments = (
  log: string,
  dataDir: string,
  channel: string,
): string[] => [
  log,
  'mini',
  '-options=scripts/local-s3.options',
  `-dir=${dataDir}`,
  `-s3.allowedOrigins=${[
    'https://localhost:5173',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:5174',
    `chrome-extension://${extensionChannelIdentity(channel).extensionId}`,
  ].join(',')}`,
]

type PlaywrightWebServers = Extract<
  NonNullable<PlaywrightTestConfig['webServer']>,
  readonly unknown[]
>

/** The webServer entry both Playwright configs append. Each run starts from
 * its own empty temporary directory. */
export const localS3WebServer = (
  isCi: boolean,
): PlaywrightWebServers[number] => {
  // The shell expands `$d` to the directory `mktemp -d` made.
  const scratchDir = '"$d"'
  const channel = resolveExtensionChannel()
  return {
    name: 'local-s3',
    // `exec` lets Playwright's graceful shutdown wait for weed itself.
    command: `d="$(mktemp -d)" && exec weed ${weedArguments(`-logdir=${scratchDir}`, scratchDir, channel).join(' ')}`,
    cwd: extensionRoot,
    // 404 until weed has created the bucket: the fixture's anonymous
    // identity may list only this empty prefix.
    url: `${LOCAL_S3_ENDPOINT}/${LOCAL_S3_BUCKET}?list-type=2&prefix=ready-probe%2F`,
    reuseExistingServer: !isCi,
    timeout: isCi ? 120_000 : 30_000,
    // weed mini waits up to 10 s for its admin component before stopping.
    gracefulShutdown: { signal: 'SIGTERM', timeout: 20_000 },
  }
}

const devDataDir = (): string =>
  process.platform === 'darwin'
    ? join(homedir(), 'Library', 'Application Support', 'Nook', 's3-dev')
    : join(
        process.env.XDG_DATA_HOME?.trim() || join(homedir(), '.local', 'share'),
        'nook',
        's3-dev',
      )

const resetDevData = async (): Promise<number> => {
  // Any answer on the S3 port means a server may be using the data.
  const answers = await fetch(`${LOCAL_S3_ENDPOINT}/healthz`).then(
    () => true,
    () => false,
  )
  if (answers) {
    console.error('Stop the local S3 server before resetting its data.')
    return 1
  }
  await rm(devDataDir(), { recursive: true, force: true })
  return 0
}

const serveDevData = async (): Promise<number> => {
  await mkdir(devDataDir(), { recursive: true })
  // `task s3:dev` and the dev loop serve the local extension channel.
  const weed = spawn(
    'weed',
    weedArguments('-logtostderr', devDataDir(), 'local'),
    { cwd: extensionRoot, stdio: ['ignore', 'inherit', 'inherit'] },
  )
  // The first stop signal goes on to weed, whose own shutdown frees the ports.
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => weed.kill(signal))
  }
  return new Promise((resolve, reject) => {
    weed.once('error', reject)
    weed.once('exit', (code) => resolve(typeof code === 'number' ? code : 1))
  })
}

if (import.meta.main) {
  const run = process.argv[2] === 'reset' ? resetDevData : serveDevData
  void run().then((code) => process.exit(code))
}
