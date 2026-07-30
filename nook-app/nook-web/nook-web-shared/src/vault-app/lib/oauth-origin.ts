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

const GOOGLE_AUTHORIZED_ORIGINS = new Set([
  "https://localhost:5173",
  "https://localhost:5175",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "https://simple.nokey.sh",
  "https://sentinel.nokey.sh",
  "https://simple.dev.nokey.sh",
  "https://sentinel.dev.nokey.sh",
]);
const ICLOUD_AUTHORIZED_ORIGINS = new Set([
  "https://localhost:5173",
  "https://localhost:5175",
  "https://simple.nokey.sh",
  "https://sentinel.nokey.sh",
  "https://simple.dev.nokey.sh",
  "https://sentinel.dev.nokey.sh",
]);
const CLOUDFLARE_PR_PREVIEW_HOST =
  /^pr-\d+\.(?:nook-1n8|nokey-(?:sh|simple|sentinel))\.pages\.dev$/i;

function isAuthorizedOrigin(
  provider: BrowserOAuthProvider,
  origin: string,
): boolean {
  const origins =
    provider === BrowserOAuthProvider.ICloud
      ? ICLOUD_AUTHORIZED_ORIGINS
      : GOOGLE_AUTHORIZED_ORIGINS;
  return origins.has(origin);
}

export function isCloudflarePrPreviewHost(hostname: string): boolean {
  return CLOUDFLARE_PR_PREVIEW_HOST.test(hostname);
}

export function resolveOAuthOriginSupport(
  provider: BrowserOAuthProvider,
  location: BrowserLocation,
): OAuthOriginSupport {
  const origin = location.origin;
  if (isAuthorizedOrigin(provider, origin)) {
    return { kind: OAuthOriginSupportKind.Supported, supported: true, origin };
  }

  return {
    kind: OAuthOriginSupportKind.Unsupported,
    supported: false,
    origin,
    reason: isCloudflarePrPreviewHost(location.hostname)
      ? OAuthOriginUnsupportedReason.CloudflarePreview
      : OAuthOriginUnsupportedReason.UnregisteredOrigin,
  };
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
