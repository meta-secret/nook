import { err, ok, type Result } from "neverthrow";
import { OAuthFailure, OAuthFailureKind } from "$lib/auth/oauth-failure";
import {
  ICLOUD_API_TOKEN,
  ICLOUD_CONTAINER_ID,
  ICLOUD_ENVIRONMENT,
} from "$lib/auth/icloud/config";

import { browserLogRuntime } from "$lib/runtime/log";

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

const log = browserLogRuntime.createLogger("icloud-oauth");

enum CloudKitElementLookupKind {
  Missing = "missing",
  Found = "found",
}

type CloudKitElementLookup =
  | { kind: CloudKitElementLookupKind.Missing }
  | { kind: CloudKitElementLookupKind.Found; element: HTMLElement };

type CloudKitElementDiagnostics = {
  present: boolean;
  tag?: string;
  id?: string;
  className?: string;
  role?: string;
  childElementCount?: number;
  textLength?: number;
};

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

type CloudKitRecordZones = CloudKitZoneID[];

type CloudKitRecordBatch = CloudKitRecord | CloudKitRecord[];

type CloudKitShareAccessOptions = CloudKitShareAccess[];

type CloudKitSharePermissionOptions = CloudKitSharePermission[];

type CloudKitShortIdentifiers = string[];

type CloudKitRecordSaveOptions = { zoneID: string | CloudKitZoneID };

type CloudKitSharePresentationOptions = {
  record: CloudKitRecord;
  zoneID: string | CloudKitZoneID;
  shareTitle: string;
  shareType: string;
  supportedAccess: CloudKitShareAccessOptions;
  supportedPermissions: CloudKitSharePermissionOptions;
};

export type CloudKitDatabase = {
  saveRecordZones: (zones: CloudKitRecordZones) => Promise<unknown>;
  // eslint-disable-next-line max-params -- Host API owns this positional callback signature.
  saveRecords: (
    records: CloudKitRecordBatch,
    options: CloudKitRecordSaveOptions,
  ) => Promise<CloudKitRecordsResponse>;
  shareWithUI: (options: CloudKitSharePresentationOptions) => Promise<unknown>;
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

type CloudKitAuthSetupOptions = {
  grabAuthToken: boolean;
  persist: boolean;
};

export type CloudKitContainer = {
  setUpAuth: (options: CloudKitAuthSetupOptions) => Promise<CloudKitIdentity>;
  whenUserSignsIn: () => Promise<CloudKitUserIdentity>;
  fetchCurrentUserIdentity: () => Promise<CloudKitIdentity>;
  acceptShares?: (
    shortGUIDs: CloudKitShortIdentifiers,
  ) => Promise<CloudKitRecordInfosResponse>;
  fetchRecordInfos?: (
    shortGUIDs: CloudKitShortIdentifiers,
  ) => Promise<CloudKitRecordInfosResponse>;
  privateCloudDatabase?: CloudKitDatabase;
  sharedCloudDatabase?: CloudKitDatabase;
};

type ExternalCloudKitAuthSetupOptions = {
  grabAuthToken?: boolean;
  persist?: boolean;
};

type ExternalCloudKitContainer = Omit<
  CloudKitContainer,
  "setUpAuth" | "fetchCurrentUserIdentity"
> & {
  setUpAuth: (options?: ExternalCloudKitAuthSetupOptions) => Promise<unknown>;
  fetchCurrentUserIdentity?: () => Promise<unknown>;
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

const ICLOUD_AUTH_TOKEN_STORAGE_PREFIX = "nook.icloud.webAuthToken.";

export enum WebAuthTokenLookupKind {
  Unavailable = "unavailable",
  Available = "available",
}

export type WebAuthTokenLookup =
  | { kind: WebAuthTokenLookupKind.Unavailable }
  | { kind: WebAuthTokenLookupKind.Available; token: string };

type CloudKitWebAuthTokenPersistence = {
  readonly containerIdentifier: string;
  readonly token: WebAuthTokenLookup;
};

export const cloudKitAuthTokenStore: CloudKitAuthTokenStore = {
  // eslint-disable-next-line max-params -- CloudKit owns this positional token-store callback signature.
  putToken(containerIdentifier, authToken) {
    log.debug("CloudKit putToken");
    const storeCloudKitWebAuthTokenArgs: Parameters<
      typeof cloudKitRuntime.storeCloudKitWebAuthToken
    >[0] = {
      containerIdentifier,
      token: cloudKitRuntime.normalizeWebAuthToken(authToken),
    };
    const stored = cloudKitRuntime.storeCloudKitWebAuthToken(
      storeCloudKitWebAuthTokenArgs,
    );
    if (stored.isErr()) log.warn("CloudKit token persistence failed");
  },
  getToken(containerIdentifier) {
    const stored = cloudKitRuntime.readStoredToken(containerIdentifier);
    if (stored.isErr()) {
      log.warn("CloudKit token lookup failed");
      return;
    }
    if (stored.value.kind === WebAuthTokenLookupKind.Available)
      return stored.value.token;
    return;
  },
};

declare global {
  interface Window {
    CloudKit?: CloudKitGlobal;
  }
}

/** Owns the browser runtime resources shared by these interactions. */
class CloudKitRuntime {
  addTokenListener(
    // eslint-disable-next-line nook-typed-api/no-raw-object-arguments -- Existing call shape is preserved for this lint-only fix.
    listener: (token: Result<string, OAuthFailure>) => void,
  ): void {
    this.webAuthTokenListeners.add(listener);
  }
  removeTokenListener(
    // eslint-disable-next-line nook-typed-api/no-raw-object-arguments -- Existing call shape is preserved for this lint-only fix.
    listener: (token: Result<string, OAuthFailure>) => void,
  ): void {
    this.webAuthTokenListeners.delete(listener);
  }
  clearTokenListeners(): void {
    this.webAuthTokenListeners.clear();
  }

  private webAuthTokenListeners = new Set<
    // eslint-disable-next-line nook-typed-api/no-raw-object-arguments -- Existing call shape is preserved for this lint-only fix.
    (token: Result<string, OAuthFailure>) => void
  >();
  private cloudKitIdentityFromTransport(value: unknown): CloudKitIdentity {
    return Boolean(value) && typeof value === "object"
      ? {
          kind: CloudKitIdentityKind.SignedIn,
          identity: value as CloudKitUserIdentity,
        }
      : { kind: CloudKitIdentityKind.SignedOut };
  }

  getDefaultCloudKitContainer(): Result<CloudKitContainer, OAuthFailure> {
    if (!window.CloudKit)
      return err(new OAuthFailure(OAuthFailureKind.CloudKitUnavailable));
    try {
      const external = window.CloudKit.getDefaultContainer();
      const handler: ProxyHandler<ExternalCloudKitContainer> = {
        // eslint-disable-next-line max-params -- Proxy owns this positional boundary callback.
        get: (target, property, receiver) => {
          if (property === "setUpAuth") {
            return async (options: CloudKitAuthSetupOptions) =>
              this.cloudKitIdentityFromTransport(
                await target.setUpAuth(options),
              );
          }
          if (property === "fetchCurrentUserIdentity") {
            return async () => {
              if (!target.fetchCurrentUserIdentity) {
                return { kind: CloudKitIdentityKind.SignedOut };
              }
              return this.cloudKitIdentityFromTransport(
                await target.fetchCurrentUserIdentity(),
              );
            };
          }
          return Reflect.get(target, property, receiver);
        },
      };
      return ok(new Proxy(external, handler) as CloudKitContainer);
    } catch {
      return err(new OAuthFailure(OAuthFailureKind.CloudKitUnavailable));
    }
  }

  tokenDiagnostics(token: WebAuthTokenLookup): {
    present: boolean;
    length: number;
  } {
    return {
      present: token.kind === WebAuthTokenLookupKind.Available,
      length:
        token.kind === WebAuthTokenLookupKind.Available
          ? token.token.length
          : 0,
    };
  }

  sanitizedURLDiagnostics(url: unknown): {
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

  currentBrowserDiagnostics(): {
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
      isBrave: this.isBraveBrowser(),
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

  isBraveBrowser(): boolean {
    return Boolean((navigator as Navigator & { brave?: unknown }).brave);
  }

  webAuthTokenStorageDiagnostics(): {
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

  iCloudConfigDiagnostics(): {
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

  private elementDiagnostics(
    lookup: CloudKitElementLookup,
  ): CloudKitElementDiagnostics {
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
      textLength: ((v) => (v ? v : 0))(element.textContent?.trim().length),
    };
  }

  private cloudKitElementById(id: string): CloudKitElementLookup {
    if (!("document" in globalThis)) {
      return { kind: CloudKitElementLookupKind.Missing };
    }
    const element = document.getElementById(id);
    return element
      ? { kind: CloudKitElementLookupKind.Found, element }
      : { kind: CloudKitElementLookupKind.Missing };
  }

  cloudKitSignInControlDiagnostics(): {
    mount: CloudKitElementDiagnostics;
    control: CloudKitElementDiagnostics;
    signOutMount: CloudKitElementDiagnostics;
  } {
    const mount = this.cloudKitElementById(CLOUDKIT_SIGN_IN_BUTTON_ID);
    const control: CloudKitElementLookup =
      mount.kind === CloudKitElementLookupKind.Found
        ? this.cloudKitSignInControl(mount.element)
        : { kind: CloudKitElementLookupKind.Missing };
    const signOutMount = this.cloudKitElementById(CLOUDKIT_SIGN_OUT_BUTTON_ID);
    return {
      mount: this.elementDiagnostics(mount),
      control: this.elementDiagnostics(control),
      signOutMount: this.elementDiagnostics(signOutMount),
    };
  }

  private cloudKitSignInControl(mount: HTMLElement): CloudKitElementLookup {
    const control = mount.querySelector<HTMLElement>(
      'button, [role="button"], iframe, a, .apple-auth-button',
    );
    return control
      ? { kind: CloudKitElementLookupKind.Found, element: control }
      : { kind: CloudKitElementLookupKind.Missing };
  }

  normalizeWebAuthToken(stored: unknown): WebAuthTokenLookup {
    if (typeof stored === "string" && stored.trim()) {
      return {
        kind: WebAuthTokenLookupKind.Available,
        token: stored.trim(),
      };
    }
    if (stored && typeof stored === "object") {
      for (const key of [
        "token",
        "ckWebAuthToken",
        "webAuthToken",
        "authToken",
        "value",
      ]) {
        const candidate =
          key === "token" && "token" in stored
            ? stored.token
            : key === "ckWebAuthToken" && "ckWebAuthToken" in stored
              ? stored.ckWebAuthToken
              : key === "webAuthToken" && "webAuthToken" in stored
                ? stored.webAuthToken
                : key === "authToken" && "authToken" in stored
                  ? stored.authToken
                  : key === "value" && "value" in stored
                    ? stored.value
                    : false;
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

  readStoredToken(
    containerIdentifier: string,
  ): Result<WebAuthTokenLookup, OAuthFailure> {
    try {
      const raw = sessionStorage.getItem(
        `${ICLOUD_AUTH_TOKEN_STORAGE_PREFIX}${containerIdentifier}`,
      );
      return ok(
        raw
          ? this.normalizeWebAuthToken(JSON.parse(raw))
          : // eslint-disable-next-line nook-typed-api/no-raw-object-arguments -- Existing call shape is preserved for this lint-only fix.
            { kind: WebAuthTokenLookupKind.Unavailable },
      );
    } catch {
      return err(new OAuthFailure(OAuthFailureKind.BrowserStorage));
    }
  }

  storeCloudKitWebAuthToken({
    containerIdentifier,
    token,
  }: CloudKitWebAuthTokenPersistence): Result<
    WebAuthTokenLookup,
    OAuthFailure
  > {
    const key = `${ICLOUD_AUTH_TOKEN_STORAGE_PREFIX}${containerIdentifier}`;
    let outcome: Result<WebAuthTokenLookup, OAuthFailure>;
    try {
      if (token.kind === WebAuthTokenLookupKind.Unavailable)
        sessionStorage.removeItem(key);
      else sessionStorage.setItem(key, JSON.stringify(token.token));
      outcome = ok(token);
    } catch {
      outcome = err(new OAuthFailure(OAuthFailureKind.BrowserStorage));
    }
    if (containerIdentifier === ICLOUD_CONTAINER_ID) {
      if (outcome.isErr()) {
        for (const listener of this.webAuthTokenListeners)
          listener(err(outcome.error));
      } else if (outcome.value.kind === WebAuthTokenLookupKind.Available) {
        for (const listener of this.webAuthTokenListeners)
          listener(ok(outcome.value.token));
      }
    }
    return outcome;
  }

  loadCloudKitScript(): Promise<Result<void, OAuthFailure>> {
    return new Promise((resolve) => {
      try {
        if (window.CloudKit) {
          resolve(ok());
          return;
        }
        const loaded = () => resolve(ok());
        const failed = () =>
          resolve(err(new OAuthFailure(OAuthFailureKind.CloudKitScript)));
        const existing = document.querySelector(
          `script[src="${CLOUDKIT_SCRIPT_URL}"]`,
        );
        if (existing) {
          // eslint-disable-next-line nook-typed-api/no-raw-object-arguments -- Existing call shape is preserved for this lint-only fix.
          existing.addEventListener("load", loaded, { once: true });
          // eslint-disable-next-line nook-typed-api/no-raw-object-arguments -- Existing call shape is preserved for this lint-only fix.
          existing.addEventListener("error", failed, { once: true });
          return;
        }
        const script = document.createElement("script");
        script.src = CLOUDKIT_SCRIPT_URL;
        script.async = true;
        script.defer = true;
        script.onload = loaded;
        script.onerror = failed;
        document.head.appendChild(script);
      } catch {
        resolve(err(new OAuthFailure(OAuthFailureKind.CloudKitScript)));
      }
    });
  }
}

export const cloudKitRuntime = new CloudKitRuntime();
