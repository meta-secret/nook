export type AppKind = "unified-development" | "simple" | "sentinel";

declare const __NOOK_APP_KIND__: AppKind;

export const APP_KIND: AppKind = __NOOK_APP_KIND__;

export const IS_SIMPLE_APP = APP_KIND === "simple";
export const IS_SENTINEL_APP = APP_KIND === "sentinel";
export const SUPPORTS_EXTENSION = APP_KIND !== "sentinel";

export function siblingAppUrl(): string | undefined {
  if (IS_SIMPLE_APP) return "https://sentinel.nokey.sh/";
  if (IS_SENTINEL_APP) return "https://simple.nokey.sh/";
  return undefined;
}
