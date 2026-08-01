import { describe, expect, test } from 'vitest'
import { formatProviderSyncStatus } from '$lib/auth/provider-sync-status'

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
      formatProviderSyncStatus(
        {
          syncCheckpoint: {
            state: 'synced',
            version: { state: 'version', version: 42 },
            synced_at: lastSyncedAt,
            revision: { state: 'unknown' },
            common_content_hash: 'content-hash',
          },
        },
        'en',
        labels,
      ),
    ).toBe(`Last synced ${timestamp} · v42`)
  })

  test('reports an absent or invalid timestamp as not synced', () => {
    expect(
      formatProviderSyncStatus(
        { syncCheckpoint: { state: 'neverSynced' } },
        'en',
        labels,
      ),
    ).toBe('Not synced yet')
    expect(
      formatProviderSyncStatus(
        {
          syncCheckpoint: {
            state: 'synced',
            version: { state: 'version', version: 42 },
            synced_at: 'invalid',
            revision: { state: 'unknown' },
            common_content_hash: 'content-hash',
          },
        },
        'en',
        labels,
      ),
    ).toBe('Not synced yet')
  })
})
