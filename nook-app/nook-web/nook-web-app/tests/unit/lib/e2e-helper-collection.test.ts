// @vitest-environment node

import {
  spawnSync,
  type SpawnSyncOptionsWithStringEncoding,
} from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { LogLevel } from '$lib/runtime/log-level'
import {
  deviceProtectionAuthorizationGateState,
  DeviceProtectionAuthorizationGateState,
  DeviceProtectionPostUnlockGate,
} from '../../../e2e/helpers/settings-auth'

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
        unlockReady: false,
        pickerVisible: false,
        lockedAccessVisible: false,
        authorizeReady: true,
        vaultAuthenticated: false,
        workspaceUnlocked: false,
      }),
    ).toBe(DeviceProtectionAuthorizationGateState.Authorize)
  })

  test('does not treat a disabled login unlock action as ready', () => {
    expect(
      deviceProtectionAuthorizationGateState({
        overlayVisible: false,
        unlockReady: false,
        pickerVisible: false,
        lockedAccessVisible: false,
        authorizeReady: false,
        vaultAuthenticated: false,
        workspaceUnlocked: false,
      }),
    ).toBe(DeviceProtectionAuthorizationGateState.Waiting)
    expect(
      deviceProtectionAuthorizationGateState({
        overlayVisible: false,
        unlockReady: true,
        pickerVisible: false,
        lockedAccessVisible: false,
        authorizeReady: false,
        vaultAuthenticated: false,
        workspaceUnlocked: false,
      }),
    ).toBe(DeviceProtectionAuthorizationGateState.Unlock)
  })

  test('recognizes the authenticated workspace after passkey unlock starts loadDb', () => {
    const passkeyUnlocking = {
      overlayVisible: true,
      unlockReady: false,
      pickerVisible: false,
      lockedAccessVisible: false,
      authorizeReady: false,
      vaultAuthenticated: false,
      workspaceUnlocked: false,
    }
    expect(deviceProtectionAuthorizationGateState(passkeyUnlocking)).toBe(
      DeviceProtectionAuthorizationGateState.Overlay,
    )

    expect(
      deviceProtectionAuthorizationGateState({
        ...passkeyUnlocking,
        vaultAuthenticated: true,
      }),
    ).toBe(DeviceProtectionAuthorizationGateState.Unlocked)
  })

  test('waits through the passkey overlay while login unlock hands off device authorization', () => {
    const gate = new DeviceProtectionPostUnlockGate({
      loginGateVisible: true,
      authenticatedShellVisible: false,
      vaultAuthenticated: false,
      overlayVisible: true,
      authorizeReady: false,
      unlockReady: false,
      pickerVisible: false,
      errorVisible: false,
    })

    expect(gate.state()).toBe(DeviceProtectionAuthorizationGateState.Waiting)
  })

  test('keeps an error-only transient post-unlock observation waiting', () => {
    const gate = new DeviceProtectionPostUnlockGate({
      loginGateVisible: true,
      authenticatedShellVisible: false,
      vaultAuthenticated: false,
      overlayVisible: false,
      authorizeReady: false,
      unlockReady: false,
      pickerVisible: false,
      errorVisible: true,
    })

    expect(gate.state()).toBe(DeviceProtectionAuthorizationGateState.Waiting)
  })

  test('recognizes the terminal post-unlock states around device authorization', () => {
    expect(
      new DeviceProtectionPostUnlockGate({
        loginGateVisible: false,
        authenticatedShellVisible: true,
        vaultAuthenticated: false,
        overlayVisible: false,
        authorizeReady: false,
        unlockReady: false,
        pickerVisible: false,
        errorVisible: false,
      }).state(),
    ).toBe(DeviceProtectionAuthorizationGateState.Unlocked)
    expect(
      new DeviceProtectionPostUnlockGate({
        loginGateVisible: true,
        authenticatedShellVisible: false,
        vaultAuthenticated: false,
        overlayVisible: false,
        authorizeReady: true,
        unlockReady: false,
        pickerVisible: false,
        errorVisible: false,
      }).state(),
    ).toBe(DeviceProtectionAuthorizationGateState.Authorize)
    expect(
      new DeviceProtectionPostUnlockGate({
        loginGateVisible: true,
        authenticatedShellVisible: false,
        vaultAuthenticated: false,
        overlayVisible: false,
        authorizeReady: false,
        unlockReady: true,
        pickerVisible: false,
        errorVisible: false,
      }).state(),
    ).toBe(DeviceProtectionAuthorizationGateState.Unlock)
    expect(
      new DeviceProtectionPostUnlockGate({
        loginGateVisible: true,
        authenticatedShellVisible: false,
        vaultAuthenticated: false,
        overlayVisible: false,
        authorizeReady: false,
        unlockReady: false,
        pickerVisible: true,
        errorVisible: false,
      }).state(),
    ).toBe(DeviceProtectionAuthorizationGateState.Picker)
    expect(
      new DeviceProtectionPostUnlockGate({
        loginGateVisible: true,
        authenticatedShellVisible: false,
        vaultAuthenticated: false,
        overlayVisible: false,
        authorizeReady: false,
        unlockReady: true,
        pickerVisible: false,
        errorVisible: true,
      }).state(),
    ).toBe(DeviceProtectionAuthorizationGateState.Unlock)
    expect(
      new DeviceProtectionPostUnlockGate({
        loginGateVisible: true,
        authenticatedShellVisible: false,
        vaultAuthenticated: false,
        overlayVisible: false,
        authorizeReady: false,
        unlockReady: false,
        pickerVisible: false,
        errorVisible: false,
      }).state(),
    ).toBe(DeviceProtectionAuthorizationGateState.Waiting)
  })

  test('recognizes the current authenticated session despite a visible load error', () => {
    const gate = new DeviceProtectionPostUnlockGate({
      loginGateVisible: true,
      authenticatedShellVisible: false,
      vaultAuthenticated: true,
      overlayVisible: false,
      authorizeReady: false,
      unlockReady: false,
      pickerVisible: false,
      errorVisible: true,
    })

    expect(gate.state()).toBe(DeviceProtectionAuthorizationGateState.Unlocked)
  })

  test('recognizes the authenticated workspace after the login gate remounts', () => {
    const gate = new DeviceProtectionPostUnlockGate({
      loginGateVisible: false,
      authenticatedShellVisible: true,
      vaultAuthenticated: false,
      overlayVisible: false,
      authorizeReady: false,
      unlockReady: false,
      pickerVisible: false,
      errorVisible: false,
    })

    expect(gate.state()).toBe(DeviceProtectionAuthorizationGateState.Unlocked)
  })

  test('acts on an enabled device authorization button while the overlay is visible', () => {
    const gate = new DeviceProtectionPostUnlockGate({
      loginGateVisible: true,
      authenticatedShellVisible: false,
      vaultAuthenticated: false,
      overlayVisible: true,
      authorizeReady: true,
      unlockReady: false,
      pickerVisible: false,
      errorVisible: false,
    })

    expect(gate.state()).toBe(DeviceProtectionAuthorizationGateState.Authorize)
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
