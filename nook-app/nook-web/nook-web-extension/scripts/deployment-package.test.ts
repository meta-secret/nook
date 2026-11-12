import { companionWasmReady } from '../../nook-web-shared/src/extension/companion-ready'

await companionWasmReady
import { describe, expect, spyOn, test } from 'bun:test'
import { unzipSync } from 'fflate'
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  extensionArchiveName,
  extensionInstallMethod,
  extensionInstallTarget,
  ExtensionInstallMethod,
  makeDeterministicZip,
  packageExtensionDeployment,
  type DeterministicZipRequest,
  type ExtensionPackageRequest,
} from './deployment-package'
import {
  extensionChannelIdentity,
  extensionIdentity,
  ExtensionReleaseChannel,
} from './channel-identity'
import { resolveExtensionVaultTarget } from './vault-target'

const defaultVaultTarget = resolveExtensionVaultTarget('nokey')
const metaSecretVaultTarget = resolveExtensionVaultTarget('meta-secret')

describe('extension deployment archive', () => {
  test('uses predictable channel-specific names', () => {
    expect(
      extensionArchiveName(
        ExtensionReleaseChannel.Production,
        '1.2.3',
        defaultVaultTarget,
      ),
    ).toBe('nook-passwords-1.2.3.zip')
    expect(
      extensionArchiveName(
        ExtensionReleaseChannel.Development,
        '1.2.3',
        defaultVaultTarget,
      ),
    ).toBe('nook-passwords-dev.zip')
    expect(
      extensionArchiveName(
        ExtensionReleaseChannel.Local,
        '1.2.3',
        defaultVaultTarget,
      ),
    ).toBe('nook-passwords-local.zip')
    expect(extensionArchiveName('pr-408', '1.2.3', defaultVaultTarget)).toBe(
      'nook-passwords-pr-408.zip',
    )
  })

  test('names a named vault target archive after that target', () => {
    expect(
      extensionArchiveName(
        ExtensionReleaseChannel.Production,
        '1.2.3',
        metaSecretVaultTarget,
      ),
    ).toBe('nook-passwords-meta-secret-1.2.3.zip')
    expect(
      extensionArchiveName(
        ExtensionReleaseChannel.Development,
        '1.2.3',
        metaSecretVaultTarget,
      ),
    ).toBe('nook-passwords-meta-secret-dev.zip')
  })

  test('rejects unsafe production versions', () => {
    expect(() =>
      extensionArchiveName(
        ExtensionReleaseChannel.Production,
        '../latest',
        defaultVaultTarget,
      ),
    ).toThrow()
  })

  test('installs only the default production package from the Chrome Web Store', () => {
    expect(
      extensionInstallMethod(
        ExtensionReleaseChannel.Production,
        defaultVaultTarget.distribution,
      ),
    ).toBe(ExtensionInstallMethod.ChromeWebStore)
    for (const channel of [
      ExtensionReleaseChannel.Development,
      ExtensionReleaseChannel.Local,
      'pr-408',
    ]) {
      expect(
        extensionInstallMethod(channel, defaultVaultTarget.distribution),
      ).toBe(ExtensionInstallMethod.ManualZip)
    }
    for (const channel of [
      ExtensionReleaseChannel.Production,
      ExtensionReleaseChannel.Development,
      'pr-408',
    ]) {
      expect(
        extensionInstallMethod(channel, metaSecretVaultTarget.distribution),
      ).toBe(ExtensionInstallMethod.ManualZip)
    }
  })

  test('sends store installs to the Chrome Web Store', () => {
    const extensionId = 'abcdefghijklmnopabcdefghijklmnop'
    expect(
      extensionInstallTarget(
        ExtensionInstallMethod.ChromeWebStore,
        extensionId,
        'https://nokey.sh/downloads/nook-passwords-1.2.3.zip',
      ),
    ).toEqual({
      install_method: ExtensionInstallMethod.ChromeWebStore,
      install_url: `https://chromewebstore.google.com/detail/${extensionId}`,
    })
  })

  test('keeps manual installs on the package ZIP', () => {
    const downloadUrl =
      'https://pr-408.nokey-sh.pages.dev/downloads/nook-passwords-pr-408.zip'
    expect(
      extensionInstallTarget(
        ExtensionInstallMethod.ManualZip,
        'abcdefghijklmnopabcdefghijklmnop',
        downloadUrl,
      ),
    ).toEqual({
      install_method: ExtensionInstallMethod.ManualZip,
      install_url: downloadUrl,
    })
  })

  test('rejects invalid extension IDs when creating install links', () => {
    expect(() =>
      extensionInstallTarget(
        ExtensionInstallMethod.ChromeWebStore,
        'invalid',
        'https://nokey.sh/downloads/nook-passwords-1.2.3.zip',
      ),
    ).toThrow()
  })

  test('creates a stable root-manifest archive without source maps or spawning zip', async () => {
    const workspaceDirectory = await mkdtemp(
      join(tmpdir(), 'nook-extension-package-'),
    )
    const sourceDirectory = join(workspaceDirectory, 'dist')
    await mkdir(sourceDirectory)
    const firstArchive = join(workspaceDirectory, 'first.zip')
    const secondArchive = join(workspaceDirectory, 'second.zip')
    const externalZip = spyOn(Bun, 'spawn')

    try {
      await writeFile(
        join(sourceDirectory, 'manifest.json'),
        '{"manifest_version":3}',
      )
      await writeFile(join(sourceDirectory, 'service-worker.js'), 'self.test()')
      // A debugging aid the installed extension never loads.
      await writeFile(
        join(sourceDirectory, 'service-worker.js.map'),
        '{"version":3}',
      )
      await mkdir(join(sourceDirectory, 'assets'))
      await writeFile(
        join(sourceDirectory, 'assets', 'icon.svg'),
        '<svg></svg>',
      )
      const archiveRequest: DeterministicZipRequest = {
        sourceDirectory,
        archivePath: firstArchive,
      }
      await makeDeterministicZip(archiveRequest)
      const secondArchiveRequest: DeterministicZipRequest = {
        sourceDirectory,
        archivePath: secondArchive,
      }
      await makeDeterministicZip(secondArchiveRequest)

      const firstBytes = await readFile(firstArchive)
      const secondBytes = await readFile(secondArchive)
      const entries = unzipSync(firstBytes)

      expect(externalZip).not.toHaveBeenCalled()
      expect(firstBytes).toEqual(secondBytes)
      expect(Object.keys(entries).sort()).toEqual([
        'assets/icon.svg',
        'manifest.json',
        'service-worker.js',
      ])
      expect(new TextDecoder().decode(entries['manifest.json'])).toBe(
        '{"manifest_version":3}',
      )
      expect(new TextDecoder().decode(entries['assets/icon.svg'])).toBe(
        '<svg></svg>',
      )
    } finally {
      externalZip.mockRestore()
      await rm(workspaceDirectory, { recursive: true, force: true })
    }
  })

  test('rejects an extension source without a root manifest', async () => {
    const sourceDirectory = await mkdtemp(
      join(tmpdir(), 'nook-extension-package-'),
    )

    try {
      const missingManifestArchiveRequest: DeterministicZipRequest = {
        sourceDirectory,
        archivePath: join(sourceDirectory, 'extension.zip'),
      }
      const archiveResult = makeDeterministicZip(missingManifestArchiveRequest)
      expect(archiveResult).rejects.toThrow('manifest.json at its root')
    } finally {
      await rm(sourceDirectory, { recursive: true, force: true })
    }
  })

  test('surfaces archive write failures', async () => {
    const sourceDirectory = await mkdtemp(
      join(tmpdir(), 'nook-extension-package-'),
    )

    try {
      await writeFile(join(sourceDirectory, 'manifest.json'), '{}')
      const failedArchiveRequest: DeterministicZipRequest = {
        sourceDirectory,
        archivePath: join(sourceDirectory, 'missing', 'extension.zip'),
      }
      const archiveResult = makeDeterministicZip(failedArchiveRequest)
      expect(archiveResult).rejects.toThrow()
    } finally {
      await rm(sourceDirectory, { recursive: true, force: true })
    }
  })
})

describe('extension deployment packages per vault target', () => {
  const commit = '0123456789abcdef0123456789abcdef01234567'

  async function writeBuild(
    extensionDist: string,
    simpleVaultBaseUrl: string,
    manifestKey: string,
  ): Promise<void> {
    await rm(extensionDist, { recursive: true, force: true })
    await mkdir(extensionDist, { recursive: true })
    const manifest = {
      manifest_version: 3,
      version: '1.2.3',
      key: manifestKey,
      externally_connectable: { matches: [`${simpleVaultBaseUrl}*`] },
    }
    await writeFile(
      join(extensionDist, 'manifest.json'),
      JSON.stringify(manifest),
    )
  }

  test('the meta-secret package lands in the Simple vault beside the site package', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nook-extension-targets-'))
    const extensionDist = join(root, 'extension')
    const siteDist = join(root, 'site')
    const simpleVaultDist = join(root, 'simple')

    try {
      const nokeyRequest: ExtensionPackageRequest = {
        extensionDist,
        siteDist,
        simpleVaultDist,
        channel: ExtensionReleaseChannel.Production,
        version: '1.2.3',
        commit,
        siteUrl: 'https://nokey.sh/',
        target: defaultVaultTarget,
      }
      await writeBuild(
        extensionDist,
        defaultVaultTarget.simpleVaultBaseUrl,
        extensionChannelIdentity('production').manifestKey,
      )
      const nokey = await packageExtensionDeployment(nokeyRequest)

      const metaSecretRequest: ExtensionPackageRequest = {
        ...nokeyRequest,
        target: metaSecretVaultTarget,
      }
      await writeBuild(
        extensionDist,
        metaSecretVaultTarget.simpleVaultBaseUrl,
        extensionIdentity('production', metaSecretVaultTarget.identityScope)
          .manifestKey,
      )
      const metaSecret = await packageExtensionDeployment(metaSecretRequest)

      expect((await readdir(join(siteDist, 'downloads'))).sort()).toEqual([
        'extension.json',
        'nook-passwords-1.2.3.zip',
        'nook-passwords-1.2.3.zip.sha256',
      ])
      expect(
        (await readdir(join(simpleVaultDist, 'downloads'))).sort(),
      ).toEqual([
        'extension-meta-secret.json',
        'nook-passwords-meta-secret-1.2.3.zip',
        'nook-passwords-meta-secret-1.2.3.zip.sha256',
      ])
      expect(nokey).toMatchObject({
        simple_vault_url: 'https://simple.nokey.sh/',
        download_url: 'https://nokey.sh/downloads/nook-passwords-1.2.3.zip',
        install_method: ExtensionInstallMethod.ChromeWebStore,
      })
      expect(metaSecret).toMatchObject({
        simple_vault_url: 'https://simple.meta-secret.io/',
        download_url:
          'https://simple.meta-secret.io/downloads/nook-passwords-meta-secret-1.2.3.zip',
        checksum_url:
          'https://simple.meta-secret.io/downloads/nook-passwords-meta-secret-1.2.3.zip.sha256',
        install_method: ExtensionInstallMethod.ManualZip,
        install_url:
          'https://simple.meta-secret.io/downloads/nook-passwords-meta-secret-1.2.3.zip',
      })
      expect(metaSecret.extension_id).not.toBe(nokey.extension_id)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('refuses a build that pairs with another vault or several', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nook-extension-targets-'))
    const extensionDist = join(root, 'extension')
    const request: ExtensionPackageRequest = {
      extensionDist,
      siteDist: join(root, 'site'),
      simpleVaultDist: join(root, 'simple'),
      channel: ExtensionReleaseChannel.Production,
      version: '1.2.3',
      commit,
      siteUrl: 'https://nokey.sh/',
      target: metaSecretVaultTarget,
    }

    try {
      await writeBuild(
        extensionDist,
        defaultVaultTarget.simpleVaultBaseUrl,
        extensionChannelIdentity('production').manifestKey,
      )
      const vaultMismatch = packageExtensionDeployment(request)
      expect(vaultMismatch).rejects.toThrow('not the packaged vault target')
      await Promise.allSettled([vaultMismatch])
      const twoVaults = {
        manifest_version: 3,
        version: '1.2.3',
        key: extensionChannelIdentity('production').manifestKey,
        externally_connectable: {
          matches: [
            'https://simple.meta-secret.io/*',
            'https://simple.nokey.sh/*',
          ],
        },
      }
      await writeFile(
        join(extensionDist, 'manifest.json'),
        JSON.stringify(twoVaults),
      )
      const secondPairing = packageExtensionDeployment(request)
      expect(secondPairing).rejects.toThrow('exactly one Simple Vault')
      await Promise.allSettled([secondPairing])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
