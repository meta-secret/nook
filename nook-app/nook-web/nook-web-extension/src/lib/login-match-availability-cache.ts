import type { WebsiteLoginMatchAvailabilityWire } from './auth-workflow-messages'

enum LoginMatchAvailabilityCacheEntryKind {
  Pending = 'pending',
  Settled = 'settled',
}

type LoginMatchAvailabilityCacheEntry =
  | {
      kind: LoginMatchAvailabilityCacheEntryKind.Pending
      lookup: Promise<WebsiteLoginMatchAvailabilityWire>
    }
  | {
      kind: LoginMatchAvailabilityCacheEntryKind.Settled
      value: WebsiteLoginMatchAvailabilityWire
      expiresAt: number
    }

export type LoginMatchAvailabilityCacheOptions = {
  ttlMs: number
}

export type LoginMatchAvailabilityCacheRequest = {
  origin: string
  load: () => Promise<WebsiteLoginMatchAvailabilityWire>
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
  }: LoginMatchAvailabilityCacheRequest): Promise<WebsiteLoginMatchAvailabilityWire> {
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
          current.lookup === lookup
        ) {
          const entry: LoginMatchAvailabilityCacheEntry = {
            kind: LoginMatchAvailabilityCacheEntryKind.Settled,
            value,
            expiresAt: readTime() + this.options.ttlMs,
          }
          this.entries.set(origin, entry)
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
    }
    this.entries.set(origin, entry)
    return lookup
  }

  invalidate({ origin }: LoginMatchAvailabilityCacheInvalidation): void {
    this.entries.delete(origin)
  }
}
