/** Shared SPA route helpers (no markdown or heavy imports). */

export function stripBasePath(pathname: string): string {
  const base = import.meta.env.BASE_URL;
  if (base !== "/" && pathname.startsWith(base)) {
    const rest = pathname.slice(base.length);
    return rest ? `/${rest.replace(/^\//, "")}` : "/";
  }
  return pathname;
}
