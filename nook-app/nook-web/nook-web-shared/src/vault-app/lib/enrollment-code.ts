import { omittedValue } from "../../explicit-state";
import {
  buildEnrollmentLink as buildEnrollmentLinkCore,
  normalizeEnrollmentCode,
} from "$app-wasm";
import { APP_KIND, AppKind } from "$lib/app-kind";

const ENROLLMENT_HASH_PREFIX = "#enroll=";

export function enrollmentAppRootUrl(
  siteRoot: string,
  appKind: AppKind = APP_KIND,
): string {
  const normalized = siteRoot.replace(/\/$/, "");
  if (appKind === AppKind.Simple || appKind === AppKind.Sentinel) {
    return `${normalized}/`;
  }
  return normalized.endsWith("/app") ? `${normalized}/` : `${normalized}/app/`;
}

/** Vault app root used in QR links (`/app/` below the public site root). */
export function getEnrollmentLinkBase(): string {
  if (!("window" in globalThis)) {
    return "";
  }
  const configured = import.meta.env.VITE_PUBLIC_APP_URL?.trim();
  if (configured) {
    return enrollmentAppRootUrl(configured);
  }
  const basePath = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
  return enrollmentAppRootUrl(`${window.location.origin}${basePath}`);
}

/** Deep link scanned from a QR code — opens the browser and carries the raw code in the hash. */
export function buildEnrollmentLink(
  code: string,
  baseUrl = getEnrollmentLinkBase(),
): string {
  return buildEnrollmentLinkCore(code, baseUrl);
}

/**
 * Read an enrollment code from the current page URL (hash or query), then
 * strip it from the address bar so secrets do not linger in history.
 */
export function consumeEnrollmentFromLocation(): string | void {
  if (!("window" in globalThis)) {
    return;
  }

  const url = new URL(window.location.href);
  const raw = enrollmentCodeFromUrl(url);

  if (!raw) {
    return;
  }

  history.replaceState(
    omittedValue(),
    "",
    `${url.pathname}${url.search}${url.hash}`,
  );
  return normalizeEnrollmentCode(raw);
}

function enrollmentCodeFromUrl(url: URL): string | void {
  if (url.hash.startsWith(ENROLLMENT_HASH_PREFIX)) {
    const code = decodeURIComponent(
      url.hash.slice(ENROLLMENT_HASH_PREFIX.length),
    );
    url.hash = "";
    return code;
  }
  const code = url.searchParams.get("enroll")?.valueOf();
  if (code) {
    url.searchParams.delete("enroll");
  }
  return code;
}
