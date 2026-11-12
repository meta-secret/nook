import { companionWasmReady } from '../../nook-web-shared/src/extension/companion-ready'

await companionWasmReady
import { afterEach, describe, expect, test } from 'bun:test'
import { ExtensionPackageDistribution } from '../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  ExtensionPackageHost,
  extensionPackageHost,
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
  test('nokey is the store-distributed site package with the channel identity', () => {
    const target = resolveExtensionVaultTarget('nokey')
    expect(target).toEqual({
      simpleVaultBaseUrl: 'https://simple.nokey.sh/',
      downloadsSuffix: '',
      metadataFileName: 'extension.json',
      distribution: ExtensionPackageDistribution.StoreOnProductionChannel,
      identityScope: { kind: 'channelIdentity' },
    })
    expect(extensionPackageHost(target)).toBe(ExtensionPackageHost.Site)
  })

  test('meta-secret is a manual ZIP the Simple vault serves under its own identity', () => {
    for (const input of ['meta-secret', 'https://simple.meta-secret.io']) {
      const target = resolveExtensionVaultTarget(input)
      expect(target).toEqual({
        simpleVaultBaseUrl: 'https://simple.meta-secret.io/',
        downloadsSuffix: '-meta-secret',
        metadataFileName: 'extension-meta-secret.json',
        distribution: ExtensionPackageDistribution.ManualZip,
        identityScope: {
          kind: 'vaultIdentity',
          seedQualifier: 'meta-secret',
          displayQualifier: 'meta-secret.io',
        },
      })
      expect(extensionPackageHost(target)).toBe(
        ExtensionPackageHost.SimpleVault,
      )
    }
  })

  test('localhost and explicit URLs keep the default package names and identity', () => {
    for (const [input, simpleVaultBaseUrl] of [
      ['localhost', 'https://localhost:5173/'],
      [
        'https://pr-408.nokey-simple.pages.dev',
        'https://pr-408.nokey-simple.pages.dev/',
      ],
      ['http://127.0.0.1:5174/', 'http://127.0.0.1:5174/'],
    ]) {
      const target = resolveExtensionVaultTarget(input)
      expect(target.simpleVaultBaseUrl).toBe(simpleVaultBaseUrl)
      expect(target.metadataFileName).toBe('extension.json')
      expect(target.identityScope).toEqual({ kind: 'channelIdentity' })
      expect(extensionPackageHost(target)).toBe(ExtensionPackageHost.Site)
    }
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
})
