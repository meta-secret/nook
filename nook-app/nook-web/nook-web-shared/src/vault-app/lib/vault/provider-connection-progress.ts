import { I18N_KEYS, type I18nKey } from "../../../generated/i18n-keys";

/**
 * Where a sync provider connection stands. Connecting runs several long
 * steps back to back (the first upload and sync can take most of a minute),
 * so the settings surface shows each one instead of a silent, idle screen.
 */
export enum ProviderConnectionPhase {
  Idle = "idle",
  Checking = "checking",
  Saving = "saving",
  Uploading = "uploading",
  Syncing = "syncing",
}

export type ProviderConnectionStep = {
  readonly phase: ProviderConnectionPhase;
  /** Short label for the step bar. */
  readonly labelKey: I18nKey;
  /** Sentence shown while the step runs. */
  readonly titleKey: I18nKey;
};

const STEPS: readonly ProviderConnectionStep[] = [
  {
    phase: ProviderConnectionPhase.Checking,
    labelKey: I18N_KEYS.AuthStorageConnectProgressChecking,
    titleKey: I18N_KEYS.AuthStorageConnectProgressCheckingTitle,
  },
  {
    phase: ProviderConnectionPhase.Saving,
    labelKey: I18N_KEYS.AuthStorageConnectProgressSaving,
    titleKey: I18N_KEYS.AuthStorageConnectProgressSavingTitle,
  },
  {
    phase: ProviderConnectionPhase.Uploading,
    labelKey: I18N_KEYS.AuthStorageConnectProgressUploading,
    titleKey: I18N_KEYS.AuthStorageConnectProgressUploadingTitle,
  },
  {
    phase: ProviderConnectionPhase.Syncing,
    labelKey: I18N_KEYS.AuthStorageConnectProgressSyncing,
    titleKey: I18N_KEYS.AuthStorageConnectProgressSyncingTitle,
  },
];

/** The ordered steps a connection walks through and where it is now. */
export class ProviderConnectionProgress {
  constructor(private readonly phase: ProviderConnectionPhase) {}

  get active(): boolean {
    return this.phase !== ProviderConnectionPhase.Idle;
  }

  get steps(): readonly ProviderConnectionStep[] {
    return STEPS;
  }

  /** Index of the running step; earlier steps are done. */
  get current(): number {
    return STEPS.findIndex((step) => step.phase === this.phase);
  }
}
