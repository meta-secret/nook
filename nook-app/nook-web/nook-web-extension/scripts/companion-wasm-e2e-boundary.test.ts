import { mkdtempSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, test } from 'bun:test'

const extensionRoot = process.cwd()
const companionReadyHelperPath = resolve(
  extensionRoot,
  'e2e/helpers/companion-wasm-ready.ts',
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
globalThis.fetch = async () => {
  throw new Error('unexpected companion WASM network fetch')
}

const { companionWasmReady } =
  await import(${JSON.stringify(companionReadyHelperPath)})
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

describe('Node-hosted extension E2E WASM setup', () => {
  test('initializes shared readiness from the test host bytes', () => {
    const probeDirectory = mkdtempSync(
      join(tmpdir(), 'nook-companion-wasm-e2e-'),
    )
    const companionProbePath = join(
      probeDirectory,
      'companion-wasm-e2e-probe.ts',
    )
    const bundlePath = join(probeDirectory, 'companion-wasm-e2e-probe.mjs')
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
        NOOK_EXTENSION_E2E_WASM_PATH: companionWasmPath,
      },
    })

    expect(result.status).toBe(0)
    expect(result.error).toBeUndefined()
    expect(result.stdout).toContain('vault-access')
    expect(result.stderr).not.toContain(
      'unexpected companion WASM network fetch',
    )
  })
})
