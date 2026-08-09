import {
  ICLOUD_API_TOKEN,
  ICLOUD_CONTAINER_ID,
  ICLOUD_ENVIRONMENT,
} from "$lib/auth/icloud/config";
import { createLogger } from "$lib/runtime/log";
import {
  CloudKitButtonTheme,
  CloudKitEnvironment,
  CloudKitParticipantStatus,
  CloudKitShareAccess,
  CloudKitSharePermission,
} from "$lib/auth/icloud/cloudkit-state";
import {
  CloudKitIdentityKind,
  type CloudKitIdentity,
} from "$lib/auth/icloud/auth-state";

const CLOUDKIT_SCRIPT_URL = "https://cdn.apple-cloudkit.com/ck/2/cloudkit.js";
export const CLOUDKIT_SIGN_IN_BUTTON_ID = "apple-sign-in-button";
export const CLOUDKIT_SIGN_OUT_BUTTON_ID = "apple-sign-out-button";
const log = createLogger("icloud-oauth");

enum CloudKitElementLookupKind {
  Missing = "missing",
  Found = "found",
}

type CloudKitElementLookup =
  | { kind: CloudKitElementLookupKind.Missing }
  | { kind: CloudKitElementLookupKind.Found; element: HTMLElement };

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
  participantStatus?: CloudKitParticipantStatus;
};

export type CloudKitRecordInfosResponse = {
  results: CloudKitRecordInfo[];
};

export type CloudKitDatabase = {
  saveRecordZones: (zones: CloudKitZoneID[]) => Promise<unknown>;
  // eslint-disable-next-line max-params -- Host API owns this positional callback signature.
  saveRecords: (
    records: CloudKitRecord | CloudKitRecord[],
    options: { zoneID: string | CloudKitZoneID },
  ) => Promise<CloudKitRecordsResponse>;
  shareWithUI: (options: {
    record: CloudKitRecord;
    zoneID: string | CloudKitZoneID;
    shareTitle: string;
    shareType: string;
    supportedAccess: CloudKitShareAccess[];
    supportedPermissions: CloudKitSharePermission[];
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
  }) => Promise<CloudKitIdentity>;
  whenUserSignsIn: () => Promise<CloudKitUserIdentity>;
  fetchCurrentUserIdentity?: () => Promise<CloudKitUserIdentity>;
  acceptShares?: (shortGUIDs: string[]) => Promise<CloudKitRecordInfosResponse>;
  fetchRecordInfos?: (
    shortGUIDs: string[],
  ) => Promise<CloudKitRecordInfosResponse>;
  privateCloudDatabase?: CloudKitDatabase;
  sharedCloudDatabase?: CloudKitDatabase;
};

type ExternalCloudKitContainer = Omit<CloudKitContainer, "setUpAuth"> & {
  setUpAuth: (options?: {
    grabAuthToken?: boolean;
    persist?: boolean;
  }) => Promise<unknown>;
};

export type CloudKitAuthTokenStore = {
  // eslint-disable-next-line max-params -- Host API owns this positional callback signature.
  putToken: (containerIdentifier: string, authToken: unknown) => void;
  getToken: (containerIdentifier: string) => unknown;
};

export type CloudKitConfiguration = {
  containers: Array<{
    containerIdentifier: string;
    environment: CloudKitEnvironment;
    apiTokenAuth: {
      apiToken: string;
      persist: boolean;
      signInButton: {
        id: string;
        theme?: CloudKitButtonTheme;
      };
      signOutButton: {
        id: string;
        theme?: CloudKitButtonTheme;
      };
    };
  }>;
  services?: {
    authTokenStore?: CloudKitAuthTokenStore;
  };
};

export type CloudKitGlobal = {
  configure: (config: CloudKitConfiguration) => void;
  getDefaultContainer: () => ExternalCloudKitContainer;
};

function cloudKitIdentityFromTransport(value: unknown): CloudKitIdentity {
  return Boolean(value) && typeof value === "object"
    ? {
        kind: CloudKitIdentityKind.SignedIn,
        identity: value as CloudKitUserIdentity,
      }
    : { kind: CloudKitIdentityKind.SignedOut };
}

/** Return a domain-typed view that narrows CloudKit's generic auth result immediately. */
export function getDefaultCloudKitContainer(): CloudKitContainer {
  const external = window.CloudKit!.getDefaultContainer();
  const handler: ProxyHandler<ExternalCloudKitContainer> = {
    // eslint-disable-next-line max-params -- Proxy owns this positional boundary callback.
    get(target, property, receiver) {
      if (property === "setUpAuth") {
        return async (options?: {
          grabAuthToken?: boolean;
          persist?: boolean;
        }) => cloudKitIdentityFromTransport(await target.setUpAuth(options));
      }
      return Reflect.get(target, property, receiver);
    },
  };
  return new Proxy(external, handler) as CloudKitContainer;
}

const ICLOUD_AUTH_TOKEN_STORAGE_PREFIX = "nook.icloud.webAuthToken.";

export const webAuthTokenListeners = new Set<(token: string) => void>();

export enum WebAuthTokenLookupKind {
  Unavailable = "unavailable",
  Available = "available",
}

export type WebAuthTokenLookup =
  | { kind: WebAuthTokenLookupKind.Unavailable }
  | { kind: WebAuthTokenLookupKind.Available; token: string };

export function tokenDiagnostics(token: WebAuthTokenLookup): {
  present: boolean;
  length: number;
} {
  return {
    present: token.kind === WebAuthTokenLookupKind.Available,
    length:
      token.kind === WebAuthTokenLookupKind.Available ? token.token.length : 0,
  };
}

export function sanitizedURLDiagnostics(url: unknown): {
  present: boolean;
  origin?: string;
  pathname?: string;
} {
  if (typeof url !== "string" || !url) {
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
  const expectedValue = sessionStorage.getItem(expectedKey)?.valueOf();
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

function elementDiagnostics(lookup: CloudKitElementLookup): {
  present: boolean;
  tag?: string;
  id?: string;
  className?: string;
  role?: string;
  childElementCount?: number;
  textLength?: number;
} {
  if (lookup.kind === CloudKitElementLookupKind.Missing) {
    return { present: false };
  }
  const { element } = lookup;
  const role = element.getAttribute("role");
  return {
    present: true,
    tag: element.tagName,
    ...(element.id ? { id: element.id } : {}),
    ...(typeof element.className === "string" && element.className
      ? { className: element.className }
      : {}),
    ...(role ? { role } : {}),
    childElementCount: element.childElementCount,
    textLength: element.textContent?.trim().length ?? 0,
  };
}

function cloudKitElementById(id: string): CloudKitElementLookup {
  if (!("document" in globalThis)) {
    return { kind: CloudKitElementLookupKind.Missing };
  }
  const element = document.getElementById(id);
  return element
    ? { kind: CloudKitElementLookupKind.Found, element }
    : { kind: CloudKitElementLookupKind.Missing };
}

export function cloudKitSignInControlDiagnostics(): {
  mount: ReturnType<typeof elementDiagnostics>;
  control: ReturnType<typeof elementDiagnostics>;
  signOutMount: ReturnType<typeof elementDiagnostics>;
} {
  const mount = cloudKitElementById(CLOUDKIT_SIGN_IN_BUTTON_ID);
  const control: CloudKitElementLookup =
    mount.kind === CloudKitElementLookupKind.Found
      ? cloudKitSignInControl(mount.element)
      : { kind: CloudKitElementLookupKind.Missing };
  const signOutMount = cloudKitElementById(CLOUDKIT_SIGN_OUT_BUTTON_ID);
  return {
    mount: elementDiagnostics(mount),
    control: elementDiagnostics(control),
    signOutMount: elementDiagnostics(signOutMount),
  };
}

function cloudKitSignInControl(mount: HTMLElement): CloudKitElementLookup {
  const control = mount.querySelector<HTMLElement>(
    'button, [role="button"], iframe, a, .apple-auth-button',
  );
  return control
    ? { kind: CloudKitElementLookupKind.Found, element: control }
    : { kind: CloudKitElementLookupKind.Missing };
}

export function normalizeWebAuthToken(stored: unknown): WebAuthTokenLookup {
  if (typeof stored === "string" && stored.trim()) {
    return {
      kind: WebAuthTokenLookupKind.Available,
      token: stored.trim(),
    };
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
        return {
          kind: WebAuthTokenLookupKind.Available,
          token: candidate.trim(),
        };
      }
    }
  }
  return { kind: WebAuthTokenLookupKind.Unavailable };
}

export function storeCloudKitWebAuthToken({
  containerIdentifier,
  authToken,
}: {
  readonly containerIdentifier: string;
  readonly authToken: unknown;
}): WebAuthTokenLookup {
  const key = `${ICLOUD_AUTH_TOKEN_STORAGE_PREFIX}${containerIdentifier}`;
  if (!authToken) {
    sessionStorage.removeItem(key);
    const infoArgs: Parameters<typeof log.info>[1] = {
      container: containerIdentifier,
      expectedContainer: containerIdentifier === ICLOUD_CONTAINER_ID,
    };
    log.info("CloudKit web auth token cleared", infoArgs);
    return { kind: WebAuthTokenLookupKind.Unavailable };
  }
  sessionStorage.setItem(key, JSON.stringify(authToken));
  const token = normalizeWebAuthToken(authToken);
  const infoArgs2: Parameters<typeof log.info>[1] = {
    container: containerIdentifier,
    expectedContainer: containerIdentifier === ICLOUD_CONTAINER_ID,
    tokenType: typeof authToken,
    normalized: tokenDiagnostics(token),
  };
  log.info("CloudKit web auth token stored", infoArgs2);
  if (
    containerIdentifier === ICLOUD_CONTAINER_ID &&
    token.kind === WebAuthTokenLookupKind.Available
  ) {
    for (const listener of webAuthTokenListeners) {
      listener(token.token);
    }
  }
  return token;
}

export const cloudKitAuthTokenStore: CloudKitAuthTokenStore = {
  // eslint-disable-next-line max-params -- CloudKit owns this positional token-store callback signature.
  putToken(containerIdentifier, authToken) {
    const debugArgs: Parameters<typeof log.debug>[1] = {
      container: containerIdentifier,
      tokenType: typeof authToken,
      hasValue: Boolean(authToken),
    };
    log.debug("CloudKit putToken", debugArgs);
    const storeCloudKitWebAuthTokenArgs: Parameters<
      typeof storeCloudKitWebAuthToken
    >[0] = { containerIdentifier, authToken };
    storeCloudKitWebAuthToken(storeCloudKitWebAuthTokenArgs);
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
  return new Promise(
    // eslint-disable-next-line max-params -- Host API owns this positional callback signature.
    (resolve, reject) => {
      if (window.CloudKit) {
        log.info("CloudKit JS already loaded", currentBrowserDiagnostics());
        resolve();
        return;
      }
      const existing = document.querySelector(
        `script[src="${CLOUDKIT_SCRIPT_URL}"]`,
      );
      if (existing) {
        const infoArgs3: Parameters<typeof log.info>[1] = {
          scriptUrl: CLOUDKIT_SCRIPT_URL,
        };
        log.info("CloudKit JS load waiting on existing script", infoArgs3);
        const errorListenerArgs: Parameters<
          typeof existing.addEventListener
        >[2] = { once: true };
        existing.addEventListener(
          "load",
          () => {
            log.info("CloudKit JS loaded from existing script");
            resolve();
          },
          errorListenerArgs,
        );
        const addEventListenerArgs: Parameters<
          typeof existing.addEventListener
        >[2] = { once: true };
        existing.addEventListener(
          "error",
          () => {
            const warnArgs: Parameters<typeof log.warn>[1] = {
              scriptUrl: CLOUDKIT_SCRIPT_URL,
            };
            log.warn("CloudKit JS existing script failed to load", warnArgs);
            reject(new Error("Failed to load CloudKit JS."));
          },
          addEventListenerArgs,
        );
        return;
      }
      const infoArgs4: Parameters<typeof log.info>[1] = {
        scriptUrl: CLOUDKIT_SCRIPT_URL,
        ...currentBrowserDiagnostics(),
      };
      log.info("CloudKit JS load started", infoArgs4);
      const script = document.createElement("script");
      script.src = CLOUDKIT_SCRIPT_URL;
      script.async = true;
      script.defer = true;
      script.onload = () => {
        const infoArgs5: Parameters<typeof log.info>[1] = {
          scriptUrl: CLOUDKIT_SCRIPT_URL,
        };
        log.info("CloudKit JS loaded", infoArgs5);
        resolve();
      };
      script.onerror = () => {
        const warnArgs2: Parameters<typeof log.warn>[1] = {
          scriptUrl: CLOUDKIT_SCRIPT_URL,
        };
        log.warn("CloudKit JS failed to load", warnArgs2);
        reject(new Error("Failed to load CloudKit JS."));
      };
      document.head.appendChild(script);
    },
  );
}
