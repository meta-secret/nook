/** Shared SPA route helpers (no markdown or heavy imports). */

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
