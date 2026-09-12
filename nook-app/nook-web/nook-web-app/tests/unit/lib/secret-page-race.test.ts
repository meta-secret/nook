import { describe, expect, test, vi } from 'vitest'
import type { Result } from 'neverthrow'
import { NookSecretTypeFilter, NookVaultManager } from '$app-wasm'
import { VaultSecretActions } from '$lib/vault/secrets'
import { VaultState } from '$lib/vault.svelte'
import { SecretComponentTestFixture } from '../components/secret-component-test-fixture'
import type { VaultStorageFailure } from '$lib/runtime/storage-failure'
import { VaultStateTestFixture } from '../vault-state-test-fixture'

class SecretPageTestState extends VaultState {
  override async enqueueStorage<T, E = VaultStorageFailure>(
    operation: () => Result<T, E> | Promise<Result<T, E>>,
  ): Promise<Result<T, E | VaultStorageFailure>> {
    return operation()
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function secretPage(label: string, offset = 0, total = 1) {
  const record = SecretComponentTestFixture.listItem({ title: label })
  return {
    record,
    page: {
      take_items: () => [record],
      total,
      offset,
      limit: 25,
      free: vi.fn(),
      [Symbol.dispose]: vi.fn(),
    },
  }
}

describe('loadSecretPage', () => {
  test('discards an older page that resolves after a newer search', async () => {
    const older = deferred<ReturnType<typeof secretPage>['page']>()
    const newer = deferred<ReturnType<typeof secretPage>['page']>()
    const oldPage = secretPage('older result')
    const newPage = secretPage('newer result')
    const previousRecord = SecretComponentTestFixture.listItem({
      title: 'previous',
    })
    const manager = new NookVaultManager()
    vi.spyOn(manager, 'query_prepared_secret_page_js').mockImplementation(
      (query) => (query === 'older' ? older.promise : newer.promise),
    )
    const state = VaultStateTestFixture.createFrom(SecretPageTestState)
    state.openManager(manager)
    state.secretTypeFilter = NookSecretTypeFilter.All
    state.secretPageSize = 25
    state.secrets = [previousRecord]
    state.secretTotal = 1

    const olderRequest = new VaultSecretActions(state).loadSecretPage({
      query: 'older',
      requestedOffset: 0,
    })
    const newerRequest = new VaultSecretActions(state).loadSecretPage({
      query: 'newer',
      requestedOffset: 0,
    })
    newer.resolve(newPage.page)
    await newerRequest
    older.resolve(oldPage.page)
    await olderRequest

    expect(state.secrets).toEqual([newPage.record])
    expect(state.secretQuery).toBe('newer')
    expect(previousRecord.free).toHaveBeenCalledOnce()
    expect(oldPage.record.free).toHaveBeenCalledOnce()
  })

  test('keeps a queued maintenance refresh on the newly requested page', async () => {
    const pagination = deferred<ReturnType<typeof secretPage>['page']>()
    const maintenance = deferred<ReturnType<typeof secretPage>['page']>()
    const paginatedPage = secretPage('interactive page', 25, 50)
    const refreshedPage = secretPage('refreshed page', 25, 50)
    const manager = new NookVaultManager()
    const queryPreparedSecretPage = vi
      .spyOn(manager, 'query_prepared_secret_page_js')
      .mockReturnValueOnce(pagination.promise)
      .mockReturnValueOnce(maintenance.promise)
    const state = VaultStateTestFixture.createFrom(SecretPageTestState)
    state.openManager(manager)
    state.secretTypeFilter = NookSecretTypeFilter.All
    state.secretPageSize = 25
    state.secretTotal = 50
    state.secretQuery = 'vault'

    const paginationRequest = new VaultSecretActions(state).loadSecretPage({
      query: 'vault',
      requestedOffset: 25,
    })
    expect(state.secretPageOffset).toBe(0)
    expect(state.secretPageRequestOffset).toBe(25)
    const maintenanceRefresh = new VaultSecretActions(
      state,
    ).refreshSecretsFromSession()
    maintenance.resolve(refreshedPage.page)
    await maintenanceRefresh
    pagination.resolve(paginatedPage.page)
    await paginationRequest

    expect(queryPreparedSecretPage.mock.calls[1]?.[0]).toBe('vault')
    expect(queryPreparedSecretPage.mock.calls[1]?.slice(2)).toEqual([25, 25])
    expect(state.secrets).toEqual([refreshedPage.record])
    expect(state.secretPageOffset).toBe(25)
    expect(paginatedPage.record.free).toHaveBeenCalledOnce()
  })
})
