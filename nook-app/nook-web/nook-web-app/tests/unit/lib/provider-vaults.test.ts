import { fireEvent, render } from '@testing-library/svelte'
import { err, ok } from 'neverthrow'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { ProviderVaultSummary } from '$app-wasm'
import {
  VaultStorageFailure,
  VaultStorageFailureKind,
} from '$lib/runtime/storage-failure'
import { IdentityActionOutcome } from '$lib/vault/identity-control.svelte'
import {
  EmptyVaultReplacementKind,
  ProviderVaultActions,
  ProviderVaultImportStart,
} from '$lib/vault/provider-vaults'
import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
import RemoteVaultChoice from '../../../../nook-web-shared/src/vault-app/lib/components/login/RemoteVaultChoice.svelte'
import { VaultStateTestFixture } from '../vault-state-test-fixture'

afterEach(() => vi.restoreAllMocks())

const EMPTY = 'store_localvault1'
const CHOSEN = 'store_othervault1'

function unlockedOn(storeId: string) {
  const vault = VaultStateTestFixture.create()
  vault.isAuthenticated = true
  vault.openActiveVault(storeId)
  return vault
}

describe('provider vault actions', () => {
  test('a closed device reports no open vault to replace', () => {
    const vault = VaultStateTestFixture.create()
    expect(new ProviderVaultActions(vault).localVaultOccupancy()).toEqual({
      state: 'closed',
    })
  })

  test('an unlocked device reports its open vault for Rust to judge', () => {
    const vault = unlockedOn(EMPTY)
    vault.secretTotal = 3
    expect(new ProviderVaultActions(vault).localVaultOccupancy()).toEqual({
      state: 'open',
      storeId: EMPTY,
      itemCount: 3,
      identityAppCount: 0,
    })
  })

  test('the login screen imports the chosen vault through recovery', () => {
    const vault = VaultStateTestFixture.create()
    const choose = vi
      .spyOn(vault, 'chooseRemoteVault')
      .mockReturnValue(ok(true))

    expect(new ProviderVaultActions(vault).importSeparately(CHOSEN)).toBe(
      ProviderVaultImportStart.ConnectNow,
    )
    expect(vault.loginRequiresExistingVault).toBe(true)
    expect(choose).toHaveBeenCalledWith(CHOSEN)
  })

  test('a refused choice stays visible and connects nothing', () => {
    const vault = VaultStateTestFixture.create()
    const failure = new VaultStorageFailure(
      VaultStorageFailureKind.OperationFailed,
    )
    vi.spyOn(vault, 'chooseRemoteVault').mockReturnValue(err(failure))

    expect(new ProviderVaultActions(vault).importSeparately(CHOSEN)).toBe(
      ProviderVaultImportStart.Refused,
    )
    expect(vault.errorMsg).toBe(vault.t(failure.translationKey))
  })

  test('the unlocked workspace locks and continues the import there', () => {
    const vault = unlockedOn(EMPTY)
    const lock = vi.spyOn(vault, 'lockVault').mockResolvedValue()

    expect(new ProviderVaultActions(vault).importSeparately(CHOSEN)).toBe(
      ProviderVaultImportStart.AfterLock,
    )
    expect(vault.vaultImportOpen).toBe(true)
    expect(lock).toHaveBeenCalledOnce()
  })

  test('the empty vault goes only once the chosen vault is open', async () => {
    const vault = unlockedOn(EMPTY)
    vi.spyOn(vault, 'lockVault').mockResolvedValue()
    const deletion = vi
      .spyOn(vault.identityControl, 'deleteVaultEverywhere')
      .mockResolvedValue(ok(IdentityActionOutcome.Completed))
    const actions = new ProviderVaultActions(vault)

    actions.replaceEmptyVault({
      emptyStoreId: EMPTY,
      replacementStoreId: CHOSEN,
    })
    expect(vault.emptyVaultReplacement).toEqual({
      kind: EmptyVaultReplacementKind.Pending,
      emptyStoreId: EMPTY,
      replacementStoreId: CHOSEN,
    })

    // Still on the empty vault: nothing is deleted.
    await actions.completeEmptyVaultReplacement()
    expect(deletion).not.toHaveBeenCalled()

    vault.openActiveVault(CHOSEN)
    await actions.completeEmptyVaultReplacement()
    await actions.completeEmptyVaultReplacement()
    expect(deletion).toHaveBeenCalledOnce()
    expect(deletion).toHaveBeenCalledWith(EMPTY)
    expect(vault.emptyVaultReplacement.kind).toBe(
      EmptyVaultReplacementKind.Idle,
    )
    expect(vault.successMsg).toBe(vault.t(I18N_KEYS.ProviderVaultsReplaced))
  })

  test('cancelling the import forgets the replacement', () => {
    const vault = unlockedOn(EMPTY)
    vi.spyOn(vault, 'lockVault').mockResolvedValue()
    new ProviderVaultActions(vault).replaceEmptyVault({
      emptyStoreId: EMPTY,
      replacementStoreId: CHOSEN,
    })

    vault.cancelExistingVaultOpen()

    expect(vault.emptyVaultReplacement.kind).toBe(
      EmptyVaultReplacementKind.Idle,
    )
  })
})

describe('recovery choice between several vaults', () => {
  test('lists each vault by its summary and recovers the chosen one', async () => {
    const vault = VaultStateTestFixture.create()
    const vaults: ProviderVaultSummary[] = [
      {
        storeId: CHOSEN,
        shortId: 'otherva',
        created: { state: 'unreported' },
        lastActivity: { state: 'unreported' },
        eventCount: 7,
        relation: 'other',
      },
    ]
    vault.remoteVaultChoices = vaults
    const onChoose = vi.fn()
    const view = render(RemoteVaultChoice, { vault, busy: false, onChoose })

    const [row] = view.getAllByTestId('provider-vault-row')
    const eventsRequest: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.ProviderVaultsEvents,
      replacements: { count: '7' },
    }
    expect(row?.textContent).toContain(vault.t(eventsRequest))
    // Unreported times are left out rather than guessed.
    expect(view.getByTestId('provider-vault-meta').children).toHaveLength(1)
    await fireEvent.click(view.getByTestId('remote-vault-choice-item'))
    expect(onChoose).toHaveBeenCalledWith(CHOSEN)
  })
})
