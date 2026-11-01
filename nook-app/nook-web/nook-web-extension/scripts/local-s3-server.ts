// Runs the local S3 server that local-s3.ts describes:
//   bun scripts/local-s3-server.ts dev    serve the persistent dev data directory
//   bun scripts/local-s3-server.ts e2e    serve a fresh temporary directory, deleted on exit
//   bun scripts/local-s3-server.ts reset  delete the dev data directory while no server runs
// `weed` comes from PATH: `task s3:dev` and `task extension:dev` put the pinned
// binary there, and the e2e image installs it in /usr/local/bin.
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Subprocess } from 'bun'
import {
  LOCAL_S3_BUCKET,
  LOCAL_S3_ENDPOINT,
  LOCAL_S3_IDENTITIES_PATH,
  LocalS3Mode,
  localS3Arguments,
  localS3DevDataDir,
  localS3ExtensionChannel,
  type LocalS3Host,
  type LocalS3Launch,
} from './local-s3'

const parseMode = (value: string): LocalS3Mode => {
  switch (value) {
    case LocalS3Mode.Dev:
      return LocalS3Mode.Dev
    case LocalS3Mode.E2e:
      return LocalS3Mode.E2e
    case LocalS3Mode.Reset:
      return LocalS3Mode.Reset
    default:
      throw new Error(
        `Usage: bun scripts/local-s3-server.ts ${Object.values(LocalS3Mode).join('|')}`,
      )
  }
}

const spawnWeed = (launch: LocalS3Launch): Subprocess => {
  try {
    return Bun.spawn(['weed', ...localS3Arguments(launch)], {
      stdin: 'ignore',
      stdout: 'inherit',
      stderr: 'inherit',
    })
  } catch (error) {
    throw new Error(
      `Cannot start weed (${String(error)}); run \`task s3:dev\` once to install the pinned SeaweedFS.`,
      { cause: error },
    )
  }
}

// Runs weed until it exits. The first stop signal goes on to weed, and the
// launcher then waits for weed's own shutdown, so its ports are free once this
// process exits.
const serve = async (launch: LocalS3Launch): Promise<number> => {
  await mkdir(launch.dataDir, { recursive: true })
  const weed = spawnWeed(launch)
  let stopping = false
  const stop = (signal: NodeJS.Signals): void => {
    if (stopping) return
    stopping = true
    weed.kill(signal)
  }
  process.on('SIGINT', () => stop('SIGINT'))
  process.on('SIGTERM', () => stop('SIGTERM'))
  return weed.exited
}

// Any HTTP answer means a server, ours or another, holds the S3 port.
const portAnswers = async (): Promise<boolean> => {
  try {
    await fetch(`${LOCAL_S3_ENDPOINT}/healthz`)
    return true
  } catch {
    return false
  }
}

const host: LocalS3Host = {
  platform: process.platform,
  home: homedir(),
  xdgDataHome: process.env.XDG_DATA_HOME?.trim() || '',
}
const [modeArgument = ''] = process.argv.slice(2)
const mode = parseMode(modeArgument)

switch (mode) {
  case LocalS3Mode.Dev: {
    const launch: LocalS3Launch = {
      mode,
      dataDir: localS3DevDataDir(host),
      channel: localS3ExtensionChannel(),
    }
    console.log(
      `Local S3 ${LOCAL_S3_ENDPOINT}, bucket ${LOCAL_S3_BUCKET}, data ${launch.dataDir}, TEST-ONLY keys in ${LOCAL_S3_IDENTITIES_PATH}`,
    )
    process.exit(await serve(launch))
  }
  case LocalS3Mode.E2e: {
    const launch: LocalS3Launch = {
      mode,
      dataDir: await mkdtemp(join(tmpdir(), 'nook-s3-e2e-')),
      channel: localS3ExtensionChannel(),
    }
    const exitCode = await serve(launch)
    await rm(launch.dataDir, { recursive: true, force: true })
    process.exit(exitCode)
  }
  case LocalS3Mode.Reset: {
    const dataDir = localS3DevDataDir(host)
    if (await portAnswers()) {
      console.error(
        `A server answers on ${LOCAL_S3_ENDPOINT}; stop it before deleting ${dataDir}.`,
      )
      process.exit(1)
    }
    await rm(dataDir, { recursive: true, force: true })
    console.log(`Deleted the local S3 dev data in ${dataDir}`)
  }
}
