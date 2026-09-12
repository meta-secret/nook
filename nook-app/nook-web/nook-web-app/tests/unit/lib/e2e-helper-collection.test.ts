import {
  spawnSync,
  type SpawnSyncOptionsWithStringEncoding,
} from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { LogLevel } from '$lib/runtime/log-level'
import { deviceProtectionAuthorizationGateState } from '../../../e2e/helpers/settings-auth'

const appRoot = process.cwd()
const importProcessOptions: SpawnSyncOptionsWithStringEncoding = {
  cwd: appRoot,
  encoding: 'utf8',
}

class PlaywrightCollectorProbe {
  static importWithoutViteAliases(modulePath: string) {
    const bunInstallRoot = process.env.BUN_INSTALL
    if (!bunInstallRoot) {
      return {
        cwdExists: existsSync(appRoot),
        executableExists: false,
        exitCode: -1,
        errorCode: 'BUN_INSTALL_MISSING',
        errorMessage: 'BUN_INSTALL is not configured',
        signal: '',
        stderr: '',
      }
    }
    const bunExecutable = resolve(bunInstallRoot, 'bin', 'bun')
    const importArguments = ['-e', `await import('${modulePath}')`]
    const importProcess = spawnSync(
      bunExecutable,
      importArguments,
      importProcessOptions,
    )
    const launchError = importProcess.error
    const errorCode =
      launchError &&
      'code' in launchError &&
      typeof launchError.code === 'string'
        ? launchError.code
        : ''
    return {
      cwdExists: existsSync(appRoot),
      executableExists: existsSync(bunExecutable),
      exitCode:
        typeof importProcess.status === 'number' ? importProcess.status : -1,
      errorCode,
      errorMessage: launchError ? launchError.message : '',
      signal: importProcess.signal ? importProcess.signal : '',
      stderr: importProcess.stderr,
    }
  }
}

describe('Playwright collection imports', () => {
  test('recognizes a ready device-protection authorization action', () => {
    expect(
      deviceProtectionAuthorizationGateState({
        overlayVisible: false,
        unlockVisible: false,
        pickerVisible: false,
        lockedAccessVisible: false,
        authorizeReady: true,
        workspaceUnlocked: false,
      }),
    ).toBe('authorize')
  })

  test('shares the canonical trace transport without loading WASM', () => {
    expect(LogLevel.Trace).toBe('trace')
  })

  test('loads the app-log helper without browser-only Vite aliases', () => {
    const result = PlaywrightCollectorProbe.importWithoutViteAliases(
      './e2e/helpers/app-logs.ts',
    )
    expect(result.cwdExists).toBe(true)
    expect(result.executableExists).toBe(true)
    expect(result.errorCode).toBe('')
    expect(result.errorMessage).toBe('')
    expect(result.signal).toBe('')
    expect(result.exitCode).toBe(0)
    expect(result.stderr).not.toContain("Cannot find package '$app-wasm'")
  })
})
