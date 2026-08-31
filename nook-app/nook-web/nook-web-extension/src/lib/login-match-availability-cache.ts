import type { WebsiteLoginMatchAvailability } from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

enum LoginMatchAvailabilityCacheEntryKind {
  Pending = 'pending',
  Settled = 'settled',
}

enum PendingLoginMatchFreshness {
  Current = 'current',
  RefreshRequired = 'refresh-required',
}

type LoginMatchAvailabilityCacheEntry =
  | {
      kind: LoginMatchAvailabilityCacheEntryKind.Pending
      lookup: Promise<WebsiteLoginMatchAvailability>
      freshness: PendingLoginMatchFreshness
    }
  | {
      kind: LoginMatchAvailabilityCacheEntryKind.Settled
      value: WebsiteLoginMatchAvailability
      expiresAt: number
    }

export type LoginMatchAvailabilityCacheOptions = {
  ttlMs: number
}

export type LoginMatchAvailabilityCacheRequest = {
  origin: string
  load: () => Promise<WebsiteLoginMatchAvailability>
  readTime?: () => number
}

export type LoginMatchAvailabilityCacheInvalidation = {
  origin: string
}

export class LoginMatchAvailabilityCache {
  private readonly entries = new Map<string, LoginMatchAvailabilityCacheEntry>()

  constructor(private readonly options: LoginMatchAvailabilityCacheOptions) {}

  resolve({
    origin,
    load,
    readTime = Date.now,
  }: LoginMatchAvailabilityCacheRequest): Promise<WebsiteLoginMatchAvailability> {
    const now = readTime()
    const existing = this.entries.get(origin)
    if (existing?.kind === LoginMatchAvailabilityCacheEntryKind.Pending) {
      return existing.lookup
    }
    if (
      existing?.kind === LoginMatchAvailabilityCacheEntryKind.Settled &&
      now < existing.expiresAt
    ) {
      return Promise.resolve(existing.value)
    }

    const lookup = load()
      .then((value) => {
        const current = this.entries.get(origin)
        if (
          current?.kind === LoginMatchAvailabilityCacheEntryKind.Pending &&
          current.lookup === lookup &&
          current.freshness === PendingLoginMatchFreshness.Current
        ) {
          const entry: LoginMatchAvailabilityCacheEntry = {
            kind: LoginMatchAvailabilityCacheEntryKind.Settled,
            value,
            expiresAt: readTime() + this.options.ttlMs,
          }
          this.entries.set(origin, entry)
        } else if (
          current?.kind === LoginMatchAvailabilityCacheEntryKind.Pending &&
          current.lookup === lookup
        ) {
          this.entries.delete(origin)
        }
        return value
      })
      .catch((error: Error) => {
        const current = this.entries.get(origin)
        if (
          current?.kind === LoginMatchAvailabilityCacheEntryKind.Pending &&
          current.lookup === lookup
        ) {
          this.entries.delete(origin)
        }
        throw error
      })
    const entry: LoginMatchAvailabilityCacheEntry = {
      kind: LoginMatchAvailabilityCacheEntryKind.Pending,
      lookup,
      freshness: PendingLoginMatchFreshness.Current,
    }
    this.entries.set(origin, entry)
    return lookup
  }

  invalidate({ origin }: LoginMatchAvailabilityCacheInvalidation): void {
    const current = this.entries.get(origin)
    if (current?.kind === LoginMatchAvailabilityCacheEntryKind.Pending) {
      const entry: LoginMatchAvailabilityCacheEntry = {
        ...current,
        freshness: PendingLoginMatchFreshness.RefreshRequired,
      }
      this.entries.set(origin, entry)
      return
    }
    this.entries.delete(origin)
  }

  invalidateAll(): void {
    for (const [origin, current] of this.entries) {
      if (current.kind === LoginMatchAvailabilityCacheEntryKind.Pending) {
        const entry: LoginMatchAvailabilityCacheEntry = {
          ...current,
          freshness: PendingLoginMatchFreshness.RefreshRequired,
        }
        this.entries.set(origin, entry)
      } else {
        this.entries.delete(origin)
      }
    }
  }
}
