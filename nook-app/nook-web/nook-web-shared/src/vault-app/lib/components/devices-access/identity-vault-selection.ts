import {
  DashboardLoadKind,
  type DashboardLoadState,
  type DashboardView,
} from "../devices-access-dashboard-state";
import {
  IdentityDirectoryLoadKind,
  type IdentityDirectoryLoadState,
  IdentityDirectoryPresentation,
  IdentityDirectorySelectionKind,
} from "./identity-directory-view";
import {
  IdentityBridgeVaultSelectionKind,
  type IdentityBridgeVaultSelection,
} from "./identity-bridge-model";

type IdentityVaultSelectionInput = {
  loadState: DashboardLoadState<DashboardView>;
  directoryLoadState: IdentityDirectoryLoadState;
  selectedVault: IdentityBridgeVaultSelection;
};

/** Keeps a selected vault only while it belongs to the selected identity. */
export class IdentityVaultSelection {
  constructor(private readonly input: IdentityVaultSelectionInput) {}

  reset(): IdentityBridgeVaultSelection {
    const { loadState, directoryLoadState, selectedVault } = this.input;
    if (
      loadState.kind !== DashboardLoadKind.Ready ||
      directoryLoadState.kind !== IdentityDirectoryLoadKind.Ready
    )
      return selectedVault;
    const identitySelection = new IdentityDirectoryPresentation(
      directoryLoadState.view,
    ).selectedIdentity();
    if (identitySelection.kind === IdentityDirectorySelectionKind.Empty)
      return { kind: IdentityBridgeVaultSelectionKind.Empty };
    const [firstVault] = identitySelection.identity.vaults;
    if (!firstVault) return { kind: IdentityBridgeVaultSelectionKind.Empty };
    if (
      selectedVault.kind === IdentityBridgeVaultSelectionKind.Selected &&
      identitySelection.identity.vaults.some(
        (entry) => entry.storeId === selectedVault.storeId,
      )
    )
      return selectedVault;
    return {
      kind: IdentityBridgeVaultSelectionKind.Selected,
      storeId: firstVault.storeId,
    };
  }
}
