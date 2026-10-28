import { fireEvent, render } from '@testing-library/svelte'
import type { ComponentProps } from 'svelte'
import { ok } from 'neverthrow'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { CredentialCheckReport } from '$app-wasm'
import { googleOAuthSession } from '$lib/auth/google/oauth'
import { AccessCheckActions } from '$lib/vault/access-check'
import { VaultStateTestFixture } from '../vault-state-test-fixture'
import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
import AccessCheckPage from '../../../../nook-web-shared/src/vault-app/lib/components/access-check/AccessCheckPage.svelte'

afterEach(() => vi.restoreAllMocks())

function renderPage() {
  const vault = VaultStateTestFixture.create()
  const onClose = vi.fn()
  const props = { vault, onClose } satisfies ComponentProps<
    typeof AccessCheckPage
  >
  return { view: render(AccessCheckPage, props), vault, onClose }
}

const passkeyOpens: CredentialCheckReport = {
  credential: { kind: 'passkey', fingerprint: 'passkey_a1b2c3d4e5f60708' },
  identity: {
    state: 'member',
    identityId: 'idn_personalide',
    words: ['amber', 'falcon', 'tide'],
    name: { state: 'named', name: 'Personal' },
  },
  vaults: [
    {
      storeId: 'store_familyvault',
      shortId: 'familyva',
      filedUnder: ['amber', 'falcon', 'tide'],
      outcome: { state: 'opens', name: { state: 'named', name: 'Family' } },
    },
    {
      storeId: 'store_othervault1',
      shortId: 'othervau',
      filedUnder: ['ripple', 'canvas', 'orbit'],
      outcome: { state: 'doesNotOpen' },
    },
  ],
}

function disabled(element: HTMLElement): boolean {
  return element.hasAttribute('disabled')
}

describe('Check access page', () => {
  test('this browser is ready at once and a passkey check lists what it opens', async () => {
    const check = vi
      .spyOn(AccessCheckActions.prototype, 'checkPasskey')
      .mockResolvedValue(ok(passkeyOpens))
    const { view, vault } = renderPage()

    expect(disabled(view.getByTestId('access-check-run'))).toBe(false)
    await fireEvent.click(view.getByTestId('access-check-run'))

    await view.findByTestId('access-check-results')
    expect(check).toHaveBeenCalledWith({ kind: 'thisBrowser' })
    const [family, other] = view.getAllByTestId('access-check-vault')
    expect(family?.textContent).toContain('Family')
    expect(other?.textContent).toContain('othervau')
    const outcomes = view
      .getAllByTestId('access-check-cell')
      .map((cell) => cell.dataset.outcome)
    expect(outcomes).toEqual(['opens', 'doesNotOpen'])
    expect(view.getByTestId('access-check-credential').textContent).toContain(
      vault.t({
        key: I18N_KEYS.AccessCheckPasskeyIdentity,
        replacements: { identity: 'Personal (amber-falcon-tide)' },
      }),
    )
  })

  test('Google Drive needs a sign-in first, and only one button is live at a time', async () => {
    const signIn = vi
      .spyOn(googleOAuthSession, 'requestGoogleAccessToken')
      .mockResolvedValue(ok({ accessToken: 'drive-token', expiresAt: '' }))
    const check = vi
      .spyOn(AccessCheckActions.prototype, 'checkPasskey')
      .mockResolvedValue(ok(passkeyOpens))
    const { view } = renderPage()

    await fireEvent.click(view.getByTestId('access-check-source-googleDrive'))
    expect(disabled(view.getByTestId('access-check-run'))).toBe(true)
    expect(disabled(view.getByTestId('access-check-drive-sign-in'))).toBe(false)

    await fireEvent.click(view.getByTestId('access-check-drive-sign-in'))
    await view.findByTestId('access-check-drive-ready')
    expect(signIn).toHaveBeenCalledOnce()
    expect(view.queryAllByTestId('access-check-drive-sign-in')).toHaveLength(0)
    expect(disabled(view.getByTestId('access-check-run'))).toBe(false)

    await fireEvent.click(view.getByTestId('access-check-run'))
    await vi.waitFor(() =>
      expect(check).toHaveBeenCalledWith({
        kind: 'googleDrive',
        accessToken: 'drive-token',
      }),
    )
  })

  test('a backup password is checked against every vault and then cleared', async () => {
    const passwordReport: CredentialCheckReport = {
      credential: { kind: 'backupPassword' },
      identity: { state: 'notAMember' },
      vaults: [
        {
          storeId: 'store_familyvault',
          shortId: 'familyva',
          filedUnder: ['amber', 'falcon', 'tide'],
          outcome: { state: 'noBackupPassword' },
        },
      ],
    }
    const check = vi
      .spyOn(AccessCheckActions.prototype, 'checkBackupPassword')
      .mockResolvedValue(ok(passwordReport))
    const { view } = renderPage()

    await fireEvent.click(view.getByTestId('access-check-method-password'))
    expect(disabled(view.getByTestId('access-check-run'))).toBe(true)
    await fireEvent.input(view.getByTestId('access-check-password'), {
      target: { value: 'correct horse battery staple' },
    })
    await fireEvent.click(view.getByTestId('access-check-run'))

    await view.findByTestId('access-check-results')
    expect(check).toHaveBeenCalledWith({
      source: { kind: 'thisBrowser' },
      password: 'correct horse battery staple',
    })
    expect(view.getByTestId('access-check-password')).toHaveProperty(
      'value',
      '',
    )
    expect(view.getByTestId('access-check-cell').dataset.outcome).toBe(
      'noBackupPassword',
    )

    await fireEvent.click(view.getByTestId('access-check-clear'))
    expect(view.queryAllByTestId('access-check-results')).toHaveLength(0)
  })
})
