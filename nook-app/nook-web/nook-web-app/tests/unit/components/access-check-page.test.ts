import { fireEvent, render } from '@testing-library/svelte'
import type { ComponentProps } from 'svelte'
import { ok } from 'neverthrow'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { CredentialCheckReport } from '$app-wasm'
import { googleOAuthSession } from '$lib/auth/google/oauth'
import { OAUTH_FILE_PROVIDER_TYPE } from '$lib/auth/providers'
import {
  AccessCheckActions,
  AccessCheckTargetKind,
} from '$lib/vault/access-check'
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
  identities: [
    {
      identityId: 'idn_personalide',
      words: ['amber', 'falcon', 'tide'],
      name: { state: 'named', name: 'Personal' },
      outcome: 'opens',
      vaults: [
        {
          storeId: 'store_familyvault',
          shortId: 'familyva',
          outcome: { state: 'opens', name: { state: 'named', name: 'Family' } },
        },
      ],
    },
    {
      identityId: 'idn_otheridenti',
      words: ['ripple', 'canvas', 'orbit'],
      name: { state: 'unknown' },
      outcome: 'doesNotOpen',
      vaults: [
        {
          storeId: 'store_othervault1',
          shortId: 'othervau',
          outcome: { state: 'doesNotOpen' },
        },
      ],
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
    expect(check).toHaveBeenCalledWith({
      kind: AccessCheckTargetKind.Source,
      source: { kind: 'thisBrowser' },
    })
    // Under the checked key, one row per keyring: a passkey opens a keyring
    // with every vault it keeps, so those vaults are listed under it; a
    // keyring it does not open shows only its ID.
    const [personal, other] = view.getAllByTestId('access-check-identity')
    expect(personal?.textContent).toContain('Personal')
    expect(personal?.textContent).toContain('amber-falcon-tide')
    expect(personal?.textContent).toContain('Family')
    expect(other?.textContent).toContain('ripple-canvas-orbit')
    expect(
      other?.querySelectorAll('[data-testid="access-check-vault"]'),
    ).toHaveLength(0)
    const outcomes = view
      .getAllByTestId('access-check-identity')
      .map((row) => row.dataset.outcome)
    expect(outcomes).toEqual(['opens', 'doesNotOpen'])
    expect(view.getByTestId('access-check-credential').textContent).toContain(
      vault.t({
        key: I18N_KEYS.AccessCheckCredentialPasskey,
        replacements: { id: 'a1b2c3d4' },
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
        kind: AccessCheckTargetKind.Source,
        source: { kind: 'googleDrive', accessToken: 'drive-token' },
      }),
    )
  })

  test('a backup password opens single vaults, never the identity, and is then cleared', async () => {
    const passwordReport: CredentialCheckReport = {
      credential: { kind: 'backupPassword' },
      identities: [
        {
          identityId: 'idn_personalide',
          words: ['amber', 'falcon', 'tide'],
          name: { state: 'unknown' },
          outcome: 'vaultsOnly',
          vaults: [
            {
              storeId: 'store_familyvault',
              shortId: 'familyva',
              outcome: {
                state: 'opens',
                name: { state: 'named', name: 'Family' },
              },
            },
          ],
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
      target: {
        kind: AccessCheckTargetKind.Source,
        source: { kind: 'thisBrowser' },
      },
      password: 'correct horse battery staple',
    })
    expect(view.getByTestId('access-check-password')).toHaveProperty(
      'value',
      '',
    )
    expect(view.getByTestId('access-check-identity').dataset.outcome).toBe(
      'vaultsOnly',
    )
    expect(view.getByTestId('access-check-vault').textContent).toContain(
      'Family',
    )

    await fireEvent.click(view.getByTestId('access-check-clear'))
    expect(view.queryAllByTestId('access-check-results')).toHaveLength(0)
  })
})

describe('Check access sources', () => {
  test('the connected sync provider is a source only for an unlocked session', async () => {
    const check = vi
      .spyOn(AccessCheckActions.prototype, 'checkPasskey')
      .mockResolvedValue(ok(passkeyOpens))
    const { view, vault } = renderPage()
    expect(
      view.queryAllByTestId('access-check-source-currentProvider'),
    ).toHaveLength(0)

    vault.isAuthenticated = true
    vault.storageMode = OAUTH_FILE_PROVIDER_TYPE
    await fireEvent.click(
      await view.findByTestId('access-check-source-currentProvider'),
    )
    await fireEvent.click(view.getByTestId('access-check-run'))

    await vi.waitFor(() =>
      expect(check).toHaveBeenCalledWith({
        kind: AccessCheckTargetKind.CurrentProvider,
      }),
    )
  })

  test('each check gets its own card, in the order the checks ran', async () => {
    vi.spyOn(AccessCheckActions.prototype, 'checkPasskey').mockResolvedValue(
      ok(passkeyOpens),
    )
    const { view } = renderPage()

    await fireEvent.click(view.getByTestId('access-check-run'))
    await view.findByTestId('access-check-checks')
    await fireEvent.click(view.getByTestId('access-check-run'))

    await vi.waitFor(() =>
      expect(view.getAllByTestId('access-check-credential')).toHaveLength(2),
    )
    const [first, second] = view.getAllByTestId('access-check-credential')
    for (const card of [first, second])
      expect(
        card?.querySelectorAll('[data-testid="access-check-identity"]'),
      ).toHaveLength(2)
  })
})
