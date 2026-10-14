/** Shared SPA route helpers (no markdown or heavy imports). */

/** Prefixes a relative-base build is mounted under besides a domain root. */
const RELATIVE_BASE_MOUNTS: readonly string[] = ["/simple/", "/sentinel/"];

/**
 * The absolute path this app is served under. Simple and Sentinel build with
 * a relative base so one bundle runs at a domain root and under `/simple/` or
 * `/sentinel/` in the preview harness. Workspace routes are nested, so URLs
 * built from a relative base must still be absolute.
 */
export class ApplicationBase {
  constructor(private readonly pathname: string) {}
  get root(): string {
    const base = import.meta.env.BASE_URL;
    if (base.startsWith("/")) return base;
    const mounted = `${this.pathname.replace(/\/$/, "")}/`;
    const mount = RELATIVE_BASE_MOUNTS.find((prefix) =>
      mounted.startsWith(prefix),
    );
    return mount ? mount : "/";
  }
}

export class ApplicationPath {
  constructor(private readonly request: string) {}
  get relative(): string {
    const pathname = this.request;

    const base = import.meta.env.BASE_URL;
    if (base !== "/" && pathname.startsWith(base)) {
      const rest = pathname.slice(base.length);
      return rest ? `/${rest.replace(/^\//, "")}` : "/";
    }
    return pathname;
  }
}
