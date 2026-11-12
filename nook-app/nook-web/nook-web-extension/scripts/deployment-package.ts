import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { basename, join, relative, resolve, sep } from 'node:path'
import { zipSync, type ZipOptions, type Zippable } from 'fflate'
import {
  extensionIdFromManifestKey,
  parseExtensionChannel,
  resolveExtensionChannel,
  type ExtensionChannel,
} from './channel-identity'
import { companionWasmReady } from '../../nook-web-shared/src/extension/companion-ready'
import { ExtensionPackageDistribution } from '../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  extensionPackageHost,
  ExtensionPackageHost,
  extensionVaultTargetFromEnvironment,
  type ExtensionVaultTarget,
} from './vault-target'

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
  install_method: ExtensionInstallMethod
  install_url: string
}

export enum ExtensionInstallMethod {
  ChromeWebStore = 'chrome_web_store',
  ManualZip = 'manual_zip',
}

const FIXED_ARCHIVE_TIMESTAMP = new Date('2000-01-01T00:00:00.000Z')
const identityJsonReplacer = (_key: string, value: unknown): unknown => value
const safeJson: { parse: (value: string) => unknown } = JSON

export type DeterministicZipRequest = {
  readonly sourceDirectory: string
  readonly archivePath: string
}

class ExtensionManifestAdmission {
  parse(value: unknown): DeploymentManifest {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      !('manifest_version' in value) ||
      value.manifest_version !== 3 ||
      !('version' in value) ||
      typeof value.version !== 'string' ||
      !('key' in value) ||
      typeof value.key !== 'string' ||
      !('externally_connectable' in value) ||
      !value.externally_connectable ||
      typeof value.externally_connectable !== 'object' ||
      Array.isArray(value.externally_connectable) ||
      !('matches' in value.externally_connectable)
    ) {
      throw new Error('Deployment extension manifest has an invalid shape.')
    }
    return {
      manifest_version: 3,
      version: value.version,
      key: value.key,
      externally_connectable: {
        matches: decodeMatchList(value.externally_connectable.matches),
      },
    }
  }
}

type DeploymentManifest = {
  manifest_version: 3
  version: string
  key: string
  externally_connectable: { matches: string[] }
}

function decodeMatchList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new TypeError('Deployment extension match list is invalid.')
  }
  const matches: string[] = []
  for (const match of value) {
    if (typeof match !== 'string') {
      throw new TypeError('Deployment extension match list is invalid.')
    }
    matches.push(match)
  }
  return matches
}

const extensionManifestAdmission = new ExtensionManifestAdmission()

export function extensionArchiveName(
  channel: ExtensionChannel,
  version: string,
  target: ExtensionVaultTarget,
): string {
  const prefix = `nook-passwords${target.downloadsSuffix}`
  if (channel === 'development') return `${prefix}-dev.zip`
  if (channel === 'local') return `${prefix}-local.zip`
  if (channel.startsWith('pr-')) return `${prefix}-${channel}.zip`
  if (!/^[0-9A-Za-z][0-9A-Za-z.+-]*$/.test(version)) {
    throw new Error('NOOK_EXTENSION_VERSION is not safe for an archive name.')
  }
  return `${prefix}-${version}.zip`
}

/** Only the store-distributed package on the production channel installs
 * from the Chrome Web Store; every other package is a manual ZIP. */
export function extensionInstallMethod(
  channel: ExtensionChannel,
  distribution: ExtensionPackageDistribution,
): ExtensionInstallMethod {
  switch (distribution) {
    case ExtensionPackageDistribution.ManualZip:
      return ExtensionInstallMethod.ManualZip
    case ExtensionPackageDistribution.StoreOnProductionChannel:
      return channel === 'production'
        ? ExtensionInstallMethod.ChromeWebStore
        : ExtensionInstallMethod.ManualZip
  }
}

export function extensionInstallTarget(
  installMethod: ExtensionInstallMethod,
  extensionId: string,
  downloadUrl: string,
): Pick<ExtensionDeploymentMetadata, 'install_method' | 'install_url'> {
  if (!/^[a-p]{32}$/.test(extensionId)) {
    throw new Error('Extension ID is not a valid Chrome extension ID.')
  }
  switch (installMethod) {
    case ExtensionInstallMethod.ChromeWebStore:
      return {
        install_method: ExtensionInstallMethod.ChromeWebStore,
        install_url: `https://chromewebstore.google.com/detail/${extensionId}`,
      }
    case ExtensionInstallMethod.ManualZip:
      return {
        install_method: ExtensionInstallMethod.ManualZip,
        install_url: downloadUrl,
      }
  }
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
      if (entry.isSymbolicLink()) {
        throw new Error(
          `Extension archive cannot contain a symbolic link: ${entry.name}`,
        )
      }
      const path = join(directory, entry.name)
      return entry.isDirectory()
        ? filesBelow(root, path)
        : [relative(root, path).split(sep).join('/')]
    }),
  )
  return files.flat().sort()
}

export async function makeDeterministicZip(
  request: DeterministicZipRequest,
): Promise<void> {
  const { sourceDirectory, archivePath } = request
  const files = await filesBelow(sourceDirectory)
  if (!files.includes('manifest.json')) {
    throw new Error('Extension archive must contain manifest.json at its root.')
  }
  const archiveEntries: Zippable = {}
  // Source maps are debugging aids the installed extension never loads; left
  // out, the download stays well under the 25 MiB a hosted file may be.
  for (const file of files.filter((path) => !path.endsWith('.map'))) {
    archiveEntries[file] = await readFile(join(sourceDirectory, file))
  }
  const archiveOptions: ZipOptions = {
    attrs: 0o644 << 16,
    mtime: FIXED_ARCHIVE_TIMESTAMP,
    os: 3,
  }
  await rm(archivePath, { force: true })
  await writeFile(archivePath, zipSync(archiveEntries, archiveOptions))
}

/** One build's package: where it is written and the facts it records. */
export type ExtensionPackageRequest = {
  readonly extensionDist: string
  /** The public site artifact (`nook-web-app/dist/site`). */
  readonly siteDist: string
  /** The Simple vault artifact (`nook-vault-simple/dist`). */
  readonly simpleVaultDist: string
  readonly channel: ExtensionChannel
  readonly version: string
  readonly commit: string
  /** NOOK_EXTENSION_SITE_URL: the public site that hosts the default package. */
  readonly siteUrl: string
  readonly target: ExtensionVaultTarget
}

/** Public base URL of the artifact that serves this target's package. */
export function extensionPackageSiteUrl(
  target: ExtensionVaultTarget,
  siteUrl: string,
): URL {
  switch (extensionPackageHost(target)) {
    case ExtensionPackageHost.Site:
      return normalizedHttpsBaseUrl(siteUrl, 'NOOK_EXTENSION_SITE_URL')
    case ExtensionPackageHost.SimpleVault:
      return normalizedHttpsBaseUrl(
        target.simpleVaultBaseUrl,
        'The Simple vault URL that hosts this package',
      )
  }
}

function extensionPackageDownloads(request: ExtensionPackageRequest): string {
  switch (extensionPackageHost(request.target)) {
    case ExtensionPackageHost.Site:
      return join(request.siteDist, 'downloads')
    case ExtensionPackageHost.SimpleVault:
      return join(request.simpleVaultDist, 'downloads')
  }
}

export async function packageExtensionDeployment(
  request: ExtensionPackageRequest,
): Promise<ExtensionDeploymentMetadata> {
  const { channel, version, commit, target } = request
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error('NOOK_EXTENSION_COMMIT must be a full lowercase Git SHA.')
  }
  const siteUrl = extensionPackageSiteUrl(target, request.siteUrl)
  const manifest = extensionManifestAdmission.parse(
    safeJson.parse(
      await readFile(join(request.extensionDist, 'manifest.json'), 'utf8'),
    ),
  )
  if (!manifest.key) {
    throw new Error('Deployment extension manifest is missing its stable key.')
  }
  const [pairedMatch] = manifest.externally_connectable.matches
  if (manifest.externally_connectable.matches.length !== 1) {
    throw new Error(
      'Deployment extension manifest must pair with exactly one Simple Vault.',
    )
  }
  // The package is named for NOOK_EXTENSION_VAULT; the built manifest must
  // pair with that same Simple vault.
  if (pairedMatch !== `${target.simpleVaultBaseUrl}*`) {
    throw new Error(
      `Built extension pairs with ${pairedMatch}, not the packaged vault target ${target.simpleVaultBaseUrl}.`,
    )
  }

  // Replace only this target's files so each vault target's package coexists.
  const downloads = extensionPackageDownloads(request)
  await mkdir(downloads, { recursive: true })
  const archive = extensionArchiveName(channel, version, target)
  const metadataFile = target.metadataFileName
  const archivePath = join(downloads, archive)
  await Promise.all(
    [metadataFile, archive, `${archive}.sha256`].map((file) =>
      rm(join(downloads, file), { force: true }),
    ),
  )
  const archiveRequest: DeterministicZipRequest = {
    sourceDirectory: request.extensionDist,
    archivePath,
  }
  await makeDeterministicZip(archiveRequest)
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
    simple_vault_url: target.simpleVaultBaseUrl,
    extension_id: extensionId,
    archive,
    download_url: downloadUrl,
    checksum_url: checksumUrl,
    sha256: digest,
    ...extensionInstallTarget(
      extensionInstallMethod(channel, target.distribution),
      extensionId,
      downloadUrl,
    ),
  }
  await Promise.all([
    writeFile(
      join(downloads, metadataFile),
      `${JSON.stringify(metadata, identityJsonReplacer, 2)}\n`,
    ),
    writeFile(join(downloads, `${archive}.sha256`), `${digest}  ${archive}\n`),
  ])
  const archiveStats = await stat(archivePath)
  console.log(
    `Packaged ${basename(archivePath)} (${archiveStats.size} bytes, ${metadata.extension_id})`,
  )
  return metadata
}

/** Package the build in `dist/` for the environment's channel and vault target. */
async function packageExtensionDeploymentFromEnvironment(): Promise<ExtensionDeploymentMetadata> {
  const projectRoot = resolve(import.meta.dir, '..')
  const request: ExtensionPackageRequest = {
    extensionDist: join(projectRoot, 'dist'),
    siteDist: resolve(projectRoot, '../nook-web-app/dist/site'),
    simpleVaultDist: resolve(projectRoot, '../nook-vault-simple/dist'),
    channel: parseExtensionChannel(resolveExtensionChannel()),
    version: process.env.NOOK_EXTENSION_VERSION?.trim() || '1.0.0',
    commit: process.env.NOOK_EXTENSION_COMMIT?.trim() || '',
    siteUrl: process.env.NOOK_EXTENSION_SITE_URL?.trim() || 'https://nokey.sh/',
    target: extensionVaultTargetFromEnvironment(),
  }
  return packageExtensionDeployment(request)
}

if (import.meta.main) {
  await companionWasmReady
  await packageExtensionDeploymentFromEnvironment()
}
