export enum AppKind {
  UnifiedDevelopment = "unified-development",
  Simple = "simple",
  Sentinel = "sentinel",
}

declare const __NOOK_APP_KIND__: AppKind;

export const APP_KIND: AppKind = __NOOK_APP_KIND__;

export const IS_SIMPLE_APP = APP_KIND === AppKind.Simple;
export const IS_SENTINEL_APP = APP_KIND === AppKind.Sentinel;
export const SUPPORTS_EXTENSION = APP_KIND !== AppKind.Sentinel;

const SIMPLE_APP_URL =
  import.meta.env.VITE_SIMPLE_APP_URL?.trim() || "https://simple.nokey.sh";

export function siblingAppUrl(): string | void {
  if (IS_SENTINEL_APP) return `${SIMPLE_APP_URL.replace(/\/$/, "")}/`;
  return;
}
