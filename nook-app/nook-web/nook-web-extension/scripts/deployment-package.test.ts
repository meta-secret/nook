import { describe, expect, spyOn, test } from 'bun:test'
import { unzipSync } from 'fflate'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  extensionArchiveName,
  extensionInstallTarget,
  ExtensionInstallMethod,
  makeDeterministicZip,
  type DeterministicZipRequest,
} from './deployment-package'
import { ExtensionReleaseChannel } from './channel-identity'

describe('extension deployment archive', () => {
  test('uses predictable channel-specific names', () => {
    expect(
      extensionArchiveName(ExtensionReleaseChannel.Production, '1.2.3'),
    ).toBe('nook-passwords-1.2.3.zip')
    expect(
      extensionArchiveName(ExtensionReleaseChannel.Development, '1.2.3'),
    ).toBe('nook-passwords-dev.zip')
    expect(extensionArchiveName(ExtensionReleaseChannel.Local, '1.2.3')).toBe(
      'nook-passwords-local.zip',
    )
    expect(extensionArchiveName('pr-408', '1.2.3')).toBe(
      'nook-passwords-pr-408.zip',
    )
  })

  test('rejects unsafe production versions', () => {
    expect(() =>
      extensionArchiveName(ExtensionReleaseChannel.Production, '../latest'),
    ).toThrow()
  })

  test('sends production installs to the Chrome Web Store', () => {
    const extensionId = 'abcdefghijklmnopabcdefghijklmnop'
    expect(
      extensionInstallTarget(
        ExtensionReleaseChannel.Production,
        extensionId,
        'https://nokey.sh/downloads/nook-passwords-1.2.3.zip',
      ),
    ).toEqual({
      install_method: ExtensionInstallMethod.ChromeWebStore,
      install_url: `https://chromewebstore.google.com/detail/${extensionId}`,
    })
  })

  test('keeps non-production installs on the channel ZIP', () => {
    const downloadUrl =
      'https://pr-408.nokey-sh.pages.dev/downloads/nook-passwords-pr-408.zip'
    expect(
      extensionInstallTarget(
        'pr-408',
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
        ExtensionReleaseChannel.Production,
        'invalid',
        'https://nokey.sh/downloads/nook-passwords-1.2.3.zip',
      ),
    ).toThrow()
  })

  test('creates a stable root-manifest archive without spawning zip', async () => {
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
      const archiveResult = makeDeterministicZip(
        missingManifestArchiveRequest,
      )
      await expect(archiveResult).rejects.toThrow(
        'manifest.json at its root',
      )
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
      await expect(archiveResult).rejects.toThrow()
    } finally {
      await rm(sourceDirectory, { recursive: true, force: true })
    }
  })
})
