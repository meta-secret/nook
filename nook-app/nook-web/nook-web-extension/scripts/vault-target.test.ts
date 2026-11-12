import { companionWasmReady } from '../../nook-web-shared/src/extension/companion-ready'

await companionWasmReady
import { afterEach, describe, expect, test } from 'bun:test'
import {
  ExtensionVaultDownloadsKind,
  extensionMetadataFileName,
  extensionVaultTargetFromEnvironment,
  resolveExtensionVaultTarget,
} from './vault-target'

const savedVaultInput = process.env.NOOK_EXTENSION_VAULT

afterEach(() => {
  if (typeof savedVaultInput === 'string') {
    process.env.NOOK_EXTENSION_VAULT = savedVaultInput
  } else {
    Reflect.deleteProperty(process.env, 'NOOK_EXTENSION_VAULT')
  }
})

describe('extension vault target input', () => {
  test('each known name selects its Simple vault', () => {
    expect(resolveExtensionVaultTarget('nokey')).toEqual({
      simpleVaultBaseUrl: 'https://simple.nokey.sh/',
      downloads: { kind: ExtensionVaultDownloadsKind.Default },
    })
    expect(resolveExtensionVaultTarget('meta-secret')).toEqual({
      simpleVaultBaseUrl: 'https://simple.meta-secret.io/',
      downloads: {
        kind: ExtensionVaultDownloadsKind.Named,
        name: 'meta-secret',
      },
    })
    expect(resolveExtensionVaultTarget('localhost')).toEqual({
      simpleVaultBaseUrl: 'https://localhost:5173/',
      downloads: { kind: ExtensionVaultDownloadsKind.Named, name: 'localhost' },
    })
  })

  test('an absolute URL selects that Simple vault under the default download names', () => {
    expect(
      resolveExtensionVaultTarget('https://pr-408.nokey-simple.pages.dev'),
    ).toEqual({
      simpleVaultBaseUrl: 'https://pr-408.nokey-simple.pages.dev/',
      downloads: { kind: ExtensionVaultDownloadsKind.Default },
    })
    expect(
      resolveExtensionVaultTarget('http://127.0.0.1:5174/').simpleVaultBaseUrl,
    ).toBe('http://127.0.0.1:5174/')
  })

  test('an absent, empty, or blank input selects the nokey vault', () => {
    for (const input of ['', '  ']) {
      expect(resolveExtensionVaultTarget(input)).toEqual(
        resolveExtensionVaultTarget('nokey'),
      )
    }
    Reflect.deleteProperty(process.env, 'NOOK_EXTENSION_VAULT')
    expect(extensionVaultTargetFromEnvironment().simpleVaultBaseUrl).toBe(
      'https://simple.nokey.sh/',
    )
    process.env.NOOK_EXTENSION_VAULT = ''
    expect(extensionVaultTargetFromEnvironment().simpleVaultBaseUrl).toBe(
      'https://simple.nokey.sh/',
    )
  })

  test('the environment input selects the build target', () => {
    process.env.NOOK_EXTENSION_VAULT = 'meta-secret'
    expect(extensionVaultTargetFromEnvironment().simpleVaultBaseUrl).toBe(
      'https://simple.meta-secret.io/',
    )
  })

  test('an unknown name fails with the known names', () => {
    for (const input of ['prod', 'Nokey', 'simple.nokey.sh']) {
      expect(() => resolveExtensionVaultTarget(input)).toThrow(
        `Unknown Simple vault target "${input}": use one of nokey, meta-secret, localhost, or an absolute Simple vault URL.`,
      )
    }
  })

  test('only a named non-default target suffixes its metadata file', () => {
    expect(extensionMetadataFileName(resolveExtensionVaultTarget(''))).toBe(
      'extension.json',
    )
    expect(
      extensionMetadataFileName(
        resolveExtensionVaultTarget('https://simple.dev.nokey.sh/'),
      ),
    ).toBe('extension.json')
    expect(
      extensionMetadataFileName(resolveExtensionVaultTarget('meta-secret')),
    ).toBe('extension-meta-secret.json')
  })
})
