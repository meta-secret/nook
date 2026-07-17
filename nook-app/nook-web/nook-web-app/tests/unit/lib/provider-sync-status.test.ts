import { describe, expect, test } from 'vitest'
import { formatProviderSyncStatus } from '$lib/provider-sync-status'

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
        { lastSyncedAt, lastSyncedVersion: 42 },
        'en',
        labels,
      ),
    ).toBe(`Last synced ${timestamp} · v42`)
  })

  test('reports an absent or invalid timestamp as not synced', () => {
    expect(
      formatProviderSyncStatus(
        { lastSyncedAt: undefined, lastSyncedVersion: undefined },
        'en',
        labels,
      ),
    ).toBe('Not synced yet')
    expect(
      formatProviderSyncStatus(
        { lastSyncedAt: 'invalid', lastSyncedVersion: 42 },
        'en',
        labels,
      ),
    ).toBe('Not synced yet')
  })
})
