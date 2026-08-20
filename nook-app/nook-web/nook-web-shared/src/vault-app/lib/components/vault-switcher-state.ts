import type { NookLocalVaultEntry, StoreId } from "$app-wasm";

export enum VaultSwitchStateKind {
  Idle = "idle",
  Switching = "switching",
}

export type VaultSwitchState =
  | { kind: VaultSwitchStateKind.Idle }
  | { kind: VaultSwitchStateKind.Switching; storeId: StoreId };

export enum DisplayedVaultKind {
  Unavailable = "unavailable",
  Available = "available",
}

export type DisplayedVault =
  | { kind: DisplayedVaultKind.Unavailable }
  | { kind: DisplayedVaultKind.Available; entry: NookLocalVaultEntry };

export enum VaultSwitcherRootKind {
  Unmounted = "unmounted",
  Mounted = "mounted",
}

export type VaultSwitcherRoot =
  | { kind: VaultSwitcherRootKind.Unmounted }
  | { kind: VaultSwitcherRootKind.Mounted; element: HTMLDivElement };

export enum VaultSwitcherLayerKind {
  Unmounted = "unmounted",
  Mounted = "mounted",
}

export type VaultSwitcherLayer =
  | { kind: VaultSwitcherLayerKind.Unmounted }
  | { kind: VaultSwitcherLayerKind.Mounted; element: HTMLElement };

export enum VaultSwitcherMenuPlacementKind {
  Closed = "closed",
  Open = "open",
}

export type VaultSwitcherMenuAnchor = {
  top: number;
  left: number;
  minWidth: number;
};

export type VaultSwitcherMenuPlacement =
  | { kind: VaultSwitcherMenuPlacementKind.Closed }
  | ({ kind: VaultSwitcherMenuPlacementKind.Open } & VaultSwitcherMenuAnchor);

export type VaultSwitcherContainsNodeRequest = {
  root: VaultSwitcherRoot;
  menu: VaultSwitcherLayer;
  node: Node;
};

export function placeVaultSwitcherMenu(
  triggerRect: DOMRect,
): VaultSwitcherMenuAnchor {
  const minWidth = Math.max(triggerRect.width, 288);
  const maxLeft = Math.max(8, window.innerWidth - minWidth - 8);
  const left = Math.min(Math.max(8, triggerRect.left), maxLeft);
  return {
    top: triggerRect.bottom + 6,
    left,
    minWidth,
  };
}

export function portalVaultSwitcherMenu(node: HTMLElement) {
  const home = document.createComment("vault-switcher-menu-home");
  node.before(home);
  document.body.appendChild(node);
  return {
    destroy() {
      node.remove();
      home.remove();
    },
  };
}

export function vaultSwitcherContainsNode(
  request: VaultSwitcherContainsNodeRequest,
): boolean {
  if (
    request.root.kind === VaultSwitcherRootKind.Mounted &&
    request.root.element.contains(request.node)
  ) {
    return true;
  }
  return (
    request.menu.kind === VaultSwitcherLayerKind.Mounted &&
    request.menu.element.contains(request.node)
  );
}
