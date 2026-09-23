import { describe, expect, test, vi } from 'vitest'
import { ok, type Result } from 'neverthrow'
import { NookSecretTypeFilter, NookVaultManager } from '$app-wasm'
import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
import { VaultSecretActions } from '$lib/vault/secrets'
import { VaultState } from '$lib/vault.svelte'
import { SecretComponentTestFixture } from '../components/secret-component-test-fixture'
import {
  VaultStorageFailure,
  VaultStorageFailureKind,
} from '$lib/runtime/storage-failure'
import {
  VaultOperationStale,
  VaultOperationStaleKind,
} from '$lib/runtime/vault-operation-stale'
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
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
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
  test('keeps an empty unlocked local-only vault as a normal empty page', async () => {
    const emptyPage = {
      take_items: () => [],
      total: 0,
      offset: 0,
      limit: 25,
      free: vi.fn(),
      [Symbol.dispose]: vi.fn(),
    }
    const manager = new NookVaultManager()
    vi.spyOn(manager, 'query_prepared_secret_page_js').mockResolvedValue(
      emptyPage,
    )
    const state = VaultStateTestFixture.createFrom(SecretPageTestState)
    state.openManager(manager)
    state.storageMode = 'local'
    state.isAuthenticated = true
    state.secretTypeFilter = NookSecretTypeFilter.All
    state.secretPageSize = 25

    const result = await new VaultSecretActions(state).loadSecretPage({
      query: '',
      requestedOffset: 0,
    })

    expect(result).toEqual(
      ok({
        displayedSecretCount: 0,
        totalSecretCount: 0,
        pageOffset: 0,
        query: '',
      }),
    )
    expect(state.errorMsg).toBe('')
    expect(state.errorMsg).not.toBe(
      state.t(I18N_KEYS.ErrorsValidationLocalDataChangedInAnotherTab),
    )
    expect(state.isAuthenticated).toBe(true)
  })

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
      (query: string) => (query === 'older' ? older.promise : newer.promise),
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
    const newerResult = await newerRequest
    older.resolve(oldPage.page)
    const olderResult = await olderRequest

    expect(newerResult).toEqual(
      ok({
        displayedSecretCount: 1,
        totalSecretCount: 1,
        pageOffset: 0,
        query: 'newer',
      }),
    )
    expect(olderResult.isOk()).toBe(true)
    if (olderResult.isOk()) {
      expect(olderResult.value).toBeInstanceOf(VaultOperationStale)
      if (olderResult.value instanceof VaultOperationStale)
        expect(olderResult.value.kind).toBe(
          VaultOperationStaleKind.RequestSuperseded,
        )
    }
    expect(state.errorMsg).toBe('')
    expect(state.errorMsg).not.toBe(
      state.t(I18N_KEYS.ErrorsValidationLocalDataChangedInAnotherTab),
    )
    expect(state.secrets).toEqual([newPage.record])
    expect(state.secretQuery).toBe('newer')
    expect(previousRecord.free).toHaveBeenCalledOnce()
    expect(oldPage.record.free).toHaveBeenCalledOnce()
  })

  test('suppresses an older page failure after a newer search supersedes it', async () => {
    const older = deferred<ReturnType<typeof secretPage>['page']>()
    const newer = deferred<ReturnType<typeof secretPage>['page']>()
    const newPage = secretPage('newer result')
    const manager = new NookVaultManager()
    vi.spyOn(manager, 'query_prepared_secret_page_js').mockImplementation(
      (query: string) => (query === 'older' ? older.promise : newer.promise),
    )
    const state = VaultStateTestFixture.createFrom(SecretPageTestState)
    state.openManager(manager)
    state.secretTypeFilter = NookSecretTypeFilter.All
    state.secretPageSize = 25

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
    older.reject(new Error('superseded query failure'))
    const olderResult = await olderRequest

    expect(olderResult.isOk()).toBe(true)
    if (olderResult.isOk()) {
      expect(olderResult.value).toBeInstanceOf(VaultOperationStale)
      if (olderResult.value instanceof VaultOperationStale)
        expect(olderResult.value.kind).toBe(
          VaultOperationStaleKind.RequestSuperseded,
        )
    }
    expect(state.errorMsg).toBe('')
    expect(state.errorMsg).not.toBe(
      state.t(I18N_KEYS.ErrorsValidationLocalDataChangedInAnotherTab),
    )
    expect(state.secrets).toEqual([newPage.record])
  })

  test('keeps a current marker mismatch visible when it supersedes an older page', async () => {
    const markerMismatch = new VaultStorageFailure(
      VaultStorageFailureKind.GenerationChanged,
    )
    const state = VaultStateTestFixture.createFrom(SecretPageTestState)
    state.openManager(new NookVaultManager())
    state.secretTypeFilter = NookSecretTypeFilter.All
    vi.spyOn(state, 'enqueueStorage').mockImplementation(async () =>
      err(markerMismatch),
    )

    const olderRequest = new VaultSecretActions(state).loadSecretPage({
      query: 'older',
      requestedOffset: 0,
    })
    const currentRequest = new VaultSecretActions(state).loadSecretPage({
      query: 'current',
      requestedOffset: 0,
    })
    const olderResult = await olderRequest
    const currentResult = await currentRequest

    expect(olderResult.isOk()).toBe(true)
    if (olderResult.isOk())
      expect(olderResult.value).toBeInstanceOf(VaultOperationStale)
    expect(currentResult.isErr()).toBe(true)
    if (currentResult.isErr()) {
      expect(currentResult.error.kind).toBe(
        VaultStorageFailureKind.GenerationChanged,
      )
      expect(currentResult.error.translationKey).toBe(
        I18N_KEYS.ErrorsValidationLocalDataChangedInAnotherTab,
      )
    }
    expect(state.errorMsg).toBe(
      state.t(I18N_KEYS.ErrorsValidationLocalDataChangedInAnotherTab),
    )
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
    const maintenanceResult = await maintenanceRefresh
    pagination.resolve(paginatedPage.page)
    const paginationResult = await paginationRequest

    expect(maintenanceResult).toEqual(
      ok({
        displayedSecretCount: 1,
        totalSecretCount: 50,
        pageOffset: 25,
        query: 'vault',
      }),
    )
    expect(paginationResult.isErr()).toBe(true)
    expect(queryPreparedSecretPage.mock.calls[1]?.[0]).toBe('vault')
    expect(queryPreparedSecretPage.mock.calls[1]?.slice(2)).toEqual([25, 25])
    expect(state.secrets).toEqual([refreshedPage.record])
    expect(state.secretPageOffset).toBe(25)
    expect(paginatedPage.record.free).toHaveBeenCalledOnce()
  })
})
