import { WorkspaceRoute } from "$lib/app/workspace-route";

enum KeptRouteKind {
  None = "none",
  Kept = "kept",
}

type KeptRoute =
  | { readonly kind: KeptRouteKind.None }
  | { readonly kind: KeptRouteKind.Kept; readonly route: WorkspaceRoute };

/**
 * The page Open vault leads to. Unlocking from a vault's panel shows the
 * identities page first; a deep link the lock interrupted is kept so Open
 * returns to it once, and the identities page otherwise opens the vault.
 */
export class UnlockReturn {
  private kept: KeptRoute = { kind: KeptRouteKind.None };

  /** Unlocking in place from `route` keeps it when it is a deep link. */
  remember(route: WorkspaceRoute): void {
    this.kept =
      route === WorkspaceRoute.Identities
        ? { kind: KeptRouteKind.None }
        : { kind: KeptRouteKind.Kept, route };
  }

  /** Unlocking from a page outside the workspace keeps nothing. */
  forget(): void {
    this.kept = { kind: KeptRouteKind.None };
  }

  /** The page Open vault leads to from `route`; a kept deep link is used once. */
  routeFrom(route: WorkspaceRoute): WorkspaceRoute {
    const kept = this.kept;
    this.kept = { kind: KeptRouteKind.None };
    if (route !== WorkspaceRoute.Identities) return route;
    return kept.kind === KeptRouteKind.Kept ? kept.route : WorkspaceRoute.Vault;
  }
}
