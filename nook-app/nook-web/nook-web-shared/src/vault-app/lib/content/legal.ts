import privacyPolicyMd from "../../../../../../../docs/privacy-policy.md?raw";
import termsOfServiceMd from "../../../../../../../docs/terms-of-service.md?raw";
import { ApplicationPath } from "$lib/runtime/routes";

export enum LegalPageId {
  Privacy = "privacy",
  Terms = "terms",
}

export enum LegalPageLookupKind {
  ApplicationPath = "application-path",
  LegalPage = "legal-page",
}

export type LegalPageLookup =
  | { kind: LegalPageLookupKind.ApplicationPath }
  | { kind: LegalPageLookupKind.LegalPage; page: LegalPageId };

export type LegalPage = {
  id: LegalPageId;
  title: string;
  path: string;
  source: string;
};

export const LEGAL_PAGES: Record<LegalPageId, LegalPage> = {
  privacy: {
    id: LegalPageId.Privacy,
    title: "Privacy Policy",
    path: "/privacy",
    source: privacyPolicyMd,
  },
  terms: {
    id: LegalPageId.Terms,
    title: "Terms of Service",
    path: "/terms",
    source: termsOfServiceMd,
  },
};

const LEGAL_PATHS = new Map(
  Object.values(LEGAL_PAGES).map((page) => [page.path, page.id] as const),
);

/** Diagnostic application-log viewer route (`/logs`). */
export const LOGS_PATH = "/logs";

export class ApplicationRoutePresentation {
  constructor(private readonly value: string) {}
  appPath(): string {
    const path = this.value;
    const pathname = "window" in globalThis ? window.location.pathname : "/";
    return new ApplicationPath(pathname).link(path);
  }

  getLegalPageFromPath(): LegalPageLookup {
    const pathname = this.value;
    const normalized = new ApplicationPath(pathname).relative;
    const page = LEGAL_PATHS.get(normalized);
    if (!page) {
      return { kind: LegalPageLookupKind.ApplicationPath };
    }
    return {
      kind: LegalPageLookupKind.LegalPage,
      page,
    };
  }

  isLogsPath(): boolean {
    const pathname = this.value;
    const normalized = new ApplicationPath(pathname).relative;
    return normalized === LOGS_PATH;
  }
}

export class LegalPageSelection {
  constructor(private readonly value: LegalPageId) {}
  legalPageForId(): LegalPage {
    const id = this.value;
    return LEGAL_PAGES[id];
  }
}
