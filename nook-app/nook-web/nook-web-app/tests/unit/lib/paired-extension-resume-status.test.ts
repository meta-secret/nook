import { describe, expect, test, vi } from 'vitest'

/** The session's explicit-lock mark lives in browser session storage, which
 * the WASM build cannot reach here; the policy deciding on it is real. */
const sessionExplicitlyLocked = vi.hoisted(() => vi.fn<() => boolean>())

vi.mock('$app-wasm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$app-wasm')>()),
  is_vault_session_locked: sessionExplicitlyLocked,
}))

import { NookVaultClientPolicy } from '$app-wasm'
import { ExtensionPairedVaultIdentityStatusMessageStatus as Status } from '$web-shared/extension/paired-vault-identity-status'
import {
  pairedExtensionAutoResumeHeld,
  pairedResumeStatusWhileBusy,
  pairedResumeStatusWhileRetrying,
} from '$lib/app/paired-extension-unlock-delivery'

describe('paired extension auto resume', () => {
  test('an explicit lock keeps the page locked while the extension is unlocked', () => {
    sessionExplicitlyLocked.mockReturnValue(true)

    expect(pairedExtensionAutoResumeHeld(new NookVaultClientPolicy())).toBe(
      true,
    )
  })

  test('a page never locked by hand resumes from the extension', () => {
    sessionExplicitlyLocked.mockReturnValue(false)

    expect(pairedExtensionAutoResumeHeld(new NookVaultClientPolicy())).toBe(
      false,
    )
  })
})

describe('paired extension resume status', () => {
  test('while another flow owns the vault, a different vault reads as unavailable', () => {
    expect(pairedResumeStatusWhileBusy(Status.DifferentVault)).toBe(
      Status.Unavailable,
    )
    expect(pairedResumeStatusWhileBusy(Status.Locked)).toBe(Status.Locked)
    expect(pairedResumeStatusWhileBusy(Status.Unlocked)).toBe(Status.Unlocked)
    expect(pairedResumeStatusWhileBusy(Status.Unavailable)).toBe(
      Status.Unavailable,
    )
  })

  test('while retrying, only a locked extension reads as locked', () => {
    expect(pairedResumeStatusWhileRetrying(Status.Locked)).toBe(Status.Locked)
    expect(pairedResumeStatusWhileRetrying(Status.DifferentVault)).toBe(
      Status.Unavailable,
    )
    expect(pairedResumeStatusWhileRetrying(Status.Unavailable)).toBe(
      Status.Unavailable,
    )
  })
})
