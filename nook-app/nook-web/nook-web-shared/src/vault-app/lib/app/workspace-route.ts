import { err, ok, type Result } from "neverthrow";
import { I18N_KEYS } from "../../../generated/i18n-keys";
import {
  ApplicationRoutePresentation,
  ApplicationPath,
} from "$lib/content/legal";

export enum WorkspaceRoute {
  Vault = "vault",
  Identities = "identities",
  Keys = "keys",
  Vaults = "vaults",
  Settings = "settings",
  Devices = "devices",
  Sync = "sync",
  Passwords = "passwords",
  Import = "import",
  Help = "help",
}

export enum WorkspaceRouteLookupKind {
  Workspace = "workspace",
  Unknown = "unknown",
}

export type WorkspaceRouteLookup =
  | { kind: WorkspaceRouteLookupKind.Workspace; route: WorkspaceRoute }
  | { kind: WorkspaceRouteLookupKind.Unknown };

const WORKSPACE_PATHS: Record<WorkspaceRoute, string> = {
  [WorkspaceRoute.Vault]: "/vault",
  [WorkspaceRoute.Identities]: "/identities",
  [WorkspaceRoute.Keys]: "/identity/keys",
  [WorkspaceRoute.Vaults]: "/identity/vaults",
  [WorkspaceRoute.Settings]: "/identity/settings",
  [WorkspaceRoute.Devices]: "/vault/devices",
  [WorkspaceRoute.Sync]: "/vault/sync",
  [WorkspaceRoute.Passwords]: "/vault/passwords",
  [WorkspaceRoute.Import]: "/vault/import",
  [WorkspaceRoute.Help]: "/help",
};

/**
 * Paths from the previous workspace layout. They keep resolving so bookmarks
 * and enrollment links land on the page that now owns the same controls.
 */
const LEGACY_WORKSPACE_PATHS: Readonly<Record<string, WorkspaceRoute>> = {
  "/": WorkspaceRoute.Vault,
  "/app": WorkspaceRoute.Vault,
  "/simple": WorkspaceRoute.Vault,
  "/sentinel": WorkspaceRoute.Vault,
  "/devices-access": WorkspaceRoute.Keys,
  "/admin": WorkspaceRoute.Vaults,
  "/onboard": WorkspaceRoute.Devices,
  "/settings": WorkspaceRoute.Settings,
};

export enum WorkspaceNavigationOutcome {
  /** History moved to the destination and listeners were notified. */
  Navigated = "navigated",
  /** Already at the destination (or no browser history); nothing changed. */
  Unchanged = "unchanged",
}

export enum WorkspaceNavigationFailureKind {
  HistoryUpdateFailed = "history-update-failed",
}

export class WorkspaceNavigationFailure {
  readonly kind = WorkspaceNavigationFailureKind.HistoryUpdateFailed;
  readonly translationKey = I18N_KEYS.ErrorsVaultGeneric;
}

/** Build a canonical workspace URL while respecting a configured Vite base. */
export class WorkspaceLocation {
  constructor(private readonly request: WorkspaceRoute) {}
  get path(): string {
    const route = this.request;

    return new ApplicationRoutePresentation(WORKSPACE_PATHS[route]).appPath();
  }
  navigate(): Result<WorkspaceNavigationOutcome, WorkspaceNavigationFailure> {
    if (!("window" in globalThis))
      return ok(WorkspaceNavigationOutcome.Unchanged);
    const path = this.path;
    try {
      const nextUrl = new URL(path, window.location.href);
      if (
        window.location.pathname === nextUrl.pathname &&
        window.location.search === "" &&
        window.location.hash === ""
      )
        return ok(WorkspaceNavigationOutcome.Unchanged);
      const historyState: Parameters<typeof window.history.pushState>[0] = {};
      window.history.pushState(historyState, "", path);
      window.dispatchEvent(new PopStateEvent("popstate"));
      return ok(WorkspaceNavigationOutcome.Navigated);
    } catch {
      return err(new WorkspaceNavigationFailure());
    }
  }
}

/** Resolve a safe, non-sensitive workspace pathname. */
export class WorkspacePath {
  constructor(private readonly request: string) {}
  get route(): WorkspaceRouteLookup {
    const pathname = this.request;

    const relativePath =
      new ApplicationPath(pathname).relative.replace(/\/$/, "") || "/";
    const normalized = relativePath.replace(/^\/(?:simple|sentinel)(?=\/)/, "");
    const legacy = LEGACY_WORKSPACE_PATHS[normalized];
    if (legacy) {
      return { kind: WorkspaceRouteLookupKind.Workspace, route: legacy };
    }
    for (const route of Object.values(WorkspaceRoute)) {
      if (WORKSPACE_PATHS[route] === normalized) {
        return { kind: WorkspaceRouteLookupKind.Workspace, route };
      }
    }
    return { kind: WorkspaceRouteLookupKind.Unknown };
  }
}

/** Whether the current browser location is the identity Keys page. */
export function keysRouteOpen(): boolean {
  if (!("window" in globalThis)) return false;
  const route = new WorkspacePath(window.location.pathname).route;
  return (
    route.kind === WorkspaceRouteLookupKind.Workspace &&
    route.route === WorkspaceRoute.Keys
  );
}
