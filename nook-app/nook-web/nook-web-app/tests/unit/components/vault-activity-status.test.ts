import { render } from '@testing-library/svelte'
import type { ComponentProps } from 'svelte'
import { describe, expect, test } from 'vitest'
import { VaultStateTestFixture } from '../vault-state-test-fixture'
import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
import { VaultActivityKind } from '$lib/vault/vault-activity'
import VaultActivityStatus from '../../../../nook-web-shared/src/vault-app/lib/components/identities/VaultActivityStatus.svelte'

function renderStatus(
  configure: (vault: ReturnType<typeof VaultStateTestFixture.create>) => void,
) {
  const vault = VaultStateTestFixture.create()
  vault.isVerifying = false
  vault.isSaving = false
  vault.isSyncing = false
  configure(vault)
  const props = { vault } satisfies ComponentProps<typeof VaultActivityStatus>
  return { vault, view: render(VaultActivityStatus, props) }
}

describe('identity vault activity', () => {
  test('says a sync is running and that the page may pause', () => {
    const { vault, view } = renderStatus((state) => {
      state.isSyncing = true
    })

    const status = view.getByRole('status')
    expect(status.dataset.activity).toBe(VaultActivityKind.Syncing)
    expect(status.textContent).toContain(
      vault.t(I18N_KEYS.WorkspaceVaultActivitySyncing),
    )
    expect(status.textContent).toContain(
      vault.t(I18N_KEYS.WorkspaceVaultActivityHint),
    )
  })

  test('names vault changes as work, even while a sync also runs', () => {
    const { vault, view } = renderStatus((state) => {
      state.isVerifying = true
      state.isSyncing = true
    })

    const status = view.getByRole('status')
    expect(status.dataset.activity).toBe(VaultActivityKind.Working)
    expect(status.textContent).toContain(
      vault.t(I18N_KEYS.WorkspaceVaultActivityWorking),
    )
  })

  test('shows nothing while the vault is idle', () => {
    const { view } = renderStatus(() => {})

    expect(view.queryAllByTestId('identity-vault-activity')).toHaveLength(0)
  })
})
