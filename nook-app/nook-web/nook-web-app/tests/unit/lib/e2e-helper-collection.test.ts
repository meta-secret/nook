import { describe, expect, test } from 'vitest'
import { LogLevel } from '$lib/runtime/log-level'

const appRoot = new URL('../../../', import.meta.url).pathname

async function importWithoutViteAliases(modulePath: string) {
  const importProcess = Bun.spawn({
    cmd: [process.execPath, '-e', `await import('${modulePath}')`],
    cwd: appRoot,
    stdout: 'ignore',
    stderr: 'pipe',
  })
  const stderr = await new Response(importProcess.stderr).text()
  return { exitCode: await importProcess.exited, stderr }
}

describe('Playwright collection imports', () => {
  test('shares the canonical trace transport without loading WASM', () => {
    expect(LogLevel.Trace).toBe('trace')
  })

  test('loads the app-log helper without browser-only Vite aliases', async () => {
    const result = await importWithoutViteAliases('./e2e/helpers/app-logs.ts')
    expect(result.exitCode).toBe(0)
    expect(result.stderr).not.toContain("Cannot find package '$app-wasm'")
  })
})
