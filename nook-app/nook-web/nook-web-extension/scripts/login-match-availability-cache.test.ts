import { expect, test } from 'bun:test'
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

function request(
  load: LoginMatchAvailabilityCacheRequest['load'],
  readTime: LoginMatchAvailabilityCacheRequest['readTime'] = Date.now,
): LoginMatchAvailabilityCacheRequest {
  return { origin: 'https://example.test', load, readTime }
}

test('coalesces, bounds, and invalidates cached origin results', async () => {
  const availabilityCache = cache()
  let loads = 0
  const load = async (): Promise<WebsiteLoginMatchAvailability> => {
    loads += 1
    return { kind: 'ready', count: loads }
  }
  const first = request(load, () => 100)

  await Promise.all([
    availabilityCache.resolve(first),
    availabilityCache.resolve(request(load, () => 101)),
  ])
  await availabilityCache.resolve(request(load, () => 500))

  availabilityCache.invalidate({ origin: first.origin })
  await availabilityCache.resolve(request(load, () => 200))
  await availabilityCache.resolve(request(load, () => 1_500))
  expect(loads).toBe(3)

  const other = { ...first, origin: 'https://first.example.test' }
  await availabilityCache.resolve(other)
  availabilityCache.invalidateAll()
  await availabilityCache.resolve(first)
  await availabilityCache.resolve(other)
  expect(loads).toBe(6)
})

test('keeps invalidated work in flight but returns only a fresh result', async () => {
  const availabilityCache = cache()
  const stale = deferred<WebsiteLoginMatchAvailability>()
  const staleLookup = availabilityCache.resolve(
    request(
      () => stale.promise,
      () => 100,
    ),
  )

  availabilityCache.invalidate({ origin: 'https://example.test' })
  let freshLoads = 0
  const refreshed = availabilityCache.resolve(
    request(
      async () => {
        freshLoads += 1
        return { kind: 'ready', count: 1 }
      },
      () => 200,
    ),
  )
  expect(freshLoads).toBe(0)

  stale.resolve({ kind: 'ready', count: 0 })
  await expect(staleLookup).resolves.toEqual({ kind: 'unavailable' })
  expect(await refreshed).toEqual({ kind: 'ready', count: 1 })
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
