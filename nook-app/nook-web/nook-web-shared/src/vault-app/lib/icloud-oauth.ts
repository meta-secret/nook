/**
 * CloudKit JS web auth for iCloud private-database vault storage.
 *
 * Browser-only — no server, no client secret. After sign-in, the web auth
 * token is passed to wasm for CloudKit REST calls.
 */

import type { OAuthFileConfig } from "$lib/auth-providers";
import { iCloudOAuthTokensToConfig as iCloudOAuthTokensToConfigCore } from "$app-wasm";
import {
  default as initNookWasm,
  createICloudSharedStorageTarget,
  parseICloudSharedStorageTarget,
  type ICloudSharedTarget,
} from "$app-wasm";
import {
  ICLOUD_API_TOKEN,
  ICLOUD_CONTAINER_ID,
  ICLOUD_ENVIRONMENT,
} from "$lib/icloud-oauth-config";
import { createLogger } from "$lib/log";
import {
  EMPTY_VALUE,
  presentValue,
  type ValueState,
} from "../../explicit-state";
import {
  CLOUDKIT_SIGN_IN_BUTTON_ID,
  CLOUDKIT_SIGN_OUT_BUTTON_ID,
  cloudKitAuthTokenStore,
  cloudKitSignInControlDiagnostics,
  currentBrowserDiagnostics,
  iCloudConfigDiagnostics,
  isBraveBrowser,
  loadCloudKitScript,
  normalizeWebAuthToken,
  sanitizedURLDiagnostics,
  storeCloudKitWebAuthToken,
  tokenDiagnostics,
  webAuthTokenListeners,
  webAuthTokenStorageDiagnostics,
  type CloudKitAuthChallenge,
  type CloudKitAuthError,
  type CloudKitAuthErrorDetails,
  type CloudKitContainer,
  type CloudKitRecordInfo,
  type CloudKitRecordInfosResponse,
  type CloudKitUserIdentity,
} from "$lib/icloud-cloudkit-runtime";

export const ICLOUD_SIGN_IN_TIMEOUT_MS = 60_000;
const log = createLogger("icloud-oauth");

export type ICloudOAuthTokens = {
  accessToken: string;
  accountName?: string;
  userRecordName?: string;
};

type ICloudWebAuthTokenRequestOptions = {
  signInTimeoutMs?: number;
  clickSignInControl?: boolean;
};

let cloudKitInitialization: ValueState<Promise<void>> = EMPTY_VALUE;
let cloudKitAuthSetup: ValueState<Promise<CloudKitUserIdentity | undefined>> =
  EMPTY_VALUE;
let cloudKitIdentity: ValueState<CloudKitUserIdentity> = EMPTY_VALUE;

function currentAuthSetup():
  | Promise<CloudKitUserIdentity | undefined>
  | undefined {
  return cloudKitAuthSetup.kind === "present"
    ? cloudKitAuthSetup.value
    : undefined;
}

function currentCloudKitIdentity(): CloudKitUserIdentity | undefined {
  return cloudKitIdentity.kind === "present"
    ? cloudKitIdentity.value
    : undefined;
}

function rememberCloudKitIdentity(
  identity: CloudKitUserIdentity | undefined,
): void {
  cloudKitIdentity =
    identity === undefined ? EMPTY_VALUE : presentValue(identity);
}

/** @internal Clears module singletons between unit tests. */
export function resetICloudAuthStateForTests(): void {
  cloudKitInitialization = EMPTY_VALUE;
  cloudKitAuthSetup = EMPTY_VALUE;
  cloudKitIdentity = EMPTY_VALUE;
  webAuthTokenListeners.clear();
}

export function isICloudOAuthConfigured(): boolean {
  return Boolean(
    ICLOUD_CONTAINER_ID.trim() &&
    ICLOUD_API_TOKEN.trim() &&
    ICLOUD_CONTAINER_ID.startsWith("iCloud."),
  );
}

function readWebAuthTokenFromCookie(): string | undefined {
  for (const part of document.cookie.split(";")) {
    const trimmed = part.trim();
    if (!trimmed.startsWith("ckWebAuthToken")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq === -1) {
      continue;
    }
    const value = trimmed.slice(eq + 1);
    if (value) {
      const token = decodeURIComponent(value);
      log.info("CloudKit web auth token found in cookie", {
        cookieName: trimmed.slice(0, eq),
        token: tokenDiagnostics(token),
      });
      return token;
    }
  }
  return undefined;
}

function readStoredWebAuthToken(): string | undefined {
  const fromCookie = readWebAuthTokenFromCookie();
  if (fromCookie) {
    return fromCookie;
  }
  const stored = cloudKitAuthTokenStore.getToken(ICLOUD_CONTAINER_ID);
  const token = normalizeWebAuthToken(stored);
  if (token) {
    log.info("CloudKit web auth token found in session storage", {
      storedType: typeof stored,
      token: tokenDiagnostics(token),
    });
  }
  return token;
}

function waitForStoredWebAuthToken(
  timeoutMs = ICLOUD_SIGN_IN_TIMEOUT_MS,
): Promise<string> {
  const existing = readStoredWebAuthToken();
  if (existing) {
    log.info("CloudKit web auth token already available before wait", {
      token: tokenDiagnostics(existing),
      timeoutMs,
    });
    return Promise.resolve(existing);
  }
  log.info("CloudKit web auth token wait started", { timeoutMs });

  return new Promise((resolve, reject) => {
    let timeoutId: ReturnType<typeof setTimeout>;
    let pollId: ReturnType<typeof setInterval>;
    let settled = false;

    const cleanup = () => {
      settled = true;
      clearTimeout(timeoutId);
      clearInterval(pollId);
      webAuthTokenListeners.delete(listener);
    };

    const listener = (token: string) => {
      if (settled) {
        return;
      }
      cleanup();
      log.info("CloudKit web auth token wait resolved by token store", {
        token: tokenDiagnostics(token),
      });
      resolve(token);
    };
    webAuthTokenListeners.add(listener);

    // Fallback: poll cookies / session storage so we detect tokens that
    // CloudKit JS stored outside the custom authTokenStore (e.g. via
    // cookie or a direct sessionStorage write after a SDK update).
    pollId = setInterval(() => {
      const token = readStoredWebAuthToken();
      if (token) {
        cleanup();
        log.info("CloudKit web auth token wait resolved by polling", {
          token: tokenDiagnostics(token),
        });
        resolve(token);
      }
    }, 500);

    timeoutId = setTimeout(() => {
      cleanup();
      log.warn("CloudKit web auth token wait timed out", {
        timeoutMs,
        ...currentBrowserDiagnostics(),
        storage: webAuthTokenStorageDiagnostics(),
        control: cloudKitSignInControlDiagnostics(),
      });
      reject(cloudKitSignInTimeoutError());
    }, timeoutMs);
  });
}

function stringValue(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") {
    return undefined;
  }
  const text = String(value).trim();
  return text || undefined;
}

function numericStatus(value: unknown): number | undefined {
  const text = stringValue(value);
  if (!text) {
    return undefined;
  }
  const status = Number(text);
  return Number.isInteger(status) ? status : undefined;
}

function cloudKitRedirectDetails(redirectURL: string | undefined): {
  origin?: string;
  pathname?: string;
} {
  if (!redirectURL) return {};
  try {
    const parsed = new URL(redirectURL);
    return { origin: parsed.origin, pathname: parsed.pathname };
  } catch {
    return {};
  }
}

function cloudKitAuthErrorDetails(error: unknown): CloudKitAuthErrorDetails {
  if (error instanceof Error) {
    return {
      code: error.name && error.name !== "Error" ? error.name : undefined,
      message: stringValue(error.message),
    };
  }
  if (error != undefined && typeof error === "object") {
    const authError = error as CloudKitAuthError;
    const redirectURL = stringValue(authError.redirectURL);
    const redirect = cloudKitRedirectDetails(redirectURL);
    return {
      code:
        stringValue(authError.code) ??
        stringValue(authError.errorCode) ??
        stringValue(authError.serverErrorCode) ??
        stringValue(authError.name),
      message: stringValue(authError.message),
      redirectURLPresent: Boolean(redirectURL),
      redirectURLOrigin: redirect.origin,
      redirectURLPathname: redirect.pathname,
      reason: stringValue(authError.reason) ?? stringValue(authError._reason),
      status:
        numericStatus(authError.status) ?? numericStatus(authError.statusCode),
      statusText: stringValue(authError.statusText),
      uuidPresent: Boolean(stringValue(authError.uuid)),
    };
  }
  return {};
}

function hasErrorToken(
  details: CloudKitAuthErrorDetails,
  predicate: (value: string) => boolean,
): boolean {
  return [details.code, details.message, details.reason, details.statusText]
    .filter((value): value is string => Boolean(value))
    .some((value) => predicate(value.toUpperCase()));
}

function isAuthRequiredCloudKitError(
  details: CloudKitAuthErrorDetails,
): boolean {
  if (details.status === 421) {
    return true;
  }
  return hasErrorToken(details, (value) =>
    [
      "AUTHENTICATION_REQUIRED",
      "REQUEST NEEDS AUTHORIZATION",
      "NEEDS AUTHORIZATION",
    ].some((token) => value.includes(token)),
  );
}

function hasCloudKitSignInControl(): boolean {
  return (
    typeof document !== "undefined" &&
    Boolean(document.getElementById(CLOUDKIT_SIGN_IN_BUTTON_ID))
  );
}

function isExpectedSignInSetupFailure(error: unknown): boolean {
  const details = cloudKitAuthErrorDetails(error);
  if (isAuthRequiredCloudKitError(details)) {
    return hasCloudKitSignInControl();
  }
  const isOpaqueUnknown = hasErrorToken(details, (value) =>
    value.includes("UNKNOWN_ERROR"),
  );
  return isOpaqueUnknown && hasCloudKitSignInControl();
}

function cloudKitAuthErrorMessage(error: unknown): string {
  const details = cloudKitAuthErrorDetails(error);
  if (isAuthRequiredCloudKitError(details)) {
    return "Apple sign-in is required. Click Sign in with Apple to continue.";
  }
  const isMisdirectedRequest =
    details.status === 421 ||
    hasErrorToken(
      details,
      (value) => value.includes("421") || value.includes("MISDIRECTED"),
    );
  if (isMisdirectedRequest) {
    return "Apple sign-in is required. Click Sign in with Apple to continue.";
  }
  const isUnknownCloudKitError = hasErrorToken(details, (value) =>
    value.includes("UNKNOWN_ERROR"),
  );
  if (isUnknownCloudKitError) {
    return "Apple CloudKit returned UNKNOWN_ERROR during sign-in. Check that the iCloud API token is enabled for this container and that the current browser origin is allowed.";
  }
  return (
    details.reason ??
    details.message ??
    details.statusText ??
    "iCloud sign-in failed."
  );
}

function logCloudKitAuthFailure(message: string, error: unknown): void {
  const details = cloudKitAuthErrorDetails(error);
  log.warn(message, {
    code: details.code,
    reason: details.reason,
    message: details.message,
    redirectURLPresent: details.redirectURLPresent,
    redirectURLOrigin: details.redirectURLOrigin,
    redirectURLPathname: details.redirectURLPathname,
    status: details.status,
    statusText: details.statusText,
    uuidPresent: details.uuidPresent,
    storage: webAuthTokenStorageDiagnostics(),
    control: cloudKitSignInControlDiagnostics(),
  });
}

function cloudKitSignInTimeoutError(): Error {
  return new Error(
    "Apple sign-in did not complete. Check that CloudKit allows this site and try again.",
  );
}

export async function initICloudAuth(): Promise<void> {
  if (cloudKitInitialization.kind === "present") {
    log.info("CloudKit auth init reused existing promise");
    return cloudKitInitialization.value;
  }
  const operation = (async () => {
    log.info("CloudKit auth init started", {
      config: iCloudConfigDiagnostics(),
      browser: currentBrowserDiagnostics(),
    });
    await loadCloudKitScript();
    window.CloudKit!.configure({
      containers: [
        {
          containerIdentifier: ICLOUD_CONTAINER_ID,
          environment: ICLOUD_ENVIRONMENT,
          apiTokenAuth: {
            apiToken: ICLOUD_API_TOKEN,
            persist: true,
            signInButton: { id: CLOUDKIT_SIGN_IN_BUTTON_ID, theme: "black" },
            signOutButton: { id: CLOUDKIT_SIGN_OUT_BUTTON_ID, theme: "black" },
          },
        },
      ],
      services: {
        authTokenStore: cloudKitAuthTokenStore,
      },
    });
    log.info("CloudKit auth configured", {
      config: iCloudConfigDiagnostics(),
      hasCloudKitGlobal: Boolean(window.CloudKit),
    });
  })();
  cloudKitInitialization = presentValue(operation);
  return operation;
}

function setUpCloudKitAuth(
  container: CloudKitContainer,
): Promise<CloudKitUserIdentity | undefined> {
  const existingSetup = currentAuthSetup();
  if (existingSetup) {
    log.info("CloudKit setUpAuth reused existing promise");
    return existingSetup;
  }
  log.info("CloudKit setUpAuth started", {
    grabAuthToken: true,
    persist: true,
    hasSignInMount: hasCloudKitSignInControl(),
    control: cloudKitSignInControlDiagnostics(),
  });
  const operation = container
    .setUpAuth({
      grabAuthToken: true,
      persist: true,
    })
    .then((userIdentity) => {
      rememberCloudKitIdentity(userIdentity);
      log.info("CloudKit setUpAuth completed", {
        signedIn: Boolean(userIdentity),
        token: tokenDiagnostics(readStoredWebAuthToken()),
        storage: webAuthTokenStorageDiagnostics(),
        control: cloudKitSignInControlDiagnostics(),
      });
      return userIdentity;
    })
    .catch((error: unknown) => {
      if (isExpectedSignInSetupFailure(error)) {
        log.info("CloudKit auth setup waiting for Apple sign-in", {
          details: cloudKitAuthErrorDetails(error),
          hasSignInMount: hasCloudKitSignInControl(),
          storage: webAuthTokenStorageDiagnostics(),
          control: cloudKitSignInControlDiagnostics(),
        });
        cloudKitIdentity = EMPTY_VALUE;
        return undefined;
      }
      cloudKitAuthSetup = EMPTY_VALUE;
      cloudKitIdentity = EMPTY_VALUE;
      throw error;
    });
  cloudKitAuthSetup = presentValue(operation);
  return operation;
}

export async function prepareICloudSignInControl(): Promise<void> {
  log.info("CloudKit sign-in control prepare started");
  await initICloudAuth();
  const container = window.CloudKit!.getDefaultContainer();
  const mount = document.getElementById(CLOUDKIT_SIGN_IN_BUTTON_ID);
  const existingControl = mount?.querySelector(
    'button, [role="button"], iframe, a, .apple-auth-button',
  );
  if (
    currentAuthSetup() &&
    !currentCloudKitIdentity() &&
    !readStoredWebAuthToken() &&
    !existingControl
  ) {
    cloudKitAuthSetup = EMPTY_VALUE;
  }
  try {
    await setUpCloudKitAuth(container);
    log.info("CloudKit sign-in control ready", {
      hasSignInMount: hasCloudKitSignInControl(),
      token: tokenDiagnostics(readStoredWebAuthToken()),
      storage: webAuthTokenStorageDiagnostics(),
      control: cloudKitSignInControlDiagnostics(),
    });
  } catch (error) {
    logCloudKitAuthFailure("CloudKit auth setup failed", error);
    throw new Error(cloudKitAuthErrorMessage(error), { cause: error });
  }
}

function clickCloudKitSignInButton(): void {
  const mount = document.getElementById(CLOUDKIT_SIGN_IN_BUTTON_ID);
  const control =
    mount?.querySelector<HTMLElement>(
      'button, [role="button"], iframe, a, .apple-auth-button',
    ) ?? mount;
  if (!control) {
    log.warn("CloudKit sign-in control click failed: control missing", {
      hasMount: Boolean(mount),
    });
    throw new Error(
      "Apple sign-in control is not ready. Reload and try again.",
    );
  }
  log.info("CloudKit sign-in control click forwarded", {
    mountTag: mount?.tagName,
    controlTag: control.tagName,
    controlRole: control.getAttribute("role") ?? undefined,
    control: cloudKitSignInControlDiagnostics(),
  });
  control.click();
}

function accountNameFromIdentity(
  identity: CloudKitUserIdentity | undefined,
): string | undefined {
  const given = identity?.nameComponents?.givenName?.trim() ?? "";
  const family = identity?.nameComponents?.familyName?.trim() ?? "";
  const fullName = `${given} ${family}`.trim();
  if (fullName) {
    return fullName;
  }
  return identity?.lookupInfo?.emailAddress?.trim() || undefined;
}

function requireStoredWebAuthToken(
  identity = currentCloudKitIdentity(),
): ICloudOAuthTokens {
  const token = readStoredWebAuthToken();
  if (!token) {
    throw new Error("iCloud sign-in did not return a web auth token.");
  }
  const accountName = accountNameFromIdentity(identity);
  return {
    accessToken: token,
    ...(accountName ? { accountName } : {}),
    ...(identity?.userRecordName
      ? { userRecordName: identity.userRecordName }
      : {}),
  };
}

export type ICloudSharedStorageTarget = ICloudSharedTarget & {
  storageTargetId: string;
};

function normalizedICloudShortGuid(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("provider_setup.icloud_shared_link_required");
  }
  if (trimmed.startsWith("icloud-share-v1:")) {
    const target = parseICloudSharedStorageTarget(trimmed);
    if (target.shortGuid?.trim()) return target.shortGuid.trim();
  }
  try {
    const url = new URL(trimmed);
    const candidate = url.pathname.split("/").filter(Boolean).at(-1);
    if (candidate) return candidate;
  } catch {
    // A raw short GUID is also a valid input.
  }
  return trimmed;
}

function requireCloudKitRecordInfo(
  response: CloudKitRecordInfosResponse,
): Required<Pick<CloudKitRecordInfo, "zoneID" | "rootRecordName">> {
  const info = response.results[0];
  const zoneID = info?.zoneID;
  const rootRecordName =
    info?.rootRecordName?.trim() || info?.rootRecord?.recordName?.trim();
  if (
    !zoneID?.zoneName?.trim() ||
    !zoneID.ownerRecordName?.trim() ||
    !rootRecordName
  ) {
    throw new Error("provider_setup.icloud_shared_location_missing");
  }
  return { zoneID, rootRecordName };
}

async function previewCloudKitRecord(
  container: CloudKitContainer,
  shortGuid: string,
): Promise<CloudKitRecordInfosResponse | undefined> {
  try {
    return await container.fetchRecordInfos?.([shortGuid]);
  } catch {
    return undefined;
  }
}

/** Create a shareable CloudKit root hierarchy in the owner's private DB. */
export async function createICloudSharedVault(
  title: string,
): Promise<ICloudSharedStorageTarget> {
  await initICloudAuth();
  await initNookWasm();
  const container = window.CloudKit!.getDefaultContainer();
  const setupIdentity =
    currentCloudKitIdentity() ?? (await setUpCloudKitAuth(container));
  const identity =
    setupIdentity ?? (await container.fetchCurrentUserIdentity?.());
  const ownerRecordName = identity?.userRecordName?.trim();
  if (!ownerRecordName) {
    throw new Error("provider_setup.icloud_shared_sign_in_first");
  }
  const suffix = crypto.randomUUID();
  const zoneName = `nook-shared-${suffix}`;
  const rootRecordName = `nook-root-${suffix}`;
  const database = container.privateCloudDatabase;
  if (!database) {
    throw new Error("provider_setup.icloud_shared_create_failed");
  }
  await database.saveRecordZones([{ zoneName }]);
  const saved = await database.saveRecords(
    {
      // Reuse the deployed NookVault record type as the share root; shared
      // mode must not depend on an undeployed CloudKit production schema.
      recordType: "NookVault",
      recordName: rootRecordName,
      createShortGUID: true,
      fields: { content: { value: "" } },
    },
    { zoneID: zoneName },
  );
  const root = saved.records[0];
  const shortGuid = root?.shortGUID?.trim();
  if (!root || !shortGuid) {
    throw new Error("provider_setup.icloud_shared_identifier_missing");
  }
  await database.shareWithUI({
    record: root,
    zoneID: zoneName,
    shareTitle: title.trim() || "Nook",
    shareType: "com.meta-secret.nook.vault",
    supportedAccess: ["PRIVATE"],
    supportedPermissions: ["READ_WRITE"],
  });
  return {
    role: "owner",
    zoneName,
    ownerRecordName,
    rootRecordName,
    shortGuid,
    storageTargetId: createICloudSharedStorageTarget(
      "owner",
      zoneName,
      ownerRecordName,
      rootRecordName,
      shortGuid,
    ),
  };
}

/** Accept a share with the recipient's account and return shared-DB routing. */
export async function acceptICloudSharedVault(
  shareReference: string,
): Promise<ICloudSharedStorageTarget> {
  await initICloudAuth();
  await initNookWasm();
  const container = window.CloudKit!.getDefaultContainer();
  const encodedTarget = shareReference.trim().startsWith("icloud-share-v1:")
    ? parseICloudSharedStorageTarget(shareReference.trim())
    : undefined;
  const shortGuid = normalizedICloudShortGuid(shareReference);
  const identity =
    currentCloudKitIdentity() ?? (await container.fetchCurrentUserIdentity?.());
  if (
    encodedTarget &&
    identity?.userRecordName?.trim() === encodedTarget.ownerRecordName.trim()
  ) {
    const storageTargetId = createICloudSharedStorageTarget(
      "owner",
      encodedTarget.zoneName,
      encodedTarget.ownerRecordName,
      encodedTarget.rootRecordName,
      encodedTarget.shortGuid,
    );
    return { ...encodedTarget, role: "owner", storageTargetId };
  }
  if (!container.acceptShares || !container.fetchRecordInfos) {
    throw new Error("provider_setup.icloud_shared_connect_failed");
  }
  const current = await previewCloudKitRecord(container, shortGuid);
  const response =
    current?.results[0]?.participantStatus === "ACCEPTED"
      ? current
      : await container.acceptShares([shortGuid]);
  const { zoneID, rootRecordName } = requireCloudKitRecordInfo(response);
  const ownerRecordName = zoneID.ownerRecordName!;
  return {
    role: "participant",
    zoneName: zoneID.zoneName,
    ownerRecordName,
    rootRecordName,
    shortGuid,
    storageTargetId: createICloudSharedStorageTarget(
      "participant",
      zoneID.zoneName,
      ownerRecordName,
      rootRecordName,
      shortGuid,
    ),
  };
}

function cloudKitCurrentUserURL(): string {
  const container = encodeURIComponent(ICLOUD_CONTAINER_ID);
  const environment = encodeURIComponent(ICLOUD_ENVIRONMENT);
  const apiToken = encodeURIComponent(ICLOUD_API_TOKEN);
  return `https://api.apple-cloudkit.com/database/1/${container}/${environment}/public/users/current?ckAPIToken=${apiToken}`;
}

async function fetchCloudKitWebAuthChallenge(): Promise<CloudKitAuthChallenge> {
  const response = await fetch(cloudKitCurrentUserURL(), {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  const body = (await response
    .json()
    .catch(() => ({}))) as CloudKitAuthChallenge;
  log.info("CloudKit direct web auth challenge received", {
    status: response.status,
    ok: response.ok,
    serverErrorCode: body.serverErrorCode,
    reason: body.reason,
    redirectURL: sanitizedURLDiagnostics(body.redirectURL),
    uuidPresent: Boolean(body.uuid),
  });
  if (body.serverErrorCode === "AUTHENTICATION_REQUIRED" && body.redirectURL) {
    return body;
  }
  if (body.serverErrorCode === "AUTHENTICATION_FAILED") {
    throw new Error(
      "Apple rejected the iCloud API token for this container. Check the CloudKit production API token and the current browser origin.",
    );
  }
  throw new Error(
    body.reason ??
      body.serverErrorCode ??
      `Apple CloudKit auth challenge failed with HTTP ${response.status}.`,
  );
}

function webAuthTokenFromMessageData(data: unknown): string | undefined {
  if (typeof data === "string") {
    try {
      return webAuthTokenFromMessageData(JSON.parse(data));
    } catch {
      return undefined;
    }
  }
  if (data == undefined || typeof data !== "object") {
    return undefined;
  }
  const record = data as Record<string, unknown>;
  for (const key of ["ckWebAuthToken", "webAuthToken", "authToken", "token"]) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return undefined;
}

async function requestDirectCloudKitWebAuthToken(
  timeoutMs = ICLOUD_SIGN_IN_TIMEOUT_MS,
): Promise<string> {
  log.info("CloudKit direct web auth fallback started", {
    timeoutMs,
    browser: currentBrowserDiagnostics(),
  });
  const challenge = await fetchCloudKitWebAuthChallenge();
  const authWindow = window.open(
    challenge.redirectURL,
    "nook-icloud-auth",
    "popup,width=520,height=720",
  );
  if (!authWindow) {
    log.warn("CloudKit direct web auth popup blocked", {
      redirectURL: sanitizedURLDiagnostics(challenge.redirectURL),
    });
    throw new Error(
      "Apple sign-in popup was blocked. Allow popups and try again.",
    );
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout>;
    const cleanup = () => {
      settled = true;
      window.removeEventListener("message", handleMessage);
      clearTimeout(timeoutId);
    };
    const handleMessage = (event: MessageEvent<unknown>) => {
      const token = webAuthTokenFromMessageData(event.data);
      log.info("CloudKit direct web auth message received", {
        origin: event.origin,
        token: tokenDiagnostics(token),
      });
      if (!token || settled) {
        return;
      }
      cleanup();
      storeCloudKitWebAuthToken(ICLOUD_CONTAINER_ID, token);
      try {
        authWindow.close();
      } catch {
        // Ignore browser-specific popup close failures.
      }
      resolve(token);
    };
    window.addEventListener("message", handleMessage);
    timeoutId = setTimeout(() => {
      if (settled) {
        return;
      }
      cleanup();
      log.warn("CloudKit direct web auth fallback timed out", {
        timeoutMs,
        storage: webAuthTokenStorageDiagnostics(),
      });
      reject(cloudKitSignInTimeoutError());
    }, timeoutMs);
  });
}

async function waitForCloudKitSignIn(
  container: CloudKitContainer,
  timeoutMs = ICLOUD_SIGN_IN_TIMEOUT_MS,
  options: Pick<ICloudWebAuthTokenRequestOptions, "clickSignInControl"> = {},
): Promise<CloudKitUserIdentity> {
  const shouldClickSignInControl = options.clickSignInControl !== false;
  const useDirectAuthWithoutNativeClick =
    shouldClickSignInControl && isBraveBrowser();
  log.info("CloudKit sign-in wait started", {
    timeoutMs,
    clickSignInControl: shouldClickSignInControl,
    directAuthWithoutNativeClick: useDirectAuthWithoutNativeClick,
    tokenBeforeWait: tokenDiagnostics(readStoredWebAuthToken()),
    storage: webAuthTokenStorageDiagnostics(),
    control: cloudKitSignInControlDiagnostics(),
  });
  if (useDirectAuthWithoutNativeClick) {
    await requestDirectCloudKitWebAuthToken(timeoutMs);
    log.info("CloudKit sign-in succeeded through direct primary auth", {
      token: tokenDiagnostics(readStoredWebAuthToken()),
    });
    return currentCloudKitIdentity() ?? {};
  }
  const tokenPromise = waitForStoredWebAuthToken(timeoutMs);
  let sawExpectedSignInFailure = false;
  const signInPromise = container
    .whenUserSignsIn()
    .then((userIdentity) => {
      rememberCloudKitIdentity(userIdentity);
      log.info("CloudKit whenUserSignsIn resolved", {
        signedIn: Boolean(userIdentity),
        token: tokenDiagnostics(readStoredWebAuthToken()),
        storage: webAuthTokenStorageDiagnostics(),
      });
      return userIdentity;
    })
    .catch((error: unknown) => {
      if (isExpectedSignInSetupFailure(error)) {
        sawExpectedSignInFailure = true;
        log.info("CloudKit sign-in callback waiting for web auth token", {
          details: cloudKitAuthErrorDetails(error),
          hasSignInMount: hasCloudKitSignInControl(),
          storage: webAuthTokenStorageDiagnostics(),
          control: cloudKitSignInControlDiagnostics(),
        });
        return undefined;
      }
      throw error;
    });
  signInPromise.catch(() => {
    // The CloudKit token store can resolve first; keep later callback failures handled.
  });
  if (shouldClickSignInControl) {
    clickCloudKitSignInButton();
  }
  try {
    await Promise.race([tokenPromise, signInPromise]);
    // After the race, the token may already be in cookies or session
    // storage even when putToken was not called (CloudKit JS may bypass
    // the custom authTokenStore).  Check directly before blocking on
    // tokenPromise so we don't wait for the full timeout.
    const immediateToken = readStoredWebAuthToken();
    if (immediateToken) {
      log.info("CloudKit sign-in succeeded with immediate token", {
        signedIn: Boolean(currentCloudKitIdentity()),
        token: tokenDiagnostics(immediateToken),
      });
      return currentCloudKitIdentity() ?? {};
    }
    if (sawExpectedSignInFailure) {
      await requestDirectCloudKitWebAuthToken(timeoutMs);
      log.info("CloudKit sign-in succeeded through direct fallback", {
        token: tokenDiagnostics(readStoredWebAuthToken()),
      });
      return currentCloudKitIdentity() ?? {};
    }
    await tokenPromise;
    log.info("CloudKit sign-in succeeded after token wait", {
      signedIn: Boolean(currentCloudKitIdentity()),
      token: tokenDiagnostics(readStoredWebAuthToken()),
    });
    return currentCloudKitIdentity() ?? {};
  } catch (error) {
    // Allow a fresh setUpAuth attempt on the next user interaction so
    // retries do not reuse a stale cached promise.
    cloudKitAuthSetup = EMPTY_VALUE;
    cloudKitIdentity = EMPTY_VALUE;
    logCloudKitAuthFailure("CloudKit sign-in failed", error);
    throw new Error(cloudKitAuthErrorMessage(error), { cause: error });
  }
}

export function requestPreparedICloudWebAuthToken(
  options: ICloudWebAuthTokenRequestOptions = {},
): Promise<ICloudOAuthTokens> {
  log.info("CloudKit prepared token request started", {
    hasCloudKitGlobal: Boolean(window.CloudKit),
    hasAuthSetupPromise: Boolean(currentAuthSetup()),
    hasAuthSetupUserIdentity: Boolean(currentCloudKitIdentity()),
    clickSignInControl: options.clickSignInControl !== false,
  });
  if (!window.CloudKit || !currentAuthSetup()) {
    return Promise.reject(
      new Error(
        "Apple sign-in control is still loading. Try again in a moment.",
      ),
    );
  }
  if (currentCloudKitIdentity()) {
    log.info("CloudKit prepared token request using existing identity");
    return Promise.resolve(requireStoredWebAuthToken());
  }
  const container = window.CloudKit.getDefaultContainer();
  return waitForCloudKitSignIn(
    container,
    options.signInTimeoutMs,
    options,
  ).then((identity) => requireStoredWebAuthToken(identity));
}

export async function requestICloudWebAuthToken(
  options: ICloudWebAuthTokenRequestOptions = {},
): Promise<ICloudOAuthTokens> {
  log.info("CloudKit direct token request started");
  await initICloudAuth();
  const container = window.CloudKit!.getDefaultContainer();
  const userIdentity = await setUpCloudKitAuth(container).catch(
    (error: unknown) => {
      logCloudKitAuthFailure("CloudKit auth setup failed", error);
      throw new Error(cloudKitAuthErrorMessage(error), { cause: error });
    },
  );

  if (!userIdentity && readStoredWebAuthToken()) {
    log.info("CloudKit direct token request reused stored token");
    return requireStoredWebAuthToken();
  }

  if (!userIdentity) {
    await waitForCloudKitSignIn(container, options.signInTimeoutMs, options);
  }

  log.info("CloudKit direct token request returning token", {
    token: tokenDiagnostics(readStoredWebAuthToken()),
  });
  return requireStoredWebAuthToken();
}

export function oauthTokensToICloudConfig(
  tokens: ICloudOAuthTokens,
  existing?: OAuthFileConfig,
): OAuthFileConfig {
  return iCloudOAuthTokensToConfigCore(
    tokens.accessToken,
    tokens.accountName ?? undefined,
    existing,
  );
}

export async function ensureValidICloudOAuthFileConfig(
  config: OAuthFileConfig,
): Promise<OAuthFileConfig> {
  if (config.accessToken?.trim()) {
    return config;
  }
  const refreshed = await requestICloudWebAuthToken();
  return oauthTokensToICloudConfig(refreshed, config);
}
