type EnrollmentApplicationRoot = {
  readonly siteRoot: string;
  readonly appKind: VaultApplication;
};

type EnrollmentSiteRootSources = {
  readonly appKind: VaultApplication;
  readonly configuredUrl: string;
  readonly servingOrigin: string;
  readonly basePath: string;
};

type EnrollmentLinkRequest = {
  readonly code: string;
  readonly baseUrl: string;
};
import {
  build_enrollment_link,
  configured_vault_application,
  normalize_enrollment_code,
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

function isIsolatedVaultApplication(appKind: VaultApplication): boolean {
  return (
    appKind === VaultApplication.Simple || appKind === VaultApplication.Sentinel
  );
}

/** Owns enrollment URL consumption and history cleanup for its browser host. */
class EnrollmentBrowser {
  constructor(private readonly browser: typeof globalThis) {}

  enrollmentAppRootUrl({
    siteRoot,
    appKind,
  }: EnrollmentApplicationRoot): string {
    const normalized = siteRoot.replace(/\/$/, "");
    if (isIsolatedVaultApplication(appKind)) {
      return `${normalized}/`;
    }
    return normalized.endsWith("/app")
      ? `${normalized}/`
      : `${normalized}/app/`;
  }

  /** Isolated vault apps are served at their own root, so links use the origin serving the page. */
  enrollmentSiteRoot({
    appKind,
    configuredUrl,
    servingOrigin,
    basePath,
  }: EnrollmentSiteRootSources): string {
    if (isIsolatedVaultApplication(appKind)) {
      return servingOrigin;
    }
    return configuredUrl || `${servingOrigin}${basePath}`;
  }

  getEnrollmentLinkBase(): string {
    if (!("window" in this.browser)) {
      return "";
    }
    const appKind = configured_vault_application();
    const enrollmentSiteRootArgs: Parameters<
      typeof this.enrollmentSiteRoot
    >[0] = {
      appKind,
      configuredUrl: ((...[v = ""]) => v)(
        import.meta.env.VITE_PUBLIC_APP_URL,
      ).trim(),
      servingOrigin: this.browser.window.location.origin,
      basePath: ((...[v = "/"]) => v)(import.meta.env.BASE_URL).replace(
        /\/$/,
        "",
      ),
    };
    const enrollmentAppRootUrlArgs: Parameters<
      typeof this.enrollmentAppRootUrl
    >[0] = {
      siteRoot: this.enrollmentSiteRoot(enrollmentSiteRootArgs),
      appKind,
    };
    return this.enrollmentAppRootUrl(enrollmentAppRootUrlArgs);
  }

  buildEnrollmentLink({ code, baseUrl }: EnrollmentLinkRequest): string {
    return build_enrollment_link(code, baseUrl);
  }

  consumeEnrollmentFromLocation(): EnrollmentLocation {
    if (!("window" in this.browser)) {
      return { kind: EnrollmentLocationKind.Absent };
    }

    const url = new URL(this.browser.window.location.href);
    const raw = this.enrollmentCodeFromUrl(url);

    if (raw.kind === EnrollmentUrlCodeKind.Absent) {
      return { kind: EnrollmentLocationKind.Absent };
    }

    const replaceStateArgs: Parameters<
      typeof this.browser.history.replaceState
    >[0] = {
      state: EnrollmentHistoryState.EnrollmentConsumed,
    };
    this.browser.history.replaceState(
      replaceStateArgs,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
    return {
      kind: EnrollmentLocationKind.Consumed,
      payload: normalize_enrollment_code(raw.code),
    };
  }

  private enrollmentCodeFromUrl(url: URL): EnrollmentUrlCode {
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
}

export const enrollmentBrowser = new EnrollmentBrowser(globalThis);
