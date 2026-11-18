/** Relative builds run at the domain root or under a split-app preview mount. */
const SPLIT_APP_MOUNT = /^\/(?:simple|sentinel)(?=\/|$)/;

export class ApplicationPath {
  constructor(private readonly pathname: string) {}

  private get mount(): string {
    const base = import.meta.env.BASE_URL;
    if (base.startsWith("/")) return base.replace(/\/$/, "");
    return this.pathname.match(SPLIT_APP_MOUNT)?.[0] ?? "";
  }

  /** Build an absolute link so navigating from a nested page never stacks paths. */
  link(route: string): string {
    return `${this.mount}/${route.replace(/^\//, "")}`;
  }

  /** Decode only the complete mount segment, ignoring one terminal slash. */
  get relative(): string {
    const path = this.pathname.replace(/\/$/, "");
    const mount = this.mount;
    if (path === mount) return "/";
    if (path.startsWith(`${mount}/`)) return path.slice(mount.length);
    return path || "/";
  }

  /** Absolute-base deployments also accepted split-app bookmarks for workspaces. */
  get workspaceRelative(): string {
    const route = this.relative;
    if (import.meta.env.BASE_URL.startsWith("/"))
      return route.replace(SPLIT_APP_MOUNT, "") || "/";
    return route;
  }
}
