import {
  spawnSync,
  type SpawnSyncOptionsWithStringEncoding,
} from 'node:child_process'
import { describe, expect, test } from 'vitest'
import { LogLevel } from '$lib/runtime/log-level'

const appRoot = new URL('../../../', import.meta.url).pathname
const importProcessOptions: SpawnSyncOptionsWithStringEncoding = {
  cwd: appRoot,
  encoding: 'utf8',
}

function importWithoutViteAliases(modulePath: string) {
  const importArguments = ['-e', `await import('${modulePath}')`]
  const importProcess = spawnSync(
    process.execPath,
    importArguments,
    importProcessOptions,
  )
  return { exitCode: importProcess.status, stderr: importProcess.stderr }
}

describe('Playwright collection imports', () => {
  test('shares the canonical trace transport without loading WASM', () => {
    expect(LogLevel.Trace).toBe('trace')
  })

  test('loads the app-log helper without browser-only Vite aliases', () => {
    const result = importWithoutViteAliases('./e2e/helpers/app-logs.ts')
    expect(result.exitCode).toBe(0)
    expect(result.stderr).not.toContain("Cannot find package '$app-wasm'")
  })
})
