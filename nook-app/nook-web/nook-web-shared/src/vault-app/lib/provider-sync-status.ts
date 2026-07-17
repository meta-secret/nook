import type { StorageProvider } from '$lib/auth-providers'

type ProviderSyncStatusLabels = {
  lastSynced: string
  notSyncedYet: string
}

/** Format persisted provider sync metadata for the settings provider row. */
export function formatProviderSyncStatus(
  provider: Pick<StorageProvider, 'lastSyncedAt' | 'lastSyncedVersion'>,
  locale: string,
  labels: ProviderSyncStatusLabels,
): string {
  if (!provider.lastSyncedAt) return labels.notSyncedYet

  const syncedAt = new Date(provider.lastSyncedAt)
  if (Number.isNaN(syncedAt.getTime())) return labels.notSyncedYet

  const timestamp = new Intl.DateTimeFormat(locale, {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(syncedAt)
  const version =
    provider.lastSyncedVersion != undefined && provider.lastSyncedVersion > 0
      ? ` · v${provider.lastSyncedVersion}`
      : ''

  return `${labels.lastSynced} ${timestamp}${version}`
}
