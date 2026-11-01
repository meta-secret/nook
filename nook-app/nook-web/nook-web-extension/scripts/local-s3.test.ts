import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { extensionChannelIdentity } from './channel-identity'
import {
  LOCAL_S3_BUCKET,
  LOCAL_S3_ENDPOINT,
  LOCAL_S3_IDENTITIES_PATH,
  LOCAL_S3_READY_URL,
  LOCAL_S3_REGION,
  LocalS3Identity,
  LocalS3Mode,
  localS3AllowedOrigins,
  localS3Arguments,
  localS3Credentials,
  localS3DevDataDir,
  localS3WebServer,
  type LocalS3Host,
  type LocalS3Launch,
} from './local-s3'
import identitiesFixture from './local-s3-identities.json' with { type: 'json' }

const launch: LocalS3Launch = {
  mode: LocalS3Mode.Dev,
  dataDir: '/data/nook-s3',
  channel: 'local',
}
const weedArguments = localS3Arguments(launch)

describe('local S3 server command line', () => {
  test('prints the dev log and keeps the e2e log in its data directory', () => {
    expect(weedArguments.slice(0, 2)).toEqual(['-logtostderr', 'mini'])
    const e2eLaunch: LocalS3Launch = { ...launch, mode: LocalS3Mode.E2e }
    expect(localS3Arguments(e2eLaunch).slice(0, 2)).toEqual([
      '-logdir=/data/nook-s3',
      'mini',
    ])
  })

  test('binds loopback with telemetry and extra listeners off', () => {
    for (const flag of [
      '-dir=/data/nook-s3',
      '-ip=127.0.0.1',
      '-ip.bind=127.0.0.1',
      '-master.telemetry=false',
      '-webdav=false',
      '-admin.ui=false',
      '-s3.port.iceberg=0',
      '-s3.port.lance=0',
      `-bucket=${LOCAL_S3_BUCKET}`,
      `-s3.config=${LOCAL_S3_IDENTITIES_PATH}`,
    ]) {
      expect(weedArguments).toContain(flag)
    }
    expect(existsSync(LOCAL_S3_IDENTITIES_PATH)).toBe(true)
  })

  test('keeps every listener off the dev loop CDP port', () => {
    for (const flag of [
      '-s3.port=8333',
      '-filer.port=8334',
      '-volume.port=8335',
      '-master.port=8336',
      '-admin.port=8337',
    ]) {
      expect(weedArguments).toContain(flag)
    }
    expect(weedArguments.join(' ')).not.toContain('9333')
  })

  test('allows exactly the web origins and the extension build of the channel', () => {
    expect(localS3AllowedOrigins('local')).toEqual([
      'https://localhost:5173',
      'http://127.0.0.1:5173',
      'http://127.0.0.1:5174',
      'chrome-extension://lcjelgolincofkbkklmemdcfcdkckhej',
    ])
    expect(localS3AllowedOrigins('pr-123').at(-1)).toBe(
      `chrome-extension://${extensionChannelIdentity('pr-123').extensionId}`,
    )
    expect(weedArguments).toContain(
      `-s3.allowedOrigins=${localS3AllowedOrigins('local').join(',')}`,
    )
  })
})

describe('local S3 dev data directory', () => {
  test('uses Application Support on macOS', () => {
    const mac: LocalS3Host = {
      platform: 'darwin',
      home: '/Users/dev',
      xdgDataHome: '',
    }
    expect(localS3DevDataDir(mac)).toBe(
      '/Users/dev/Library/Application Support/Nook/s3-dev',
    )
  })

  test('uses the XDG data home on Linux', () => {
    const linux: LocalS3Host = {
      platform: 'linux',
      home: '/home/dev',
      xdgDataHome: '',
    }
    expect(localS3DevDataDir(linux)).toBe('/home/dev/.local/share/nook/s3-dev')
    const xdg: LocalS3Host = {
      platform: 'linux',
      home: '/home/dev',
      xdgDataHome: '/data/xdg',
    }
    expect(localS3DevDataDir(xdg)).toBe('/data/xdg/nook/s3-dev')
  })

  test('refuses other hosts', () => {
    const windows: LocalS3Host = {
      platform: 'win32',
      home: 'C:\\Users\\dev',
      xdgDataHome: '',
    }
    expect(() => localS3DevDataDir(windows)).toThrow('macOS and Linux')
  })
})

describe('local S3 Playwright server', () => {
  test('waits for the bucket and owns one disposable server per CI run', () => {
    const ci = localS3WebServer(true)
    expect(ci.url).toBe(
      'http://127.0.0.1:8333/nook-dev?list-type=2&prefix=ready-probe%2F',
    )
    expect(ci.url).toBe(LOCAL_S3_READY_URL)
    expect(ci.command).toBe(
      `exec bun scripts/local-s3-server.ts ${LocalS3Mode.E2e}`,
    )
    expect(ci.cwd).toBe(resolve(import.meta.dir, '..') + '/')
    expect(ci.reuseExistingServer).toBe(false)
    expect(ci.timeout).toBe(120_000)
    expect(ci.gracefulShutdown).toEqual({ signal: 'SIGTERM', timeout: 20_000 })
    expect(localS3WebServer(false).reuseExistingServer).toBe(true)
  })

  test('gives e2e specs the endpoint, region and bucket the server serves', () => {
    expect(LOCAL_S3_ENDPOINT).toBe('http://127.0.0.1:8333')
    expect(LOCAL_S3_REGION).toBe('us-east-1')
    expect(
      LOCAL_S3_READY_URL.startsWith(`${LOCAL_S3_ENDPOINT}/${LOCAL_S3_BUCKET}?`),
    ).toBe(true)
  })
})

describe('local S3 identities fixture', () => {
  const identities = identitiesFixture.identities
  const deviceActions = ['Read', 'Write', 'List', 'Tagging'].map(
    (action) => `${action}:${LOCAL_S3_BUCKET}`,
  )

  test('gives each device key full object access to the dev bucket', () => {
    for (const device of [
      LocalS3Identity.DeviceA,
      LocalS3Identity.DeviceB,
      LocalS3Identity.DeviceC,
    ]) {
      expect(
        identities.find((identity) => identity.name === device)?.actions,
      ).toEqual(deviceActions)
      expect(localS3Credentials(device).accessKeyId).toBe(device)
    }
  })

  test('keeps one key without access and an anonymous readiness probe', () => {
    expect(identities.map((identity) => identity.name)).toEqual([
      'device-a',
      'device-b',
      'device-c',
      'no-access',
      'anonymous',
    ])
    expect(
      identities.find((identity) => identity.name === LocalS3Identity.NoAccess)
        ?.actions,
    ).toEqual([])
    expect(
      identities.find((identity) => identity.name === 'anonymous')?.actions,
    ).toEqual([`List:${LOCAL_S3_BUCKET}/ready-probe/*`])
    expect(
      identities
        .filter((identity) => identity.credentials)
        .map((identity) => identity.name),
    ).toEqual(['device-a', 'device-b', 'device-c', 'no-access'])
  })

  test('marks every secret as a test value', () => {
    for (const identity of Object.values(LocalS3Identity)) {
      expect(localS3Credentials(identity).secretAccessKey).toStartWith(
        'TEST-ONLY-',
      )
    }
  })
})

type PinnedValue = { source: string; pattern: RegExp }

const pinnedValue = (pin: PinnedValue): string => {
  const value = pin.pattern.exec(pin.source)?.[1]
  if (!value) throw new Error(`${String(pin.pattern)} is not pinned`)
  return value
}

test('host installs and the e2e image pin the same SeaweedFS release', () => {
  const taskfile = readFileSync(
    resolve(import.meta.dir, '../Taskfile.yml'),
    'utf8',
  )
  const dockerfile = readFileSync(
    resolve(import.meta.dir, '../../docker/web.Dockerfile'),
    'utf8',
  )
  const hostVersion: PinnedValue = {
    source: taskfile,
    pattern: /SEAWEEDFS_VERSION: &seaweedfs-version '([^']+)'/,
  }
  const imageVersion: PinnedValue = {
    source: dockerfile,
    pattern: /^ENV SEAWEEDFS_VERSION=(\S+)$/m,
  }
  const hostLinuxDigest: PinnedValue = {
    source: taskfile,
    pattern: /asset=linux_amd64\s+digest=([0-9a-f]{64})/,
  }
  const imageDigest: PinnedValue = {
    source: dockerfile,
    pattern: /^ENV SEAWEEDFS_SHA256=([0-9a-f]{64})$/m,
  }
  expect(pinnedValue(hostVersion)).toBe(pinnedValue(imageVersion))
  expect(pinnedValue(hostLinuxDigest)).toBe(pinnedValue(imageDigest))
})
