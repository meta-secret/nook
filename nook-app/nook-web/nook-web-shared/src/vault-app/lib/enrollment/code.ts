import {
  buildEnrollmentLink as buildEnrollmentLinkCore,
  configuredVaultApplication,
  normalizeEnrollmentCode,
  VaultApplication,
} from "$app-wasm";

const ENROLLMENT_HASH_PREFIX = "#enroll=";

enum EnrollmentHistoryState {
  EnrollmentConsumed = "enrollment-consumed",
}

export enum EnrollmentLocationKind {
  Absent = "absent",
  Consumed = "consumed",
}

export type EnrollmentLocation =
  | { kind: EnrollmentLocationKind.Absent }
  | { kind: EnrollmentLocationKind.Consumed; payload: string };

enum EnrollmentUrlCodeKind {
  Absent = "absent",
  Present = "present",
}

type EnrollmentUrlCode =
  | { kind: EnrollmentUrlCodeKind.Absent }
  | { kind: EnrollmentUrlCodeKind.Present; code: string };

export function enrollmentAppRootUrl(
  siteRoot: string,
  appKind: VaultApplication = configuredVaultApplication(),
): string {
  const normalized = siteRoot.replace(/\/$/, "");
  if (
    appKind === VaultApplication.Simple ||
    appKind === VaultApplication.Sentinel
  ) {
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
export function consumeEnrollmentFromLocation(): EnrollmentLocation {
  if (!("window" in globalThis)) {
    return { kind: EnrollmentLocationKind.Absent };
  }

  const url = new URL(window.location.href);
  const raw = enrollmentCodeFromUrl(url);

  if (raw.kind === EnrollmentUrlCodeKind.Absent) {
    return { kind: EnrollmentLocationKind.Absent };
  }

  history.replaceState(
    { state: EnrollmentHistoryState.EnrollmentConsumed },
    "",
    `${url.pathname}${url.search}${url.hash}`,
  );
  return {
    kind: EnrollmentLocationKind.Consumed,
    payload: normalizeEnrollmentCode(raw.code),
  };
}

function enrollmentCodeFromUrl(url: URL): EnrollmentUrlCode {
  if (url.hash.startsWith(ENROLLMENT_HASH_PREFIX)) {
    const code = decodeURIComponent(
      url.hash.slice(ENROLLMENT_HASH_PREFIX.length),
    );
    url.hash = "";
    return { kind: EnrollmentUrlCodeKind.Present, code };
  }
  const code = url.searchParams.get("enroll")?.valueOf();
  if (code) {
    url.searchParams.delete("enroll");
    return { kind: EnrollmentUrlCodeKind.Present, code };
  }
  return { kind: EnrollmentUrlCodeKind.Absent };
}
