import type { ProviderIdentityJoin, ProviderVaultSummary } from '$app-wasm'

export function summary(
  storeId: string,
  access: ProviderVaultSummary['access'],
  recoveryPassphrases = 0,
): ProviderVaultSummary {
  return {
    storeId,
    shortId: storeId.slice('store_'.length, 'store_'.length + 8),
    name: { state: 'unknown' },
    identity: {
      identityId: 'idn_strangerabc',
      shortId: 'stranger',
      name: { state: 'unknown' },
      words: ['ripple', 'canvas', 'orbit'],
      log: {
        state: 'read',
        devices: 2,
        newestDevice: { state: 'reported', at: Date.UTC(2026, 9, 27) },
        vaults: 3,
        recoveryPassphrases,
        thisBrowser: false,
        join: 'notAsked',
      },
    },
    created: { state: 'reported', at: Date.UTC(2024, 0, 2) },
    lastActivity: { state: 'reported', at: Date.UTC(2024, 2, 1) },
    eventCount: 4,
    access,
  }
}

/** One vault of an identity of its own, whose log tells a join's answer. */
export function joinedSummary(
  identityId: string,
  join: ProviderIdentityJoin,
  recoveryPassphrases = 0,
): ProviderVaultSummary {
  const base = summary(`store_${identityId.slice('idn_'.length)}`, {
    state: 'locked',
  })
  return {
    ...base,
    identity: {
      ...base.identity,
      identityId,
      log: {
        state: 'read',
        devices: 1,
        newestDevice: { state: 'unreported' },
        vaults: 1,
        recoveryPassphrases,
        thisBrowser: false,
        join,
      },
    },
  }
}
