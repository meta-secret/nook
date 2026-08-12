import type { StorageProvider } from "$lib/auth/providers";

type ProviderSyncStatusLabels = {
  lastSynced: string;
  notSyncedYet: string;
};

/** Format persisted provider sync metadata for the settings provider row. */
type ProviderSyncStatusPresentation = {
  readonly provider: Pick<StorageProvider, "syncCheckpoint">;
  readonly locale: string;
  readonly labels: ProviderSyncStatusLabels;
};

export function formatProviderSyncStatus({
  provider,
  locale,
  labels,
}: ProviderSyncStatusPresentation): string {
  if (provider.syncCheckpoint?.state !== "synced") {
    return labels.notSyncedYet;
  }

  const syncedAt = new Date(provider.syncCheckpoint.synced_at);
  if (Number.isNaN(syncedAt.getTime())) return labels.notSyncedYet;

  const DateTimeFormatArgs: ConstructorParameters<
    typeof Intl.DateTimeFormat
  >[1] = {
    dateStyle: "short",
    timeStyle: "short",
  };
  const timestamp = new Intl.DateTimeFormat(locale, DateTimeFormatArgs).format(
    syncedAt,
  );
  const syncedVersion = provider.syncCheckpoint.version;
  const version =
    syncedVersion.state === "version" && syncedVersion.version > 0
      ? ` · v${syncedVersion.version}`
      : "";

  return `${labels.lastSynced} ${timestamp}${version}`;
}
