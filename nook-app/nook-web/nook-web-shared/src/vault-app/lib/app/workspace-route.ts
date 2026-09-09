import {
  ApplicationRoutePresentation,
  ApplicationPath,
} from "$lib/content/legal";

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
export class WorkspaceLocation {
  constructor(private readonly request: WorkspaceRoute) {}
  get path(): string {
    const route = this.request;

    return new ApplicationRoutePresentation(WORKSPACE_PATHS[route]).appPath();
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
}
