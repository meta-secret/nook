import type { StorageProvider } from "$lib/auth/providers";

type ProviderSyncStatusLabels = {
  lastSynced: string;
  notSyncedYet: string;
};

/** Format persisted provider sync metadata for the settings provider row. */
export function formatProviderSyncStatus(
  provider: Pick<StorageProvider, "syncCheckpoint">,
  locale: string,
  labels: ProviderSyncStatusLabels,
): string {
  if (provider.syncCheckpoint?.state !== "synced") {
    return labels.notSyncedYet;
  }

  const syncedAt = new Date(provider.syncCheckpoint.synced_at);
  if (Number.isNaN(syncedAt.getTime())) return labels.notSyncedYet;

  const timestamp = new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeStyle: "short",
  }).format(syncedAt);
  const syncedVersion = provider.syncCheckpoint.version;
  const version =
    syncedVersion.state === "version" && syncedVersion.version > 0
      ? ` · v${syncedVersion.version}`
      : "";

  return `${labels.lastSynced} ${timestamp}${version}`;
}
