import { describe, expect, test } from 'bun:test'
import {
  LoginMatchAvailabilityCache,
  type LoginMatchAvailabilityCacheOptions,
  type LoginMatchAvailabilityCacheRequest,
} from '../src/lib/login-match-availability-cache'
import type { WebsiteLoginMatchAvailabilityWire } from '../src/lib/auth-workflow-messages'

function cache(): LoginMatchAvailabilityCache {
  const options: LoginMatchAvailabilityCacheOptions = { ttlMs: 1_000 }
  return new LoginMatchAvailabilityCache(options)
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function timeReader(now: number): () => number {
  return () => now
}

describe('login-match availability cache', () => {
  test('coalesces concurrent origin lookups and reuses the bounded result', async () => {
    const availabilityCache = cache()
    let loads = 0
    const load = async (): Promise<WebsiteLoginMatchAvailabilityWire> => {
      loads += 1
      return { kind: 'ready', count: 0 }
    }
    const first: LoginMatchAvailabilityCacheRequest = {
      origin: 'https://example.test',
      load,
      readTime: timeReader(100),
    }
    const second: LoginMatchAvailabilityCacheRequest = {
      origin: 'https://example.test',
      load,
      readTime: timeReader(101),
    }

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

    const cached: LoginMatchAvailabilityCacheRequest = {
      origin: 'https://example.test',
      load,
      readTime: timeReader(500),
    }
    await availabilityCache.resolve(cached)
    expect(loads).toBe(1)
  })

  test('reloads after explicit invalidation or expiry', async () => {
    const availabilityCache = cache()
    let loads = 0
    const load = async (): Promise<WebsiteLoginMatchAvailabilityWire> => {
      loads += 1
      return { kind: 'ready', count: loads }
    }
    const request: LoginMatchAvailabilityCacheRequest = {
      origin: 'https://example.test',
      load,
      readTime: timeReader(100),
    }
    await availabilityCache.resolve(request)

    const invalidation: Parameters<typeof availabilityCache.invalidate>[0] = {
      origin: 'https://example.test',
    }
    availabilityCache.invalidate(invalidation)
    const invalidatedRequest: LoginMatchAvailabilityCacheRequest = {
      ...request,
      readTime: timeReader(200),
    }
    await availabilityCache.resolve(invalidatedRequest)
    const expiredRequest: LoginMatchAvailabilityCacheRequest = {
      ...request,
      readTime: timeReader(1_500),
    }
    await availabilityCache.resolve(expiredRequest)
    expect(loads).toBe(3)
  })

  test('invalidates every origin when session or grant state changes', async () => {
    const availabilityCache = cache()
    let loads = 0
    const load = async (): Promise<WebsiteLoginMatchAvailabilityWire> => {
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

  test('does not let an invalidated lookup overwrite a newer result', async () => {
    const availabilityCache = cache()
    const stale = deferred<WebsiteLoginMatchAvailabilityWire>()
    const staleRequest: LoginMatchAvailabilityCacheRequest = {
      origin: 'https://example.test',
      load: () => stale.promise,
      readTime: timeReader(100),
    }
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
    expect(await availabilityCache.resolve(freshRequest)).toEqual({
      kind: 'ready',
      count: 1,
    })

    stale.resolve({ kind: 'ready', count: 0 })
    await staleLookup
    expect(await availabilityCache.resolve(freshRequest)).toEqual({
      kind: 'ready',
      count: 1,
    })
    expect(freshLoads).toBe(1)
  })

  test('starts the cache lifetime when a delayed lookup settles', async () => {
    const availabilityCache = cache()
    const delayed = deferred<WebsiteLoginMatchAvailabilityWire>()
    let now = 100
    let loads = 0
    const request: LoginMatchAvailabilityCacheRequest = {
      origin: 'https://example.test',
      load: () => {
        loads += 1
        return loads === 1
          ? delayed.promise
          : Promise.resolve({ kind: 'ready', count: loads })
      },
      readTime: () => now,
    }
    const lookup = availabilityCache.resolve(request)
    now = 900
    delayed.resolve({ kind: 'ready', count: 1 })
    await lookup

    now = 1_500
    await availabilityCache.resolve(request)
    expect(loads).toBe(1)

    now = 1_900
    await availabilityCache.resolve(request)
    expect(loads).toBe(2)
  })
})
