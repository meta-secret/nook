import {
  IdentityBridgeVaultSelectionKind,
  type IdentityBridgeVaultSelection,
} from "./identity-bridge-elements";
import type { VaultAccessView } from "./access-chain";

export type SelectedIdentityVaultRequest = {
  readonly selection: IdentityBridgeVaultSelection;
  readonly vaults: readonly VaultAccessView[];
  readonly fallbackLabel: string;
};

/** Owns presentation of the selected vault in one identity's relationship view. */
export class SelectedIdentityVault {
  constructor(private readonly request: SelectedIdentityVaultRequest) {}
  get label(): string {
    const { selection, vaults, fallbackLabel } = this.request;
    if (selection.kind === IdentityBridgeVaultSelectionKind.Selected) {
      for (const vault of vaults)
        if (vault.storeId === selection.storeId) return vault.label;
    }
    return fallbackLabel;
  }
  get verified(): boolean {
    const { selection, vaults } = this.request;
    if (selection.kind === IdentityBridgeVaultSelectionKind.Selected) {
      for (const vault of vaults)
        if (vault.storeId === selection.storeId) return vault.verified;
    }
    return false;
  }
}
