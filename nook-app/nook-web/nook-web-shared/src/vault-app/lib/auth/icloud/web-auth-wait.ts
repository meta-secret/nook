/**
 * Wait for / obtain a CloudKit web auth token after Apple sign-in UI runs.
 *
 * Covers token-store polling, Post Message callbacks, and the direct Web
 * Services popup used when Nook still owns the click. Native CloudKit button
 * clicks must not open a second popup.
 */
import {
  ICLOUD_API_TOKEN,
  ICLOUD_CONTAINER_ID,
  ICLOUD_ENVIRONMENT,
} from "$lib/auth/icloud/config";
import { createLogger } from "$lib/runtime/log";
import {
  cloudKitAuthTokenStore,
  cloudKitSignInControlDiagnostics,
  currentBrowserDiagnostics,
  normalizeWebAuthToken,
  sanitizedURLDiagnostics,
  storeCloudKitWebAuthToken,
  tokenDiagnostics,
  WebAuthTokenLookupKind,
  webAuthTokenListeners,
  webAuthTokenStorageDiagnostics,
  type CloudKitAuthChallenge,
  type WebAuthTokenLookup,
} from "$lib/auth/icloud/cloudkit-runtime";
import { CloudKitAuthErrorTranslationKey } from "$lib/auth/icloud/auth-errors";

export const ICLOUD_SIGN_IN_TIMEOUT_MS = 60_000;
const log = createLogger("icloud-oauth");

export function cloudKitSignInTimeoutError(): Error {
  return new Error(
    "Apple sign-in did not complete. Check that CloudKit allows this site and try again.",
  );
}

function readWebAuthTokenFromCookie(): WebAuthTokenLookup {
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
        token: tokenDiagnostics({
          kind: WebAuthTokenLookupKind.Available,
          token,
        }),
      });
      return { kind: WebAuthTokenLookupKind.Available, token };
    }
  }
  return { kind: WebAuthTokenLookupKind.Unavailable };
}

export function readStoredWebAuthToken(): WebAuthTokenLookup {
  const fromCookie = readWebAuthTokenFromCookie();
  if (fromCookie.kind === WebAuthTokenLookupKind.Available) {
    return fromCookie;
  }
  const stored = cloudKitAuthTokenStore.getToken(ICLOUD_CONTAINER_ID);
  const token = normalizeWebAuthToken(stored);
  if (token.kind === WebAuthTokenLookupKind.Available) {
    log.info("CloudKit web auth token found in session storage", {
      storedType: typeof stored,
      token: tokenDiagnostics(token),
    });
  }
  return token;
}

export function waitForStoredWebAuthToken(
  timeoutMs = ICLOUD_SIGN_IN_TIMEOUT_MS,
): Promise<string> {
  const existing = readStoredWebAuthToken();
  if (existing.kind === WebAuthTokenLookupKind.Available) {
    log.info("CloudKit web auth token already available before wait", {
      token: tokenDiagnostics(existing),
      timeoutMs,
    });
    return Promise.resolve(existing.token);
  }
  log.info("CloudKit web auth token wait started", { timeoutMs });

  return new Promise((resolve, reject) => {
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
        token: tokenDiagnostics({
          kind: WebAuthTokenLookupKind.Available,
          token,
        }),
      });
      resolve(token);
    };
    webAuthTokenListeners.add(listener);

    const pollId = setInterval(() => {
      const token = readStoredWebAuthToken();
      if (token.kind === WebAuthTokenLookupKind.Available) {
        cleanup();
        log.info("CloudKit web auth token wait resolved by polling", {
          token: tokenDiagnostics(token),
        });
        resolve(token.token);
      }
    }, 500);

    const timeoutId = setTimeout(() => {
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
    throw new Error(CloudKitAuthErrorTranslationKey.UnknownError, {
      cause: body,
    });
  }
  throw new Error(
    body.reason ??
      body.serverErrorCode ??
      `Apple CloudKit auth challenge failed with HTTP ${response.status}.`,
  );
}

function webAuthTokenFromMessageData(data: unknown): WebAuthTokenLookup {
  if (typeof data === "string") {
    try {
      return webAuthTokenFromMessageData(JSON.parse(data));
    } catch {
      return { kind: WebAuthTokenLookupKind.Unavailable };
    }
  }
  if (!data || typeof data !== "object") {
    return { kind: WebAuthTokenLookupKind.Unavailable };
  }
  const record = data as Record<string, unknown>;
  for (const key of ["ckWebAuthToken", "webAuthToken", "authToken", "token"]) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return {
        kind: WebAuthTokenLookupKind.Available,
        token: candidate.trim(),
      };
    }
  }
  return { kind: WebAuthTokenLookupKind.Unavailable };
}

function listenForCloudKitWebAuthTokenMessage(
  timeoutMs: number,
): Promise<string> {
  log.info("CloudKit web auth postMessage wait started", { timeoutMs });
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      settled = true;
      window.removeEventListener("message", handleMessage);
      clearTimeout(timeoutId);
    };
    const handleMessage = (event: MessageEvent<unknown>) => {
      const token = webAuthTokenFromMessageData(event.data);
      log.info("CloudKit web auth postMessage received", {
        origin: event.origin,
        token: tokenDiagnostics(token),
      });
      if (token.kind === WebAuthTokenLookupKind.Unavailable || settled) {
        return;
      }
      cleanup();
      storeCloudKitWebAuthToken(ICLOUD_CONTAINER_ID, token.token);
      resolve(token.token);
    };
    window.addEventListener("message", handleMessage);
    const timeoutId = setTimeout(() => {
      if (settled) {
        return;
      }
      cleanup();
      reject(cloudKitSignInTimeoutError());
    }, timeoutMs);
  });
}

export async function requestDirectCloudKitWebAuthToken(
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
      if (token.kind === WebAuthTokenLookupKind.Unavailable || settled) {
        return;
      }
      cleanup();
      storeCloudKitWebAuthToken(ICLOUD_CONTAINER_ID, token.token);
      try {
        authWindow.close();
      } catch {
        // Ignore browser-specific popup close failures.
      }
      resolve(token.token);
    };
    window.addEventListener("message", handleMessage);
    const timeoutId = setTimeout(() => {
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

export function waitForNativeCloudKitWebAuthToken(
  timeoutMs = ICLOUD_SIGN_IN_TIMEOUT_MS,
): Promise<string> {
  // The Apple window is already open from the user's CloudKit button click.
  // Wait for CloudKit JS token storage or the Post Message callback without
  // opening a second popup (Brave blocks that and fails the flow immediately).
  return Promise.race([
    waitForStoredWebAuthToken(timeoutMs),
    listenForCloudKitWebAuthTokenMessage(timeoutMs),
  ]);
}
