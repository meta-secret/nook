import { createHash } from 'node:crypto'
import {
  chmod,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { basename, join, relative, resolve } from 'node:path'
import type { ExtensionManifest } from '../src/manifest'
import {
  extensionIdFromManifestKey,
  parseExtensionChannel,
  type ExtensionChannel,
} from './channel-identity'

export type ExtensionDeploymentMetadata = {
  schema_version: 2
  channel: ExtensionChannel
  version: string
  manifest_version: string
  commit: string
  simple_vault_url: string
  extension_id: string
  archive: string
  download_url: string
  checksum_url: string
  sha256: string
  install_method: 'chrome_web_store' | 'manual_zip'
  install_url: string
}

const FIXED_ARCHIVE_TIMESTAMP = new Date('2000-01-01T00:00:00.000Z')

export function extensionArchiveName(
  channel: ExtensionChannel,
  version: string,
): string {
  if (channel === 'development') return 'nook-passwords-dev.zip'
  if (channel === 'local') return 'nook-passwords-local.zip'
  if (channel.startsWith('pr-')) return `nook-passwords-${channel}.zip`
  if (!/^[0-9A-Za-z][0-9A-Za-z.+-]*$/.test(version)) {
    throw new Error('NOOK_EXTENSION_VERSION is not safe for an archive name.')
  }
  return `nook-passwords-${version}.zip`
}

export function extensionInstallTarget(
  channel: ExtensionChannel,
  extensionId: string,
  downloadUrl: string,
): Pick<ExtensionDeploymentMetadata, 'install_method' | 'install_url'> {
  if (!/^[a-p]{32}$/.test(extensionId)) {
    throw new Error('Extension ID is not a valid Chrome extension ID.')
  }
  if (channel === 'production') {
    return {
      install_method: 'chrome_web_store',
      install_url: `https://chromewebstore.google.com/detail/${extensionId}`,
    }
  }
  return { install_method: 'manual_zip', install_url: downloadUrl }
}

function normalizedHttpsBaseUrl(value: string, name: string): URL {
  const url = new URL(value)
  if (url.protocol !== 'https:') throw new Error(`${name} must use HTTPS.`)
  url.hash = ''
  url.search = ''
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/`
  return url
}

async function filesBelow(root: string, directory = root): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name)
      return entry.isDirectory()
        ? filesBelow(root, path)
        : [relative(root, path)]
    }),
  )
  return files.flat().sort()
}

async function makeDeterministicZip(
  sourceDirectory: string,
  archivePath: string,
): Promise<void> {
  const files = await filesBelow(sourceDirectory)
  if (!files.includes('manifest.json')) {
    throw new Error('Extension archive must contain manifest.json at its root.')
  }
  await Promise.all(
    files.map(async (file) => {
      const path = join(sourceDirectory, file)
      await chmod(path, 0o644)
      await utimes(path, FIXED_ARCHIVE_TIMESTAMP, FIXED_ARCHIVE_TIMESTAMP)
    }),
  )
  await rm(archivePath, { force: true })
  const process = Bun.spawn(['zip', '-X', '-q', archivePath, ...files], {
    cwd: sourceDirectory,
    stderr: 'pipe',
    stdout: 'pipe',
  })
  const status = await process.exited
  if (status !== 0) {
    throw new Error(
      `Failed to create extension archive: ${await new Response(process.stderr).text()}`,
    )
  }
}

export async function packageExtensionDeployment(): Promise<ExtensionDeploymentMetadata> {
  const projectRoot = resolve(import.meta.dir, '..')
  const extensionDist = join(projectRoot, 'dist')
  const siteDist = resolve(projectRoot, '../nook-web-app/dist/site')
  const downloads = join(siteDist, 'downloads')
  const channel = parseExtensionChannel(
    process.env.NOOK_EXTENSION_CHANNEL?.trim() || 'production',
  )
  const version = process.env.NOOK_EXTENSION_VERSION?.trim() || '1.0.0'
  const commit = process.env.NOOK_EXTENSION_COMMIT?.trim() || ''
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error('NOOK_EXTENSION_COMMIT must be a full lowercase Git SHA.')
  }
  const siteUrl = normalizedHttpsBaseUrl(
    process.env.NOOK_EXTENSION_SITE_URL?.trim() || 'https://nokey.sh/',
    'NOOK_EXTENSION_SITE_URL',
  )
  const manifest = JSON.parse(
    await readFile(join(extensionDist, 'manifest.json'), 'utf8'),
  ) as ExtensionManifest
  if (!manifest.key) {
    throw new Error('Deployment extension manifest is missing its stable key.')
  }
  const simpleVaultUrl = manifest.externally_connectable.matches[0]
  if (!simpleVaultUrl) {
    throw new Error('Deployment extension manifest has no Simple Vault target.')
  }

  await rm(downloads, { force: true, recursive: true })
  await mkdir(downloads, { recursive: true })
  const archive = extensionArchiveName(channel, version)
  const archivePath = join(downloads, archive)
  await makeDeterministicZip(extensionDist, archivePath)
  const digest = createHash('sha256')
    .update(await readFile(archivePath))
    .digest('hex')
  const downloadUrl = new URL(`downloads/${archive}`, siteUrl).toString()
  const checksumUrl = new URL(`downloads/${archive}.sha256`, siteUrl).toString()
  const extensionId = extensionIdFromManifestKey(manifest.key)
  const metadata: ExtensionDeploymentMetadata = {
    schema_version: 2,
    channel,
    version,
    manifest_version: manifest.version,
    commit,
    simple_vault_url: simpleVaultUrl.replace(/\*$/, ''),
    extension_id: extensionId,
    archive,
    download_url: downloadUrl,
    checksum_url: checksumUrl,
    sha256: digest,
    ...extensionInstallTarget(channel, extensionId, downloadUrl),
  }
  await Promise.all([
    writeFile(
      join(downloads, 'extension.json'),
      `${JSON.stringify(metadata, undefined, 2)}\n`,
    ),
    writeFile(join(downloads, `${archive}.sha256`), `${digest}  ${archive}\n`),
  ])
  const archiveStats = await stat(archivePath)
  console.log(
    `Packaged ${basename(archivePath)} (${archiveStats.size} bytes, ${metadata.extension_id})`,
  )
  return metadata
}

if (import.meta.main) await packageExtensionDeployment()
