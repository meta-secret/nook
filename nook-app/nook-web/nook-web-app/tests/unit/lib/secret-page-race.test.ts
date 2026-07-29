import { describe, expect, test, vi } from 'vitest'
import { NookSecretTypeFilter } from '$app-wasm'
import { loadSecretPage, refreshSecretsFromSession } from '$lib/vault/secrets'
import type { VaultState } from '$lib/vault.svelte'

type PageRecord = { label: string; free: ReturnType<typeof vi.fn> }

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function secretPage(label: string, offset = 0, total = 1) {
  const record: PageRecord = { label, free: vi.fn() }
  return {
    record,
    page: {
      takeItems: () => [record],
      total,
      offset,
      free: vi.fn(),
    },
  }
}

describe('loadSecretPage', () => {
  test('discards an older page that resolves after a newer search', async () => {
    const older = deferred<ReturnType<typeof secretPage>['page']>()
    const newer = deferred<ReturnType<typeof secretPage>['page']>()
    const oldPage = secretPage('older result')
    const newPage = secretPage('newer result')
    const previousRecord: PageRecord = { label: 'previous', free: vi.fn() }
    const manager = {
      queryPreparedSecretPage: vi.fn((query: string) =>
        query === 'older' ? older.promise : newer.promise,
      ),
    }
    const state = {
      manager,
      enqueueStorage: <T>(operation: () => Promise<T>) => operation(),
      secretPageGeneration: 0,
      secretTypeFilter: NookSecretTypeFilter.All,
      secretPageSize: 25,
      secrets: [previousRecord],
      secretTotal: 1,
      secretPageOffset: 0,
      secretPageRequestOffset: 0,
      secretQuery: '',
    } as unknown as VaultState

    const olderRequest = loadSecretPage(state, 'older')
    const newerRequest = loadSecretPage(state, 'newer')
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
    const manager = {
      queryPreparedSecretPage: vi
        .fn()
        .mockReturnValueOnce(pagination.promise)
        .mockReturnValueOnce(maintenance.promise),
    }
    const state = {
      manager,
      enqueueStorage: <T>(operation: () => Promise<T>) => operation(),
      secretPageGeneration: 0,
      secretTypeFilter: NookSecretTypeFilter.All,
      secretPageSize: 25,
      secrets: [],
      secretTotal: 50,
      secretPageOffset: 0,
      secretPageRequestOffset: 0,
      secretQuery: 'vault',
    } as unknown as VaultState

    const paginationRequest = loadSecretPage(state, 'vault', 25)
    expect(state.secretPageOffset).toBe(0)
    expect(state.secretPageRequestOffset).toBe(25)
    const maintenanceRefresh = refreshSecretsFromSession(state)
    maintenance.resolve(refreshedPage.page)
    await maintenanceRefresh
    pagination.resolve(paginatedPage.page)
    await paginationRequest

    expect(manager.queryPreparedSecretPage.mock.calls[1]?.[0]).toBe('vault')
    expect(manager.queryPreparedSecretPage.mock.calls[1]?.slice(2)).toEqual([
      25, 25,
    ])
    expect(state.secrets).toEqual([refreshedPage.record])
    expect(state.secretPageOffset).toBe(25)
    expect(paginatedPage.record.free).toHaveBeenCalledOnce()
  })
})
