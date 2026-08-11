import {
  BrowserOAuthProvider,
  OAuthOriginUnsupportedReason,
  resolve_oauth_origin_support,
} from "$app-wasm";

export {
  BrowserOAuthProvider,
  OAuthOriginUnsupportedReason,
  is_cloudflare_pr_preview_host,
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
  const resolved = resolve_oauth_origin_support(
    provider,
    location.origin,
    location.hostname,
  );
  try {
    if (resolved.is_unsupported()) {
      return {
        supported: false,
        origin: resolved.origin,
        reason: resolved.unsupported_reason(),
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
