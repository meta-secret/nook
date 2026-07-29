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
