import type { PasswordEntryId } from "$app-wasm";
import type { NookPasswordEntrySummary, StorageProvider } from "$app-wasm";
import {
  CompatibleProviderPreferenceKind,
  type CompatibleProviderPreference,
} from "$lib/vault-architecture";

export {
  CompatibleProviderPreferenceKind as ProviderSelectionKind,
  type CompatibleProviderPreference as ProviderSelection,
};

export enum PasswordEntrySelectionKind {
  NotSelected = "not-selected",
  Selected = "selected",
}

export type PasswordEntrySelection =
  | { kind: PasswordEntrySelectionKind.NotSelected }
  | { kind: PasswordEntrySelectionKind.Selected; entryId: PasswordEntryId };

export enum ResolvedOnboardingProviderKind {
  Unavailable = "unavailable",
  Available = "available",
}

export type ResolvedOnboardingProvider =
  | { kind: ResolvedOnboardingProviderKind.Unavailable }
  | {
      kind: ResolvedOnboardingProviderKind.Available;
      provider: StorageProvider;
    };

export enum ResolvedOnboardingPasswordKind {
  Unavailable = "unavailable",
  Available = "available",
}

export type ResolvedOnboardingPassword =
  | { kind: ResolvedOnboardingPasswordKind.Unavailable }
  | {
      kind: ResolvedOnboardingPasswordKind.Available;
      entry: NookPasswordEntrySummary;
    };
