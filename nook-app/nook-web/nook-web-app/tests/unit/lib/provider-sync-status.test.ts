import { describe, expect, test } from 'vitest'
import { ProviderSyncStatusView } from '$lib/auth/provider-sync-status'

const labels = {
  lastSynced: 'Last synced',
  notSyncedYet: 'Not synced yet',
}

describe('formatProviderSyncStatus', () => {
  test('includes the localized sync date, time, and persisted vault version', () => {
    const lastSyncedAt = '2026-07-17T19:13:00.000Z'
    const timestamp = new Intl.DateTimeFormat('en', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(lastSyncedAt))

    expect(
      new ProviderSyncStatusView({
        provider: {
          syncCheckpoint: {
            state: 'synced',
            version: { state: 'version', version: 42 },
            synced_at: lastSyncedAt,
            revision: { state: 'unknown' },
            common_content_hash: 'content-hash',
          },
        },
        locale: 'en',
        labels: labels,
      }).text,
    ).toBe(`Last synced ${timestamp} · v42`)
  })

  test('reports an absent or invalid timestamp as not synced', () => {
    expect(
      new ProviderSyncStatusView({
        provider: { syncCheckpoint: { state: 'neverSynced' } },
        locale: 'en',
        labels: labels,
      }).text,
    ).toBe('Not synced yet')
    expect(
      new ProviderSyncStatusView({
        provider: {
          syncCheckpoint: {
            state: 'synced',
            version: { state: 'version', version: 42 },
            synced_at: 'invalid',
            revision: { state: 'unknown' },
            common_content_hash: 'content-hash',
          },
        },
        locale: 'en',
        labels: labels,
      }).text,
    ).toBe('Not synced yet')
  })
})
