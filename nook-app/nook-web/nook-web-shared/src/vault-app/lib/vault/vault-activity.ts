import { I18N_KEYS, type I18nKey } from "../../../generated/i18n-keys";

/**
 * Background vault work an open identity is doing. Syncing and vault changes
 * run WASM encryption on the main thread, so the page can pause; naming the
 * work keeps a paused page from reading as a frozen one.
 */
export enum VaultActivityKind {
  Idle = "idle",
  Working = "working",
  Syncing = "syncing",
}

export type VaultActivityFlags = {
  readonly isVerifying: boolean;
  readonly isSaving: boolean;
  readonly isSyncing: boolean;
};

export class VaultActivity {
  constructor(private readonly flags: VaultActivityFlags) {}

  get kind(): VaultActivityKind {
    if (this.flags.isVerifying || this.flags.isSaving)
      return VaultActivityKind.Working;
    if (this.flags.isSyncing) return VaultActivityKind.Syncing;
    return VaultActivityKind.Idle;
  }

  get titleKey(): I18nKey {
    return this.kind === VaultActivityKind.Syncing
      ? I18N_KEYS.WorkspaceVaultActivitySyncing
      : I18N_KEYS.WorkspaceVaultActivityWorking;
  }
}
