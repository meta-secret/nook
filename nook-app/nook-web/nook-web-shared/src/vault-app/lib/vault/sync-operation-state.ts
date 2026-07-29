import type { StorageProvider } from "$lib/auth-providers";

export enum EventOutboxTargetKind {
  Unavailable = "unavailable",
  LocalFolder = "local-folder",
  Remote = "remote",
}

export type EventOutboxTarget =
  | { kind: EventOutboxTargetKind.Unavailable }
  | {
      kind: EventOutboxTargetKind.LocalFolder;
      provider: StorageProvider;
    }
  | {
      kind: EventOutboxTargetKind.Remote;
      args: [string, string, string];
    };

export enum ProviderSyncRevisionKind {
  Untracked = "untracked",
  Tracked = "tracked",
}

export type ProviderSyncRevision =
  | { kind: ProviderSyncRevisionKind.Untracked }
  | { kind: ProviderSyncRevisionKind.Tracked; revision: string };

export enum ConflictProviderSaveKind {
  NotSaved = "not-saved",
  Saved = "saved",
}

export type ConflictProviderSave =
  | { kind: ConflictProviderSaveKind.NotSaved }
  | { kind: ConflictProviderSaveKind.Saved; providerId: string };

export type LocalFolderMultipleVaultsIssue = {
  providerId: string;
  providerLabel: string;
  storeIds: string[];
  message: string;
};

export enum LocalFolderInspectionKind {
  SingleVault = "single-vault",
  MultipleVaults = "multiple-vaults",
}

export type LocalFolderInspection =
  | { kind: LocalFolderInspectionKind.SingleVault }
  | {
      kind: LocalFolderInspectionKind.MultipleVaults;
      issue: LocalFolderMultipleVaultsIssue;
    };
