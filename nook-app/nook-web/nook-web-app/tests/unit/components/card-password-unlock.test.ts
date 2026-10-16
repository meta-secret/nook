import { fireEvent, render } from '@testing-library/svelte'
import type { ComponentProps } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { VaultStateTestFixture } from '../vault-state-test-fixture'
import CardPasswordUnlock from '../../../../nook-web-shared/src/vault-app/lib/components/identities/CardPasswordUnlock.svelte'

afterEach(() => vi.restoreAllMocks())

function renderWithPassphrases() {
  const vault = VaultStateTestFixture.create()
  const onUnlock = vi.fn()
  const props = {
    vault,
    vaultLabel: 'qq',
    entries: [
      { id: 'password_qq', label: 'qq' },
      { id: 'password_ww', label: 'ww' },
    ],
    isVerifying: false,
    onUnlock,
  } satisfies ComponentProps<typeof CardPasswordUnlock>
  return { view: render(CardPasswordUnlock, props), onUnlock }
}

describe('card passphrase unlock', () => {
  test('starts with the first passphrase chosen, never a blank choice', () => {
    const { view } = renderWithPassphrases()

    expect(view.getAllByRole('radio')).toHaveLength(2)
    expect(view.getByRole('radio', { name: 'qq', checked: true })).toBeTruthy()
    expect(view.getByRole('radio', { name: 'ww', checked: false })).toBeTruthy()
  })

  test('unlocks with the passphrase the user picks', async () => {
    const { view, onUnlock } = renderWithPassphrases()

    await fireEvent.click(view.getByRole('radio', { name: 'ww' }))
    await fireEvent.input(view.getByTestId('card-password-input'), {
      target: { value: 'ww-secret' },
    })
    await fireEvent.click(view.getByTestId('card-password-submit'))

    expect(onUnlock).toHaveBeenCalledWith({
      entryId: 'password_ww',
      password: 'ww-secret',
    })
  })
})
