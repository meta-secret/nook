import { describe, expect, test, vi } from 'vitest'
import { loadSecretPage } from '$lib/vault/secrets'
import type { VaultState } from '$lib/vault.svelte'

type PageRecord = { label: string; free: ReturnType<typeof vi.fn> }

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function secretPage(label: string) {
  const record: PageRecord = { label, free: vi.fn() }
  return {
    record,
    page: {
      takeItems: () => [record],
      total: 1,
      offset: 0,
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
      secretTypeFilter: undefined,
      secretPageSize: 25,
      secrets: [previousRecord],
      secretTotal: 1,
      secretPageOffset: 0,
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
})
