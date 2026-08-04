import { appPath, stripBasePath } from "$lib/content/legal";

export enum WorkspaceRoute {
  Vault = "vault",
  DevicesAccess = "devices-access",
  Admin = "admin",
  Onboard = "onboard",
  Settings = "settings",
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
  [WorkspaceRoute.DevicesAccess]: "/devices-access",
  [WorkspaceRoute.Admin]: "/admin",
  [WorkspaceRoute.Onboard]: "/onboard",
  [WorkspaceRoute.Settings]: "/settings",
  [WorkspaceRoute.Help]: "/help",
};

/** Build a canonical workspace URL while respecting a configured Vite base. */
export function workspacePath(route: WorkspaceRoute): string {
  return appPath(WORKSPACE_PATHS[route]);
}

/** Resolve a safe, non-sensitive workspace pathname. */
export function workspaceRouteFromPath(pathname: string): WorkspaceRouteLookup {
  const normalized = stripBasePath(pathname).replace(/\/$/, "") || "/";
  switch (normalized) {
    case "/":
    case "/app":
    case "/simple":
    case "/sentinel":
    case "/vault":
      return {
        kind: WorkspaceRouteLookupKind.Workspace,
        route: WorkspaceRoute.Vault,
      };
    case "/devices-access":
      return {
        kind: WorkspaceRouteLookupKind.Workspace,
        route: WorkspaceRoute.DevicesAccess,
      };
    case "/admin":
      return {
        kind: WorkspaceRouteLookupKind.Workspace,
        route: WorkspaceRoute.Admin,
      };
    case "/onboard":
      return {
        kind: WorkspaceRouteLookupKind.Workspace,
        route: WorkspaceRoute.Onboard,
      };
    case "/settings":
      return {
        kind: WorkspaceRouteLookupKind.Workspace,
        route: WorkspaceRoute.Settings,
      };
    case "/help":
      return {
        kind: WorkspaceRouteLookupKind.Workspace,
        route: WorkspaceRoute.Help,
      };
    default:
      return { kind: WorkspaceRouteLookupKind.Unknown };
  }
}
