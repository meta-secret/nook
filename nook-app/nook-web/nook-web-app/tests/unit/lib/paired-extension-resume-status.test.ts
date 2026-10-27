import { describe, expect, test, vi } from 'vitest'
import { ok } from 'neverthrow'

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
  PairedExtensionResumeQueue,
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

describe('paired extension resume queue', () => {
  type Resume = ReturnType<PairedExtensionResumeQueue['run']>
  type ResumeOutcome = Awaited<Resume>

  /** A resume that hands its identity over until the test ends it. */
  function pendingResume(): {
    readonly start: () => Resume
    readonly started: () => boolean
    readonly finish: (outcome: ResumeOutcome) => void
    readonly fail: (failure: Error) => void
  } {
    let started = false
    let finish: (outcome: ResumeOutcome) => void = () => {}
    let fail: (failure: Error) => void = () => {}
    const handoff = new Promise<ResumeOutcome>((resolve, reject) => {
      finish = resolve
      fail = reject
    })
    return {
      start: () => {
        started = true
        return handoff
      },
      started: () => started,
      finish: (outcome) => finish(outcome),
      fail: (failure) => fail(failure),
    }
  }

  test('a resume asked for during a handoff discovers only once that handoff ends', async () => {
    const queue = new PairedExtensionResumeQueue()
    const cardUnlock = pendingResume()
    const pageResume = pendingResume()

    const cardOutcome = queue.run(cardUnlock.start)
    const pageOutcome = queue.run(pageResume.start)
    await Promise.resolve()

    expect(cardUnlock.started()).toBe(true)
    expect(pageResume.started()).toBe(false)

    cardUnlock.finish(ok(Status.Unlocked))
    expect(await cardOutcome).toEqual(ok(Status.Unlocked))
    await vi.waitFor(() => expect(pageResume.started()).toBe(true))

    pageResume.finish(ok(Status.Unlocked))
    expect(await pageOutcome).toEqual(ok(Status.Unlocked))
  })

  test('a resume that throws reaches its caller and still lets the next one run', async () => {
    const queue = new PairedExtensionResumeQueue()
    const failing = pendingResume()
    const next = pendingResume()

    const failed = queue.run(failing.start)
    const following = queue.run(next.start)
    failing.fail(new Error('extension messaging failed'))

    await expect(failed).rejects.toThrow('extension messaging failed')
    await vi.waitFor(() => expect(next.started()).toBe(true))
    next.finish(ok(Status.Locked))
    expect(await following).toEqual(ok(Status.Locked))
  })
})
