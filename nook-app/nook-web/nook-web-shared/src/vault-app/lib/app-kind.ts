export type AppKind = "unified-development" | "simple" | "sentinel";

declare const __NOOK_APP_KIND__: AppKind;

export const APP_KIND: AppKind = __NOOK_APP_KIND__;

export const IS_SIMPLE_APP = APP_KIND === "simple";
export const IS_SENTINEL_APP = APP_KIND === "sentinel";
export const SUPPORTS_EXTENSION = APP_KIND !== "sentinel";

const SIMPLE_APP_URL =
  import.meta.env.VITE_SIMPLE_APP_URL?.trim() || "https://simple.nokey.sh";

export function siblingAppUrl(): string | undefined {
  if (IS_SENTINEL_APP) return `${SIMPLE_APP_URL.replace(/\/$/, "")}/`;
  return undefined;
}
