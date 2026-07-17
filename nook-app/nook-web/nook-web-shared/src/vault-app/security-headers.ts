/**
 * Cloudflare Pages response headers shared by the two isolated vault apps.
 *
 * Google Identity Services and Apple CloudKit load third-party scripts, so the
 * CSP must allow those exact hosts. Without them, the browser blocks
 * `https://accounts.google.com/gsi/client` / CloudKit JS and the UI surfaces
 * "Failed to load Google Identity Services" / "Failed to load CloudKit JS".
 *
 * @see https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid#content_security_policy
 */

/** GIS script URL required in `script-src` for Drive OAuth. */
export const GOOGLE_GIS_SCRIPT_SRC = "https://accounts.google.com/gsi/client";
/** GIS iframe parent required in `frame-src` / `connect-src` parent path. */
export const GOOGLE_GIS_FRAME_SRC = "https://accounts.google.com/gsi/";
/** GIS stylesheet host (token client may inject One Tap / button styles). */
export const GOOGLE_GIS_STYLE_SRC = "https://accounts.google.com/gsi/style";
/** Apple CloudKit JS CDN host for iCloud provider setup. */
export const APPLE_CLOUDKIT_SCRIPT_SRC = "https://cdn.apple-cloudkit.com";

export function vaultAppContentSecurityPolicy(): string {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src 'self' 'wasm-unsafe-eval' ${GOOGLE_GIS_SCRIPT_SRC} ${APPLE_CLOUDKIT_SCRIPT_SRC}`,
    `style-src 'self' 'unsafe-inline' ${GOOGLE_GIS_STYLE_SRC}`,
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    // HTTPS APIs (Drive, CloudKit, GIS status) share one allowlist.
    `connect-src 'self' https: ${GOOGLE_GIS_FRAME_SRC}`,
    `frame-src ${GOOGLE_GIS_FRAME_SRC}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
  ].join("; ");
}

export function vaultAppHeaders(): string {
  return `/*
  Content-Security-Policy: ${vaultAppContentSecurityPolicy()}
  Cross-Origin-Opener-Policy: same-origin-allow-popups
  Cross-Origin-Resource-Policy: same-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
  Referrer-Policy: no-referrer
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY

/*.html
  Cache-Control: no-cache

/assets/*
  Cache-Control: public, max-age=31536000, immutable
`;
}
