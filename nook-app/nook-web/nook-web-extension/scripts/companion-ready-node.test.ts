import { mkdtempSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, test } from 'bun:test'

const extensionRoot = process.cwd()
const companionProbePath = resolve(
  extensionRoot,
  'scripts/companion-ready-node-probe.ts',
)
const companionWasmPath = resolve(
  extensionRoot,
  '../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm_bg.wasm',
)

describe('companion WASM Node host loading', () => {
  test('resolves readiness from the explicit disk path without fetch', () => {
    const bundlePath = join(
      mkdtempSync(join(tmpdir(), 'nook-companion-ready-node-')),
      'companion-ready-node-probe.mjs',
    )
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
