import {
  BrowserOAuthProvider,
  OAuthOriginUnsupportedReason,
  resolveOAuthOriginSupport as wasmResolveOAuthOriginSupport,
} from "$app-wasm";

export {
  BrowserOAuthProvider,
  OAuthOriginUnsupportedReason,
  isCloudflarePrPreviewHost,
} from "$app-wasm";

export type OAuthOriginSupport =
  | {
      supported: true;
      origin: string;
    }
  | {
      supported: false;
      origin: string;
      reason: OAuthOriginUnsupportedReason;
    };

type BrowserLocation = Pick<Location, "origin" | "hostname">;

export function resolveOAuthOriginSupport({
  provider,
  location,
}: {
  readonly provider: BrowserOAuthProvider;
  readonly location: BrowserLocation;
}): OAuthOriginSupport {
  const resolved = wasmResolveOAuthOriginSupport(
    provider,
    location.origin,
    location.hostname,
  );
  try {
    if (resolved.isUnsupported()) {
      return {
        supported: false,
        origin: resolved.origin,
        reason: resolved.unsupportedReason(),
      };
    }
    return {
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
      supported: true,
      origin: "",
    };
  }
  const resolveOAuthOriginSupportArgs: Parameters<
    typeof resolveOAuthOriginSupport
  >[0] = { provider, location: window.location };
  return resolveOAuthOriginSupport(resolveOAuthOriginSupportArgs);
}
