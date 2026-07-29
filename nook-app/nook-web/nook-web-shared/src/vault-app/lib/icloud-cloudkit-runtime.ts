import { omittedValue } from "../../explicit-state";
import {
  ICLOUD_API_TOKEN,
  ICLOUD_CONTAINER_ID,
  ICLOUD_ENVIRONMENT,
} from "$lib/icloud-oauth-config";
import { createLogger } from "$lib/log";

const CLOUDKIT_SCRIPT_URL = "https://cdn.apple-cloudkit.com/ck/2/cloudkit.js";
export const CLOUDKIT_SIGN_IN_BUTTON_ID = "apple-sign-in-button";
export const CLOUDKIT_SIGN_OUT_BUTTON_ID = "apple-sign-out-button";
const log = createLogger("icloud-oauth");

export type CloudKitUserIdentity = {
  userRecordName?: string;
  nameComponents?: { givenName?: string; familyName?: string };
  lookupInfo?: { emailAddress?: string };
};

export type CloudKitZoneID = {
  zoneName: string;
  ownerRecordName?: string;
};

export type CloudKitRecord = {
  recordType: string;
  recordName: string;
  recordChangeTag?: string;
  createShortGUID?: boolean;
  shortGUID?: string;
  fields?: Record<string, { value: unknown }>;
};

export type CloudKitRecordsResponse = {
  records: CloudKitRecord[];
};

export type CloudKitRecordInfo = {
  zoneID?: CloudKitZoneID;
  rootRecordName?: string;
  rootRecord?: CloudKitRecord;
  participantStatus?: "INVITED" | "ACCEPTED" | "REMOVED" | "UNKNOWN";
};

export type CloudKitRecordInfosResponse = {
  results: CloudKitRecordInfo[];
};

export type CloudKitDatabase = {
  saveRecordZones: (zones: CloudKitZoneID[]) => Promise<unknown>;
  saveRecords: (
    records: CloudKitRecord | CloudKitRecord[],
    options: { zoneID: string | CloudKitZoneID },
  ) => Promise<CloudKitRecordsResponse>;
  shareWithUI: (options: {
    record: CloudKitRecord;
    zoneID: string | CloudKitZoneID;
    shareTitle: string;
    shareType: string;
    supportedAccess: Array<"PRIVATE" | "PUBLIC">;
    supportedPermissions: Array<"READ_WRITE" | "READ_ONLY">;
  }) => Promise<unknown>;
};

export type CloudKitAuthError = {
  _reason?: string;
  code?: string | number;
  errorCode?: string | number;
  message?: string;
  name?: string;
  reason?: string;
  redirectURL?: string;
  serverErrorCode?: string | number;
  status?: string | number;
  statusCode?: string | number;
  statusText?: string;
  uuid?: string;
};

export type CloudKitAuthErrorDetails = {
  code?: string;
  message?: string;
  redirectURLPresent?: boolean;
  redirectURLOrigin?: string;
  redirectURLPathname?: string;
  reason?: string;
  status?: number;
  statusText?: string;
  uuidPresent?: boolean;
};

export type CloudKitAuthChallenge = {
  reason?: string;
  redirectURL?: string;
  serverErrorCode?: string;
  uuid?: string;
};

export type CloudKitContainer = {
  setUpAuth: (options?: {
    grabAuthToken?: boolean;
    persist?: boolean;
  }) => Promise<CloudKitUserIdentity | void>;
  whenUserSignsIn: () => Promise<CloudKitUserIdentity>;
  fetchCurrentUserIdentity?: () => Promise<CloudKitUserIdentity>;
  acceptShares?: (shortGUIDs: string[]) => Promise<CloudKitRecordInfosResponse>;
  fetchRecordInfos?: (
    shortGUIDs: string[],
  ) => Promise<CloudKitRecordInfosResponse>;
  privateCloudDatabase?: CloudKitDatabase;
  sharedCloudDatabase?: CloudKitDatabase;
};

export type CloudKitAuthTokenStore = {
  putToken: (containerIdentifier: string, authToken: unknown) => void;
  getToken: (containerIdentifier: string) => unknown;
};

export type CloudKitGlobal = {
  configure: (config: {
    containers: Array<{
      containerIdentifier: string;
      environment: "development" | "production";
      apiTokenAuth: {
        apiToken: string;
        persist: boolean;
        signInButton: {
          id: string;
          theme?: "black" | "white" | "white-with-outline";
        };
        signOutButton: {
          id: string;
          theme?: "black" | "white" | "white-with-outline";
        };
      };
    }>;
    services?: {
      authTokenStore?: CloudKitAuthTokenStore;
    };
  }) => void;
  getDefaultContainer: () => CloudKitContainer;
};

const ICLOUD_AUTH_TOKEN_STORAGE_PREFIX = "nook.icloud.webAuthToken.";

export const webAuthTokenListeners = new Set<(token: string) => void>();

export function tokenDiagnostics(token: string | void): {
  present: boolean;
  length: number;
} {
  return {
    present: Boolean(token),
    length: token?.length ?? 0,
  };
}

export function sanitizedURLDiagnostics(url: string | void): {
  present: boolean;
  origin?: string;
  pathname?: string;
} {
  if (!url) {
    return { present: false };
  }
  try {
    const parsed = new URL(url);
    return {
      present: true,
      origin: parsed.origin,
      pathname: parsed.pathname,
    };
  } catch {
    return { present: true };
  }
}

export function currentBrowserDiagnostics(): {
  origin: string;
  hostname: string;
  pathname: string;
  protocol: string;
  isBrave: boolean;
  isSecureContext: boolean;
  topLevel: boolean;
  visibilityState: DocumentVisibilityState;
  userAgent: string;
  cookieNames: string[];
} {
  return {
    origin: window.location.origin,
    hostname: window.location.hostname,
    pathname: window.location.pathname,
    protocol: window.location.protocol,
    isBrave: isBraveBrowser(),
    isSecureContext: window.isSecureContext,
    topLevel: window.top === window.self,
    visibilityState: document.visibilityState,
    userAgent: navigator.userAgent,
    cookieNames: document.cookie
      .split(";")
      .map((part) => part.trim().split("=")[0])
      .filter(Boolean),
  };
}

export function isBraveBrowser(): boolean {
  return Boolean((navigator as Navigator & { brave?: unknown }).brave);
}

export function webAuthTokenStorageDiagnostics(): {
  expectedKeyPresent: boolean;
  storedKeyCount: number;
  storedKeys: string[];
} {
  const storedKeys: string[] = [];
  for (let index = 0; index < sessionStorage.length; index += 1) {
    const key = sessionStorage.key(index);
    if (key?.startsWith(ICLOUD_AUTH_TOKEN_STORAGE_PREFIX)) {
      storedKeys.push(key);
    }
  }
  const expectedKey = `${ICLOUD_AUTH_TOKEN_STORAGE_PREFIX}${ICLOUD_CONTAINER_ID}`;
  const expectedValue = sessionStorage.getItem(expectedKey) ?? omittedValue();
  return {
    expectedKeyPresent: Boolean(expectedValue),
    storedKeyCount: storedKeys.length,
    storedKeys,
  };
}

export function iCloudConfigDiagnostics(): {
  container: string;
  environment: typeof ICLOUD_ENVIRONMENT;
  apiTokenConfigured: boolean;
  apiTokenLength: number;
} {
  return {
    container: ICLOUD_CONTAINER_ID,
    environment: ICLOUD_ENVIRONMENT,
    apiTokenConfigured: Boolean(ICLOUD_API_TOKEN.trim()),
    apiTokenLength: ICLOUD_API_TOKEN.trim().length,
  };
}

function elementDiagnostics(element: Element | void): {
  present: boolean;
  tag?: string;
  id?: string;
  className?: string;
  role?: string;
  childElementCount?: number;
  textLength?: number;
} {
  if (!element) {
    return { present: false };
  }
  return {
    present: true,
    tag: element.tagName,
    id: element.id || omittedValue(),
    className:
      typeof element.className === "string" && element.className
        ? element.className
        : omittedValue(),
    role: element.getAttribute("role") ?? omittedValue(),
    childElementCount: element.childElementCount,
    textLength: element.textContent?.trim().length ?? 0,
  };
}

export function cloudKitSignInControlDiagnostics(): {
  mount: ReturnType<typeof elementDiagnostics>;
  control: ReturnType<typeof elementDiagnostics>;
  signOutMount: ReturnType<typeof elementDiagnostics>;
} {
  const mount = !("document" in globalThis)
    ? omittedValue()
    : (document.getElementById(CLOUDKIT_SIGN_IN_BUTTON_ID) ?? omittedValue());
  const control =
    mount?.querySelector<HTMLElement>(
      'button, [role="button"], iframe, a, .apple-auth-button',
    ) ?? omittedValue();
  const signOutMount = !("document" in globalThis)
    ? omittedValue()
    : (document.getElementById(CLOUDKIT_SIGN_OUT_BUTTON_ID) ?? omittedValue());
  return {
    mount: elementDiagnostics(mount),
    control: elementDiagnostics(control),
    signOutMount: elementDiagnostics(signOutMount),
  };
}

export function normalizeWebAuthToken(stored: unknown): string | void {
  if (typeof stored === "string" && stored.trim()) {
    return stored.trim();
  }
  if (stored && typeof stored === "object") {
    const record = stored as Record<string, unknown>;
    for (const key of [
      "token",
      "ckWebAuthToken",
      "webAuthToken",
      "authToken",
      "value",
    ]) {
      const candidate = record[key];
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate.trim();
      }
    }
  }
  return;
}

export function storeCloudKitWebAuthToken(
  containerIdentifier: string,
  authToken: unknown,
): string | void {
  const key = `${ICLOUD_AUTH_TOKEN_STORAGE_PREFIX}${containerIdentifier}`;
  if (!authToken) {
    sessionStorage.removeItem(key);
    log.info("CloudKit web auth token cleared", {
      container: containerIdentifier,
      expectedContainer: containerIdentifier === ICLOUD_CONTAINER_ID,
    });
    return;
  }
  sessionStorage.setItem(key, JSON.stringify(authToken));
  const token = normalizeWebAuthToken(authToken);
  log.info("CloudKit web auth token stored", {
    container: containerIdentifier,
    expectedContainer: containerIdentifier === ICLOUD_CONTAINER_ID,
    tokenType: typeof authToken,
    normalized: tokenDiagnostics(token),
  });
  if (containerIdentifier === ICLOUD_CONTAINER_ID && token) {
    for (const listener of webAuthTokenListeners) {
      listener(token);
    }
  }
  return token;
}

export const cloudKitAuthTokenStore: CloudKitAuthTokenStore = {
  putToken(containerIdentifier, authToken) {
    log.debug("CloudKit putToken", {
      container: containerIdentifier,
      tokenType: typeof authToken,
      hasValue: Boolean(authToken),
    });
    storeCloudKitWebAuthToken(containerIdentifier, authToken);
  },
  getToken(containerIdentifier) {
    const raw = sessionStorage.getItem(
      `${ICLOUD_AUTH_TOKEN_STORAGE_PREFIX}${containerIdentifier}`,
    );
    if (!raw) {
      return;
    }
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return;
    }
  },
};

declare global {
  interface Window {
    CloudKit?: CloudKitGlobal;
  }
}

export function loadCloudKitScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.CloudKit) {
      log.info("CloudKit JS already loaded", currentBrowserDiagnostics());
      resolve();
      return;
    }
    const existing = document.querySelector(
      `script[src="${CLOUDKIT_SCRIPT_URL}"]`,
    );
    if (existing) {
      log.info("CloudKit JS load waiting on existing script", {
        scriptUrl: CLOUDKIT_SCRIPT_URL,
      });
      existing.addEventListener(
        "load",
        () => {
          log.info("CloudKit JS loaded from existing script");
          resolve();
        },
        { once: true },
      );
      existing.addEventListener(
        "error",
        () => {
          log.warn("CloudKit JS existing script failed to load", {
            scriptUrl: CLOUDKIT_SCRIPT_URL,
          });
          reject(new Error("Failed to load CloudKit JS."));
        },
        { once: true },
      );
      return;
    }
    log.info("CloudKit JS load started", {
      scriptUrl: CLOUDKIT_SCRIPT_URL,
      ...currentBrowserDiagnostics(),
    });
    const script = document.createElement("script");
    script.src = CLOUDKIT_SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      log.info("CloudKit JS loaded", { scriptUrl: CLOUDKIT_SCRIPT_URL });
      resolve();
    };
    script.onerror = () => {
      log.warn("CloudKit JS failed to load", {
        scriptUrl: CLOUDKIT_SCRIPT_URL,
      });
      reject(new Error("Failed to load CloudKit JS."));
    };
    document.head.appendChild(script);
  });
}
