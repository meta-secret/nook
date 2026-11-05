import { afterEach, describe, expect, test, vi } from 'vitest'
import { ok } from 'neverthrow'
import { NookVaultManager } from '$app-wasm'
import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
import {
  AccessCheckActions,
  AccessCheckTargetKind,
} from '$lib/vault/access-check'
import { VaultStateTestFixture } from '../vault-state-test-fixture'

afterEach(() => vi.restoreAllMocks())

/** A passkey check at the connected provider, whose read fails. */
class FailingCheck {
  readonly vault = VaultStateTestFixture.create()
  readonly manager = new NookVaultManager()

  constructor(refusal: Error) {
    vi.spyOn(this.vault, 'admitManager').mockReturnValue(ok(this.manager))
    VaultStateTestFixture.runStorageImmediately(this.vault)
    vi.spyOn(this.manager, 'check_passkey_access_from').mockRejectedValue(
      refusal,
    )
  }

  run() {
    return new AccessCheckActions(this.vault).checkPasskey({
      kind: AccessCheckTargetKind.CurrentProvider,
    })
  }
}

describe('a check the connected provider refused', () => {
  test('a refused S3 key says what to check instead of a bare failure', async () => {
    // Every export but the assessment rejects with the key in its message.
    const check = new FailingCheck(new Error(I18N_KEYS.ErrorsS3KeyAccessDenied))

    const checked = await check.run()

    expect(checked.isErr()).toBe(true)
    if (checked.isOk()) return
    expect(checked.error.translationKey).toBe(I18N_KEYS.ErrorsS3KeyAccessDenied)
  })

  test('any other failure keeps the check failure it was', async () => {
    const check = new FailingCheck(
      new Error('S3 request failed with status 503'),
    )

    const checked = await check.run()

    expect(checked.isErr()).toBe(true)
    if (checked.isOk()) return
    expect(checked.error.translationKey).toBe(
      I18N_KEYS.AccessCheckPasskeyFailed,
    )
  })
})
