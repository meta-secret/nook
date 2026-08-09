/**
 * Google Identity Services (GIS) token client for Drive access.
 *
 * Browser-only — no server, no client secret, no redirect callback.
 * Access tokens are short-lived (~1h); silent refresh uses requestAccessToken
 * while the user's Google session is still active.
 *
 * Scopes:
 * - Private provider mode: `drive.appdata` (hidden application data folder).
 * - Shared provider mode: `drive.file` for writes plus `drive.readonly` so a
 *   collaborator can read the owner-created folder and immutable event files.
 */

import type {
  OAuthFileConfig,
  StoredOAuthFileConfiguration,
} from "$lib/auth/providers";
import { configuredOAuthFile } from "$lib/auth/providers";
import { googleOAuthTokensToConfig as googleOAuthTokensToConfigCore } from "$app-wasm";
import { GOOGLE_OAUTH_CLIENT_ID } from "$lib/auth/google/config";

const GIS_SCRIPT_URL = "https://accounts.google.com/gsi/client";
export const DRIVE_APPDATA_SCOPE =
  "https://www.googleapis.com/auth/drive.appdata";
export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const DRIVE_READONLY_SCOPE =
  "https://www.googleapis.com/auth/drive.readonly";

export enum GoogleDriveOAuthScope {
  AppData = "appdata",
  Shared = "shared",
}

export enum GoogleOAuthPrompt {
  /** @public Google Identity Services contract value. */
  Default = "",
  /** @public Google Identity Services contract value. */
  None = "none",
  /** @public Google Identity Services contract value. */
  Consent = "consent",
  /** @public Google Identity Services contract value. */
  SelectAccount = "select_account",
}

export type GoogleOAuthTokens = {
  accessToken: string;
  expiresAt: string;
};

export enum GoogleAccountIdentityKind {
  Unavailable = "unavailable",
  Available = "available",
}

export type GoogleAccountIdentity =
  | { kind: GoogleAccountIdentityKind.Unavailable }
  | { kind: GoogleAccountIdentityKind.Available; label: string };

type GoogleTokenResponse = {
  access_token: string;
  expires_in: number;
  error?: string;
  error_description?: string;
};

type GoogleTokenClientConfig = {
  client_id: string;
  scope: string;
  callback: (response: GoogleTokenResponse) => void;
};

type TokenClient = {
  requestAccessToken: (opts?: { prompt?: string }) => void;
};

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (config: GoogleTokenClientConfig) => TokenClient;
        };
      };
    };
  }
}

enum TokenRequestKind {
  Idle = "idle",
  AwaitingResponse = "awaiting-response",
}

type TokenRequest =
  | { kind: TokenRequestKind.Idle }
  | {
      kind: TokenRequestKind.AwaitingResponse;
      resolve: (response: GoogleTokenResponse) => void;
    };
enum GoogleIdentityServicesKind {
  NotLoaded = "not-loaded",
  Loading = "loading",
}

type GoogleIdentityServices =
  | { kind: GoogleIdentityServicesKind.NotLoaded }
  | { kind: GoogleIdentityServicesKind.Loading; completion: Promise<void> };

type TokenClientSlot = {
  scopeKey: string;
  client: TokenClient;
  request: TokenRequest;
};

const tokenClients = new Map<string, TokenClientSlot>();
let googleIdentityServices: GoogleIdentityServices = {
  kind: GoogleIdentityServicesKind.NotLoaded,
};

export function isGoogleOAuthConfigured(): boolean {
  return Boolean(GOOGLE_OAUTH_CLIENT_ID.trim());
}

function googleClientId(): string {
  const clientId = GOOGLE_OAUTH_CLIENT_ID.trim();
  if (!clientId) {
    throw new Error("Google OAuth client id is not configured.");
  }
  return clientId;
}

function scopeString(scope: GoogleDriveOAuthScope): string {
  switch (scope) {
    case GoogleDriveOAuthScope.Shared:
      return `${DRIVE_FILE_SCOPE} ${DRIVE_READONLY_SCOPE}`;
    case GoogleDriveOAuthScope.AppData:
    default:
      return DRIVE_APPDATA_SCOPE;
  }
}

function loadGisScript(): Promise<void> {
  return new Promise(
    // eslint-disable-next-line max-params -- Host API owns this positional callback signature.
    (resolve, reject) => {
      if (window.google?.accounts?.oauth2) {
        resolve();
        return;
      }
      const existing = document.querySelector(
        `script[src="${GIS_SCRIPT_URL}"]`,
      );
      if (existing) {
        const addEventListenerArgs: Parameters<
          typeof existing.addEventListener
        >[2] = { once: true };
        existing.addEventListener(
          "load",
          () => resolve(),
          addEventListenerArgs,
        );
        const addEventListenerArgs2: Parameters<
          typeof existing.addEventListener
        >[2] = { once: true };
        existing.addEventListener(
          "error",
          () => reject(new Error("Failed to load Google Identity Services.")),
          addEventListenerArgs2,
        );
        return;
      }
      const script = document.createElement("script");
      script.src = GIS_SCRIPT_URL;
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () =>
        reject(new Error("Failed to load Google Identity Services."));
      document.head.appendChild(script);
    },
  );
}

async function ensureGisReady(): Promise<void> {
  if (googleIdentityServices.kind === GoogleIdentityServicesKind.Loading) {
    return googleIdentityServices.completion;
  }
  const promise = loadGisScript();
  googleIdentityServices = {
    kind: GoogleIdentityServicesKind.Loading,
    completion: promise,
  };
  return promise;
}

async function tokenClientForScope(
  scope: GoogleDriveOAuthScope,
): Promise<TokenClientSlot> {
  await ensureGisReady();
  const key = scopeString(scope);
  const existing = tokenClients.get(key);
  if (existing) {
    return existing;
  }
  const initTokenClientArgs: GoogleTokenClientConfig = {
    client_id: googleClientId(),
    scope: key,
    callback: (response) => {
      const current = tokenClients.get(key);
      if (current?.request.kind === TokenRequestKind.AwaitingResponse) {
        current.request.resolve(response);
        current.request = { kind: TokenRequestKind.Idle };
      }
    },
  };
  const client =
    window.google!.accounts.oauth2.initTokenClient(initTokenClientArgs);
  const slot: TokenClientSlot = {
    scopeKey: key,
    client,
    request: { kind: TokenRequestKind.Idle },
  };
  tokenClients.set(key, slot);
  return slot;
}

/** Private mode: initialize the default `drive.appdata` token client. */
export async function initGoogleAuth(): Promise<void> {
  await tokenClientForScope(GoogleDriveOAuthScope.AppData);
}

/** Shared mode: initialize the per-file write + Drive read token client. */
export async function initGoogleSharedDriveAuth(): Promise<void> {
  await tokenClientForScope(GoogleDriveOAuthScope.Shared);
}

function tokensFromResponse(response: GoogleTokenResponse): GoogleOAuthTokens {
  if (response.error) {
    throw new Error(
      response.error_description ?? response.error ?? "Google sign-in failed.",
    );
  }
  if (!response.access_token) {
    throw new Error("Google did not return an access token.");
  }
  const expiresIn = response.expires_in ?? 3600;
  return {
    accessToken: response.access_token,
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
  };
}

export async function requestGoogleAccessToken(options?: {
  prompt?: GoogleOAuthPrompt;
  scope?: GoogleDriveOAuthScope;
}): Promise<GoogleOAuthTokens> {
  const scope = options?.scope ?? GoogleDriveOAuthScope.AppData;
  const slot = await tokenClientForScope(scope);

  return new Promise(
    // eslint-disable-next-line max-params -- Host API owns this positional callback signature.
    (resolve, reject) => {
      slot.request = {
        kind: TokenRequestKind.AwaitingResponse,
        resolve: (response) => {
          try {
            resolve(tokensFromResponse(response));
          } catch (error) {
            reject(error);
          }
        },
      };
      if (options && "prompt" in options) {
        const requestAccessTokenArgs: Parameters<
          typeof slot.client.requestAccessToken
        >[0] = { prompt: options.prompt };
        slot.client.requestAccessToken(requestAccessTokenArgs);
        return;
      }
      slot.client.requestAccessToken();
    },
  );
}

/** Request the scopes required for cross-account shared-folder replication. */
export async function requestGoogleDriveSharedAccess(options?: {
  prompt?: GoogleOAuthPrompt;
}): Promise<GoogleOAuthTokens> {
  const requestGoogleAccessTokenArgs: Parameters<
    typeof requestGoogleAccessToken
  >[0] = {
    prompt: options?.prompt ?? GoogleOAuthPrompt.Consent,
    scope: GoogleDriveOAuthScope.Shared,
  };
  return requestGoogleAccessToken(requestGoogleAccessTokenArgs);
}

export function oauthTokensToConfig({
  tokens,
  existing,
}: {
  readonly tokens: GoogleOAuthTokens;
  readonly existing: StoredOAuthFileConfiguration;
}): OAuthFileConfig {
  return googleOAuthTokensToConfigCore(
    tokens.accessToken,
    tokens.expiresAt,
    existing,
  );
}

export function isOAuthAccessTokenExpired({
  config,
  skewMs,
}: {
  readonly config: OAuthFileConfig;
  readonly skewMs: number;
}): boolean {
  if (config.expiresAt.state === "unknown") return false;
  const expiresAt = Date.parse(config.expiresAt.value);
  if (Number.isNaN(expiresAt)) return false;
  return Date.now() + skewMs >= expiresAt;
}

export async function ensureValidOAuthFileConfig(
  config: OAuthFileConfig,
): Promise<OAuthFileConfig> {
  if (
    !(() => {
      const isOAuthAccessTokenExpiredArgs: Parameters<
        typeof isOAuthAccessTokenExpired
      >[0] = { config, skewMs: 60_000 };
      return isOAuthAccessTokenExpired(isOAuthAccessTokenExpiredArgs);
    })()
  ) {
    return config;
  }
  const shared =
    config.driveMode === "shared" || config.folderId.state === "folderId";
  const scope = shared
    ? GoogleDriveOAuthScope.Shared
    : GoogleDriveOAuthScope.AppData;
  const requestGoogleAccessTokenArgs2: Parameters<
    typeof requestGoogleAccessToken
  >[0] = {
    prompt: GoogleOAuthPrompt.Default,
    scope,
  };
  const refreshed = await requestGoogleAccessToken(
    requestGoogleAccessTokenArgs2,
  );
  const oauthTokensToConfigArgs: Parameters<typeof oauthTokensToConfig>[0] = {
    tokens: refreshed,
    existing: configuredOAuthFile(config),
  };
  return oauthTokensToConfig(oauthTokensToConfigArgs);
}

export async function fetchGoogleAccountEmail(
  accessToken: string,
): Promise<GoogleAccountIdentity> {
  const fetchArgs: Parameters<typeof fetch>[1] = {
    headers: { Authorization: `Bearer ${accessToken}` },
  };
  const response = await fetch(
    "https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName)",
    fetchArgs,
  );
  if (!response.ok) {
    return { kind: GoogleAccountIdentityKind.Unavailable };
  }
  const payload: unknown = await response.json();
  if (Object(payload) !== payload) {
    return { kind: GoogleAccountIdentityKind.Unavailable };
  }
  const user: unknown = Reflect.get(payload as object, "user");
  if (Object(user) !== user) {
    return { kind: GoogleAccountIdentityKind.Unavailable };
  }
  const emailAddress: unknown = Reflect.get(user as object, "emailAddress");
  if (typeof emailAddress === "string" && emailAddress.trim()) {
    return {
      kind: GoogleAccountIdentityKind.Available,
      label: emailAddress,
    };
  }
  const displayName: unknown = Reflect.get(user as object, "displayName");
  return typeof displayName === "string" && displayName.trim()
    ? { kind: GoogleAccountIdentityKind.Available, label: displayName }
    : { kind: GoogleAccountIdentityKind.Unavailable };
}
