import type { StorageProvider } from "$lib/auth/providers";
import type { NookLocalFolderHealth } from "$app-wasm";

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

export enum EventOutboxRequestKind {
  Default = "default",
  LocalFolder = "local-folder",
  Remote = "remote",
}

export type EventOutboxRequest =
  | { kind: EventOutboxRequestKind.Default }
  | {
      kind: EventOutboxRequestKind.LocalFolder;
      provider: StorageProvider;
    }
  | {
      kind: EventOutboxRequestKind.Remote;
      provider: StorageProvider;
    };

export enum ConflictProviderSaveKind {
  NotSaved = "not-saved",
  Saved = "saved",
}

export type ConflictProviderSave =
  | { kind: ConflictProviderSaveKind.NotSaved }
  | { kind: ConflictProviderSaveKind.Saved; providerId: string };

export enum LocalFolderInspectionKind {
  SingleVault = "single-vault",
  MultipleVaults = "multiple-vaults",
}

export type LocalFolderInspection =
  | { kind: LocalFolderInspectionKind.SingleVault }
  | {
      kind: LocalFolderInspectionKind.MultipleVaults;
      issue: NookLocalFolderHealth;
    };
