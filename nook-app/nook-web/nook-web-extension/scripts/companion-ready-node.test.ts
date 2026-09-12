import { mkdtempSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, test } from 'bun:test'

const extensionRoot = process.cwd()
const companionReadyPath = resolve(
  extensionRoot,
  '../nook-web-shared/src/extension/companion-ready.ts',
)
const extensionConnectScopePath = resolve(
  extensionRoot,
  '../nook-web-shared/src/extension/extension-connect-scope.ts',
)
const companionWasmPath = resolve(
  extensionRoot,
  '../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm_bg.wasm',
)
const companionProbeSource = String.raw`
globalThis.fetch = Object.assign(
  async (..._args: Parameters<typeof fetch>) => {
    void _args
    throw new Error('unexpected companion WASM fetch')
  },
  { preconnect: fetch.preconnect },
)

const { companionWasmReady } =
  await import(${JSON.stringify(companionReadyPath)})
const { ExtensionConnectScope } =
  await import(${JSON.stringify(extensionConnectScopePath)})
await companionWasmReady

const scopeValues = [
  ExtensionConnectScope.VaultAccess,
  ExtensionConnectScope.PasswordFilling,
  ExtensionConnectScope.PasskeyManagement,
  ExtensionConnectScope.SyncProviderCredentials,
]
if (
  !scopeValues.every((value) =>
    ExtensionConnectScope.isExtensionConnectScopeValue(value),
  )
) {
  throw new Error('companion scope runtime was not configured')
}
console.log(JSON.stringify(scopeValues))
`

describe('companion WASM Node host loading', () => {
  test('resolves readiness from the explicit disk path without fetch', () => {
    const probeDirectory = mkdtempSync(
      join(tmpdir(), 'nook-companion-ready-node-'),
    )
    const companionProbePath = join(
      probeDirectory,
      'companion-ready-node-probe.ts',
    )
    const bundlePath = join(probeDirectory, 'companion-ready-node-probe.mjs')
    writeFileSync(companionProbePath, companionProbeSource)
    const bundle = spawnSync(
      'bun',
      ['build', companionProbePath, '--target=node', '--outfile', bundlePath],
      { encoding: 'utf8', cwd: extensionRoot },
    )
    expect(bundle.status).toBe(0)
    expect(bundle.error).toBeUndefined()

    const result = spawnSync('node', [bundlePath], {
      encoding: 'utf8',
      cwd: extensionRoot,
      env: {
        ...process.env,
        NOOK_COMPANION_WASM_PATH: companionWasmPath,
      },
    })

    expect(result.status).toBe(0)
    expect(result.error).toBeUndefined()
    expect(result.stdout).toContain('vault-access')
    expect(result.stderr).not.toContain('unexpected companion WASM fetch')
  })
})
