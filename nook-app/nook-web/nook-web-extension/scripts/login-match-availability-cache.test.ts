import { describe, expect, test } from 'bun:test'
import {
  LoginMatchAvailabilityCache,
  type LoginMatchAvailabilityCacheRequest,
} from '../src/lib/login-match-availability-cache'
import type { WebsiteLoginMatchAvailability } from '../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

function cache(): LoginMatchAvailabilityCache {
  return new LoginMatchAvailabilityCache({ ttlMs: 1_000 })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const timeReader =
  (now: number): (() => number) =>
  () =>
    now

function request(
  load: LoginMatchAvailabilityCacheRequest['load'],
  readTime: LoginMatchAvailabilityCacheRequest['readTime'] = Date.now,
): LoginMatchAvailabilityCacheRequest {
  return { origin: 'https://example.test', load, readTime }
}

describe('login-match availability cache', () => {
  test('coalesces concurrent origin lookups and reuses the bounded result', async () => {
    const availabilityCache = cache()
    let loads = 0
    const load = async (): Promise<WebsiteLoginMatchAvailability> => {
      loads += 1
      return { kind: 'ready', count: 0 }
    }
    const first = request(load, timeReader(100))
    const second = request(load, timeReader(101))

    expect(
      await Promise.all([
        availabilityCache.resolve(first),
        availabilityCache.resolve(second),
      ]),
    ).toEqual([
      { kind: 'ready', count: 0 },
      { kind: 'ready', count: 0 },
    ])
    expect(loads).toBe(1)

    const cached = request(load, timeReader(500))
    await availabilityCache.resolve(cached)
    expect(loads).toBe(1)
  })

  test('reloads after explicit invalidation or expiry', async () => {
    const availabilityCache = cache()
    let loads = 0
    const load = async (): Promise<WebsiteLoginMatchAvailability> => {
      loads += 1
      return { kind: 'ready', count: loads }
    }
    const initial = request(load, timeReader(100))
    await availabilityCache.resolve(initial)

    const invalidation: Parameters<typeof availabilityCache.invalidate>[0] = {
      origin: 'https://example.test',
    }
    availabilityCache.invalidate(invalidation)
    const invalidatedRequest = request(load, timeReader(200))
    await availabilityCache.resolve(invalidatedRequest)
    const expiredRequest = request(load, timeReader(1_500))
    await availabilityCache.resolve(expiredRequest)
    expect(loads).toBe(3)
  })

  test('invalidates every origin when session or grant state changes', async () => {
    const availabilityCache = cache()
    let loads = 0
    const load = async (): Promise<WebsiteLoginMatchAvailability> => {
      loads += 1
      return { kind: 'ready', count: loads }
    }
    const first: LoginMatchAvailabilityCacheRequest = {
      origin: 'https://first.example.test',
      load,
    }
    const second: LoginMatchAvailabilityCacheRequest = {
      origin: 'https://second.example.test',
      load,
    }
    await availabilityCache.resolve(first)
    await availabilityCache.resolve(second)

    availabilityCache.invalidateAll()

    await availabilityCache.resolve(first)
    await availabilityCache.resolve(second)
    expect(loads).toBe(4)
  })

  test('keeps an invalidated lookup in flight and refreshes after it settles', async () => {
    const availabilityCache = cache()
    const stale = deferred<WebsiteLoginMatchAvailability>()
    const staleRequest = request(() => stale.promise, timeReader(100))
    const staleLookup = availabilityCache.resolve(staleRequest)

    availabilityCache.invalidate({ origin: 'https://example.test' })
    let freshLoads = 0
    const freshRequest: LoginMatchAvailabilityCacheRequest = {
      origin: 'https://example.test',
      load: async () => {
        freshLoads += 1
        return { kind: 'ready', count: 1 }
      },
      readTime: timeReader(200),
    }
    const refreshed = availabilityCache.resolve(freshRequest)
    expect(freshLoads).toBe(0)

    stale.resolve({ kind: 'ready', count: 0 })
    await expect(staleLookup).resolves.toEqual({ kind: 'unavailable' })
    await expect(refreshed).resolves.toEqual({
      kind: 'ready',
      count: 1,
    })
  })

  test('coalesces repeated invalidation while a lookup remains pending', async () => {
    const availabilityCache = cache()
    const delayed = deferred<WebsiteLoginMatchAvailability>()
    let loads = 0
    const pendingRequest = request(() => {
      loads += 1
      return delayed.promise
    })
    const first = availabilityCache.resolve(pendingRequest)

    for (let index = 0; index < 20; index += 1) {
      availabilityCache.invalidate({ origin: 'https://example.test' })
      void availabilityCache.resolve(pendingRequest)
    }
    expect(loads).toBe(1)

    delayed.resolve({ kind: 'ready', count: 1 })
    await first
    await Promise.resolve()
    expect(loads).toBe(2)
  })

  test('starts the cache lifetime when a delayed lookup settles', async () => {
    const availabilityCache = cache()
    const delayed = deferred<WebsiteLoginMatchAvailability>()
    let now = 100
    let loads = 0
    const delayedRequest = request(
      () => {
        loads += 1
        return loads === 1
          ? delayed.promise
          : Promise.resolve({ kind: 'ready', count: loads })
      },
      () => now,
    )
    const lookup = availabilityCache.resolve(delayedRequest)
    now = 900
    delayed.resolve({ kind: 'ready', count: 1 })
    await lookup

    now = 1_500
    await availabilityCache.resolve(delayedRequest)
    expect(loads).toBe(1)

    now = 1_900
    await availabilityCache.resolve(delayedRequest)
    expect(loads).toBe(2)
  })
})
