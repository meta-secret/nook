import { VaultApplication } from "$app-wasm";

declare const __NOOK_APP_KIND__: VaultApplication;

export const APP_KIND: VaultApplication = __NOOK_APP_KIND__;

export const IS_SIMPLE_APP = APP_KIND === VaultApplication.Simple;
export const IS_SENTINEL_APP = APP_KIND === VaultApplication.Sentinel;
export const SUPPORTS_EXTENSION = APP_KIND !== VaultApplication.Sentinel;

const SIMPLE_APP_URL =
  import.meta.env.VITE_SIMPLE_APP_URL?.trim() || "https://simple.nokey.sh";

export function siblingAppUrl(): string | void {
  if (IS_SENTINEL_APP) return `${SIMPLE_APP_URL.replace(/\/$/, "")}/`;
  return;
}
