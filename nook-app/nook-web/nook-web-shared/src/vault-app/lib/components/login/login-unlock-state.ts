import type { NookLocalVaultEntry } from "$app-wasm";

export enum UnlockMethod {
  Keys = "keys",
  Password = "password",
}

export enum LoginVaultWorkflow {
  Open = "open",
  Create = "create",
  Import = "import",
}

export enum LoginVaultEntryKind {
  Unavailable = "unavailable",
  Available = "available",
}

export type LoginVaultEntry =
  | { kind: LoginVaultEntryKind.Unavailable }
  | { kind: LoginVaultEntryKind.Available; entry: NookLocalVaultEntry };

type VaultPasswordUnlock = {
  readonly entryId: string;
  readonly password: string;
};

export enum PasswordUnlockCapabilityKind {
  Unavailable = "unavailable",
  Available = "available",
}

export type PasswordUnlockCapability =
  | { kind: PasswordUnlockCapabilityKind.Unavailable }
  | {
      kind: PasswordUnlockCapabilityKind.Available;
      unlock(request: VaultPasswordUnlock): void | Promise<void>;
    };

export enum DeviceKeysUnlockCapabilityKind {
  Unknown = "unknown",
  Available = "available",
  Unavailable = "unavailable",
}

export type DeviceKeysUnlockCapability =
  | { kind: DeviceKeysUnlockCapabilityKind.Unknown }
  | { kind: DeviceKeysUnlockCapabilityKind.Available }
  | {
      kind: DeviceKeysUnlockCapabilityKind.Unavailable;
      reason: string;
    };
