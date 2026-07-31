import {
  BrowserOAuthProvider as WasmBrowserOAuthProvider,
  OAuthOriginUnsupportedReason as WasmOAuthOriginUnsupportedReason,
  resolveOAuthOriginSupport as wasmResolveOAuthOriginSupport,
} from "$app-wasm";

export { isCloudflarePrPreviewHost } from "$app-wasm";

export enum BrowserOAuthProvider {
  GoogleDrive = "google-drive",
  ICloud = "icloud",
}

export enum OAuthOriginSupportKind {
  Supported = "supported",
  Unsupported = "unsupported",
}

export enum OAuthOriginUnsupportedReason {
  CloudflarePreview = "cloudflare-pr-preview",
  UnregisteredOrigin = "unregistered-origin",
}

export type OAuthOriginSupport =
  | {
      kind: OAuthOriginSupportKind.Supported;
      supported: true;
      origin: string;
    }
  | {
      kind: OAuthOriginSupportKind.Unsupported;
      supported: false;
      origin: string;
      reason: OAuthOriginUnsupportedReason;
    };

type BrowserLocation = Pick<Location, "origin" | "hostname">;

function toWasmProvider(
  provider: BrowserOAuthProvider,
): WasmBrowserOAuthProvider {
  return provider === BrowserOAuthProvider.ICloud
    ? WasmBrowserOAuthProvider.ICloud
    : WasmBrowserOAuthProvider.GoogleDrive;
}

function fromWasmReason(
  reason: WasmOAuthOriginUnsupportedReason,
): OAuthOriginUnsupportedReason {
  return reason === WasmOAuthOriginUnsupportedReason.CloudflarePrPreview
    ? OAuthOriginUnsupportedReason.CloudflarePreview
    : OAuthOriginUnsupportedReason.UnregisteredOrigin;
}

export function resolveOAuthOriginSupport(
  provider: BrowserOAuthProvider,
  location: BrowserLocation,
): OAuthOriginSupport {
  const resolved = wasmResolveOAuthOriginSupport(
    toWasmProvider(provider),
    location.origin,
    location.hostname,
  );
  try {
    if (resolved.isUnsupported()) {
      return {
        kind: OAuthOriginSupportKind.Unsupported,
        supported: false,
        origin: resolved.origin,
        reason: fromWasmReason(resolved.unsupportedReason()),
      };
    }
    return {
      kind: OAuthOriginSupportKind.Supported,
      supported: true,
      origin: resolved.origin,
    };
  } finally {
    resolved.free();
  }
}

export function resolveCurrentOAuthOriginSupport(
  provider: BrowserOAuthProvider,
): OAuthOriginSupport {
  if (!("window" in globalThis)) {
    return {
      kind: OAuthOriginSupportKind.Supported,
      supported: true,
      origin: "",
    };
  }
  return resolveOAuthOriginSupport(provider, window.location);
}
