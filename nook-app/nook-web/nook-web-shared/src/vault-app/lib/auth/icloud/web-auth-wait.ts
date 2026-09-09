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

import { browserLogRuntime } from "$lib/runtime/log";

import {
  cloudKitAuthTokenStore,
  WebAuthTokenLookupKind,
  type CloudKitAuthChallenge,
  type WebAuthTokenLookup,
  cloudKitRuntime,
} from "$lib/auth/icloud/cloudkit-runtime";

import { CloudKitAuthErrorTranslationKey } from "$lib/auth/icloud/auth-errors";

export const ICLOUD_SIGN_IN_TIMEOUT_MS = 60_000;

const log = browserLogRuntime.createLogger("icloud-oauth");

/** Owns this browser host’s resources and interaction lifecycle. */
class CloudKitSignInBrowser {
  constructor(private readonly browser: typeof globalThis) {}

  cloudKitSignInTimeoutError(): Error {
    return new Error(
      "Apple sign-in did not complete. Check that CloudKit allows this site and try again.",
    );
  }

  private readWebAuthTokenFromCookie(): WebAuthTokenLookup {
    for (const part of this.browser.document.cookie.split(";")) {
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
        log.info("CloudKit web auth token found in cookie");
        return { kind: WebAuthTokenLookupKind.Available, token };
      }
    }
    return { kind: WebAuthTokenLookupKind.Unavailable };
  }

  readStoredWebAuthToken(): WebAuthTokenLookup {
    const fromCookie = this.readWebAuthTokenFromCookie();
    if (fromCookie.kind === WebAuthTokenLookupKind.Available) {
      return fromCookie;
    }
    const stored = cloudKitAuthTokenStore.getToken(ICLOUD_CONTAINER_ID);
    const token = cloudKitRuntime.normalizeWebAuthToken(stored);
    if (token.kind === WebAuthTokenLookupKind.Available) {
      log.info("CloudKit web auth token found in session storage");
    }
    return token;
  }

  waitForStoredWebAuthToken(
    timeoutMs = ICLOUD_SIGN_IN_TIMEOUT_MS,
  ): Promise<string> {
    const existing = this.readStoredWebAuthToken();
    if (existing.kind === WebAuthTokenLookupKind.Available) {
      log.info("CloudKit web auth token already available before wait ");
      return Promise.resolve(existing.token);
    }
    log.info("CloudKit web auth token wait started");

    return new Promise(
      // eslint-disable-next-line max-params -- Host API owns this positional callback signature.
      (resolve, reject) => {
        let settled = false;

        const cleanup = () => {
          settled = true;
          clearTimeout(timeoutId);
          clearInterval(pollId);
          cloudKitRuntime.removeTokenListener(listener);
        };

        const listener = (token: string) => {
          if (settled) {
            return;
          }
          cleanup();
          log.info("CloudKit web auth token wait resolved by token store ");
          resolve(token);
        };
        cloudKitRuntime.addTokenListener(listener);

        const pollId = setInterval(() => {
          const token = this.readStoredWebAuthToken();
          if (token.kind === WebAuthTokenLookupKind.Available) {
            cleanup();
            log.info("CloudKit web auth token wait resolved by polling ");
            resolve(token.token);
          }
        }, 500);

        const timeoutId = setTimeout(() => {
          cleanup();
          log.warn("CloudKit web auth token wait timed out");
          reject(this.cloudKitSignInTimeoutError());
        }, timeoutMs);
      },
    );
  }

  private cloudKitCurrentUserURL(): string {
    const container = encodeURIComponent(ICLOUD_CONTAINER_ID);
    const environment = encodeURIComponent(ICLOUD_ENVIRONMENT);
    const apiToken = encodeURIComponent(ICLOUD_API_TOKEN);
    return `https://api.apple-cloudkit.com/database/1/${container}/${environment}/public/users/current?ckAPIToken=${apiToken}`;
  }

  private async fetchCloudKitWebAuthChallenge(): Promise<CloudKitAuthChallenge> {
    const fetchArgs: Parameters<typeof fetch>[1] = {
      method: "GET",
      headers: { Accept: "application/json" },
    };
    const response = await fetch(this.cloudKitCurrentUserURL(), fetchArgs);
    const body = (await response
      .json()
      .catch(() => ({}))) as CloudKitAuthChallenge;
    log.info("CloudKit direct web auth challenge received");
    if (
      body.serverErrorCode === "AUTHENTICATION_REQUIRED" &&
      body.redirectURL
    ) {
      return body;
    }
    if (body.serverErrorCode === "AUTHENTICATION_FAILED") {
      const ErrorArgs: ConstructorParameters<typeof Error>[1] = {
        cause: body,
      };
      throw new Error(CloudKitAuthErrorTranslationKey.UnknownError, ErrorArgs);
    }
    throw new Error(
      ((
        ...[
          v = `Apple CloudKit auth challenge failed with HTTP ${response.status}.`,
        ]
      ) => v)(((...[v = body.serverErrorCode]) => v)(body.reason)),
    );
  }

  private webAuthTokenFromMessageData(data: unknown): WebAuthTokenLookup {
    if (typeof data === "string") {
      try {
        return this.webAuthTokenFromMessageData(JSON.parse(data));
      } catch {
        return { kind: WebAuthTokenLookupKind.Unavailable };
      }
    }
    if (!data || typeof data !== "object") {
      return { kind: WebAuthTokenLookupKind.Unavailable };
    }
    const record = data as Record<string, unknown>;
    for (const key of [
      "ckWebAuthToken",
      "webAuthToken",
      "authToken",
      "token",
    ]) {
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

  private listenForCloudKitWebAuthTokenMessage(
    timeoutMs: number,
  ): Promise<string> {
    log.info("CloudKit web auth postMessage wait started");
    return new Promise(
      // eslint-disable-next-line max-params -- Host API owns this positional callback signature.
      (resolve, reject) => {
        let settled = false;
        const cleanup = () => {
          settled = true;
          this.browser.window.removeEventListener("message", handleMessage);
          clearTimeout(timeoutId);
        };
        const handleMessage = (event: MessageEvent<unknown>) => {
          const token = this.webAuthTokenFromMessageData(event.data);
          log.info("CloudKit web auth postMessage received");
          if (token.kind === WebAuthTokenLookupKind.Unavailable || settled) {
            return;
          }
          cleanup();
          const storeCloudKitWebAuthTokenArgs: Parameters<
            typeof cloudKitRuntime.storeCloudKitWebAuthToken
          >[0] = {
            containerIdentifier: ICLOUD_CONTAINER_ID,
            authToken: token.token,
          };
          cloudKitRuntime.storeCloudKitWebAuthToken(
            storeCloudKitWebAuthTokenArgs,
          );
          resolve(token.token);
        };
        this.browser.window.addEventListener("message", handleMessage);
        const timeoutId = setTimeout(() => {
          if (settled) {
            return;
          }
          cleanup();
          reject(this.cloudKitSignInTimeoutError());
        }, timeoutMs);
      },
    );
  }

  async requestDirectCloudKitWebAuthToken(
    timeoutMs = ICLOUD_SIGN_IN_TIMEOUT_MS,
  ): Promise<string> {
    log.info("CloudKit direct web auth fallback started");
    const challenge = await this.fetchCloudKitWebAuthChallenge();
    const authWindow = this.browser.window.open(
      challenge.redirectURL,
      "nook-icloud-auth",
      "popup,width=520,height=720",
    );
    if (!authWindow) {
      log.warn("CloudKit direct web auth popup blocked");
      throw new Error(
        "Apple sign-in popup was blocked. Allow popups and try again.",
      );
    }
    return new Promise(
      // eslint-disable-next-line max-params -- Host API owns this positional callback signature.
      (resolve, reject) => {
        let settled = false;
        const cleanup = () => {
          settled = true;
          this.browser.window.removeEventListener("message", handleMessage);
          clearTimeout(timeoutId);
        };
        const handleMessage = (event: MessageEvent<unknown>) => {
          const token = this.webAuthTokenFromMessageData(event.data);
          log.info("CloudKit direct web auth message received");
          if (token.kind === WebAuthTokenLookupKind.Unavailable || settled) {
            return;
          }
          cleanup();
          const storeCloudKitWebAuthTokenArgs2: Parameters<
            typeof cloudKitRuntime.storeCloudKitWebAuthToken
          >[0] = {
            containerIdentifier: ICLOUD_CONTAINER_ID,
            authToken: token.token,
          };
          cloudKitRuntime.storeCloudKitWebAuthToken(
            storeCloudKitWebAuthTokenArgs2,
          );
          try {
            authWindow.close();
          } catch {
            // Ignore browser-specific popup close failures.
          }
          resolve(token.token);
        };
        this.browser.window.addEventListener("message", handleMessage);
        const timeoutId = setTimeout(() => {
          if (settled) {
            return;
          }
          cleanup();
          log.warn("CloudKit direct web auth fallback timed out");
          reject(this.cloudKitSignInTimeoutError());
        }, timeoutMs);
      },
    );
  }

  waitForNativeCloudKitWebAuthToken(
    timeoutMs = ICLOUD_SIGN_IN_TIMEOUT_MS,
  ): Promise<string> {
    // The Apple window is already open from the user's CloudKit button click.
    // Wait for CloudKit JS token storage or the Post Message callback without
    // opening a second popup (Brave blocks that and fails the flow immediately).
    return Promise.race([
      this.waitForStoredWebAuthToken(timeoutMs),
      this.listenForCloudKitWebAuthTokenMessage(timeoutMs),
    ]);
  }
}

export const cloudKitSignInBrowser = new CloudKitSignInBrowser(globalThis);
