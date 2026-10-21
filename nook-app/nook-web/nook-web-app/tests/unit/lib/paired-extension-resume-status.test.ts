import { describe, expect, test } from 'vitest'
import { ExtensionPairedVaultIdentityStatusMessageStatus as Status } from '$web-shared/extension/paired-vault-identity-status'
import {
  pairedResumeStatusWhileBusy,
  pairedResumeStatusWhileRetrying,
} from '$lib/app/paired-extension-unlock-delivery'

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
