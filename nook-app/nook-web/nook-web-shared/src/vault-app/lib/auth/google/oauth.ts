import { err, ok, type Result } from "neverthrow";
import { OAuthFailure, OAuthFailureKind } from "$lib/auth/oauth-failure";
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
import { google_oauth_tokens_to_config } from "$app-wasm";
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

type GoogleTokenClientFailure = {
  readonly type: string;
};

type GoogleTokenClientConfig = {
  client_id: string;
  scope: string;
  callback: (response: GoogleTokenResponse) => void;
  error_callback: (failure: GoogleTokenClientFailure) => void;
};

export type GoogleTokenPromptRequest = {
  readonly prompt: string;
};

type TokenClient = {
  requestAccessToken: (request: GoogleTokenPromptRequest) => void;
};

export type GoogleAccessTokenRequest = {
  readonly prompt: GoogleOAuthPrompt;
  readonly scope: GoogleDriveOAuthScope;
};

export type GoogleSharedDriveAccessRequest = {
  readonly prompt: GoogleOAuthPrompt;
};

export type GoogleOAuthConfigurationUpdate = {
  readonly tokens: GoogleOAuthTokens;
  readonly existing: StoredOAuthFileConfiguration;
};

export type GoogleOAuthExpiryAssessment = {
  readonly config: OAuthFileConfig;
  readonly skewMs: number;
};

type GoogleTokenCompletion = Result<GoogleOAuthTokens, OAuthFailure>;

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
      resolve: (response: GoogleTokenCompletion) => void;
    };

enum GoogleIdentityServicesKind {
  NotLoaded = "not-loaded",
  Loading = "loading",
}

type GoogleIdentityServices =
  | { kind: GoogleIdentityServicesKind.NotLoaded }
  | {
      kind: GoogleIdentityServicesKind.Loading;
      completion: Promise<
        Result<GoogleIdentityServicesReadiness, OAuthFailure>
      >;
    };

enum GoogleIdentityServicesReadiness {
  Ready = "ready",
}

export enum GoogleOAuthInitializationOutcome {
  Initialized = "initialized",
}

type TokenClientSlot = {
  scopeKey: string;
  client: TokenClient;
  request: TokenRequest;
};

/** Owns Google browser token clients and their single pending request. */
class GoogleOAuthSession {
  private tokenClients = new Map<string, TokenClientSlot>();
  private googleIdentityServices: GoogleIdentityServices = {
    kind: GoogleIdentityServicesKind.NotLoaded,
  };

  isGoogleOAuthConfigured(): boolean {
    return Boolean(GOOGLE_OAUTH_CLIENT_ID.trim());
  }

  private scopeString(scope: GoogleDriveOAuthScope): string {
    switch (scope) {
      case GoogleDriveOAuthScope.Shared:
        return `${DRIVE_FILE_SCOPE} ${DRIVE_READONLY_SCOPE}`;
      case GoogleDriveOAuthScope.AppData:
        return DRIVE_APPDATA_SCOPE;
    }
  }

  private loadGisScript(): Promise<
    Result<GoogleIdentityServicesReadiness, OAuthFailure>
  > {
    return new Promise((resolve) => {
      try {
        if (window.google?.accounts?.oauth2) {
          resolve(ok(GoogleIdentityServicesReadiness.Ready));
          return;
        }
        const existing = document.querySelector(
          `script[src="${GIS_SCRIPT_URL}"]`,
        );
        const loaded = () => resolve(ok(GoogleIdentityServicesReadiness.Ready));
        const failed = () =>
          resolve(err(new OAuthFailure(OAuthFailureKind.GoogleScript)));
        if (existing) {
          const oneTimeListenerOptions: AddEventListenerOptions = {
            once: true,
          };
          existing.addEventListener("load", loaded, oneTimeListenerOptions);
          existing.addEventListener("error", failed, oneTimeListenerOptions);
          return;
        }
        const script = document.createElement("script");
        script.src = GIS_SCRIPT_URL;
        script.async = true;
        script.defer = true;
        script.onload = loaded;
        script.onerror = failed;
        document.head.appendChild(script);
      } catch {
        resolve(err(new OAuthFailure(OAuthFailureKind.GoogleScript)));
      }
    });
  }

  private ensureGisReady(): Promise<
    Result<GoogleIdentityServicesReadiness, OAuthFailure>
  > {
    if (this.googleIdentityServices.kind === GoogleIdentityServicesKind.Loading)
      return this.googleIdentityServices.completion;
    const completion = this.loadGisScript();
    this.googleIdentityServices = {
      kind: GoogleIdentityServicesKind.Loading,
      completion,
    };
    return completion;
  }

  private async tokenClientForScope(
    scope: GoogleDriveOAuthScope,
  ): Promise<Result<TokenClientSlot, OAuthFailure>> {
    const clientId = GOOGLE_OAUTH_CLIENT_ID.trim();
    if (!clientId)
      return err(new OAuthFailure(OAuthFailureKind.GoogleConfiguration));
    const ready = await this.ensureGisReady();
    if (ready.isErr()) return err(ready.error);
    const key = this.scopeString(scope);
    const existing = this.tokenClients.get(key);
    if (existing) return ok(existing);
    const oauth = window.google?.accounts.oauth2;
    if (!oauth) return err(new OAuthFailure(OAuthFailureKind.GoogleScript));
    const complete = (outcome: GoogleTokenCompletion) => {
      const current = this.tokenClients.get(key);
      if (current?.request.kind !== TokenRequestKind.AwaitingResponse) return;
      const pending = current.request;
      const idleRequest: TokenRequest = { kind: TokenRequestKind.Idle };
      current.request = idleRequest;
      pending.resolve(outcome);
    };
    const config: GoogleTokenClientConfig = {
      client_id: clientId,
      scope: key,
      callback: (response) => complete(this.tokensFromResponse(response)),
      error_callback: (failure) =>
        complete(
          err(
            new OAuthFailure(
              failure.type === "popup_closed"
                ? OAuthFailureKind.GoogleCancelled
                : failure.type === "popup_failed_to_open"
                  ? OAuthFailureKind.GooglePopupBlocked
                  : OAuthFailureKind.GoogleRequest,
            ),
          ),
        ),
    };
    try {
      const client = oauth.initTokenClient(config);
      const slot: TokenClientSlot = {
        scopeKey: key,
        client,
        request: { kind: TokenRequestKind.Idle },
      };
      this.tokenClients.set(key, slot);
      return ok(slot);
    } catch {
      return err(new OAuthFailure(OAuthFailureKind.GoogleRequest));
    }
  }

  async initGoogleAuth(): Promise<
    Result<GoogleOAuthInitializationOutcome, OAuthFailure>
  > {
    return (await this.tokenClientForScope(GoogleDriveOAuthScope.AppData)).map(
      () => GoogleOAuthInitializationOutcome.Initialized,
    );
  }
  async initGoogleSharedDriveAuth(): Promise<
    Result<GoogleOAuthInitializationOutcome, OAuthFailure>
  > {
    return (await this.tokenClientForScope(GoogleDriveOAuthScope.Shared)).map(
      () => GoogleOAuthInitializationOutcome.Initialized,
    );
  }
  private tokensFromResponse(
    response: GoogleTokenResponse,
  ): Result<GoogleOAuthTokens, OAuthFailure> {
    if (response.error)
      return err(
        new OAuthFailure(
          response.error === "access_denied"
            ? OAuthFailureKind.GoogleCancelled
            : OAuthFailureKind.GoogleRequest,
        ),
      );
    if (!response.access_token)
      return err(new OAuthFailure(OAuthFailureKind.GoogleResponse));
    // Date construction parses external GIS protocol data at this boundary.
    try {
      const expiresIn =
        typeof response.expires_in === "number" ? response.expires_in : 3600;
      const tokens: GoogleOAuthTokens = {
        accessToken: response.access_token,
        expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
      };
      return ok(tokens);
    } catch {
      return err(new OAuthFailure(OAuthFailureKind.GoogleResponse));
    }
  }
  async requestGoogleAccessToken(
    request: GoogleAccessTokenRequest,
  ): Promise<Result<GoogleOAuthTokens, OAuthFailure>> {
    const admitted = await this.tokenClientForScope(request.scope);
    if (admitted.isErr()) return err(admitted.error);
    const slot = admitted.value;
    if (slot.request.kind === TokenRequestKind.AwaitingResponse)
      return err(new OAuthFailure(OAuthFailureKind.RequestInProgress));
    return new Promise((resolve) => {
      const pendingRequest: TokenRequest = {
        kind: TokenRequestKind.AwaitingResponse,
        resolve,
      };
      slot.request = pendingRequest;
      try {
        const promptRequest: GoogleTokenPromptRequest = {
          prompt: request.prompt,
        };
        slot.client.requestAccessToken(promptRequest);
      } catch {
        const idleRequest: TokenRequest = { kind: TokenRequestKind.Idle };
        slot.request = idleRequest;
        resolve(err(new OAuthFailure(OAuthFailureKind.GoogleRequest)));
      }
    });
  }
  requestGoogleDriveSharedAccess(
    request: GoogleSharedDriveAccessRequest,
  ): Promise<Result<GoogleOAuthTokens, OAuthFailure>> {
    const accessRequest: GoogleAccessTokenRequest = {
      prompt: request.prompt,
      scope: GoogleDriveOAuthScope.Shared,
    };
    return this.requestGoogleAccessToken(accessRequest);
  }
  oauthTokensToConfig({
    tokens,
    existing,
  }: GoogleOAuthConfigurationUpdate): Result<OAuthFileConfig, OAuthFailure> {
    try {
      return ok(
        google_oauth_tokens_to_config(
          tokens.accessToken,
          tokens.expiresAt,
          existing,
        ),
      );
    } catch {
      return err(new OAuthFailure(OAuthFailureKind.GoogleInvalidConfiguration));
    }
  }
  isOAuthAccessTokenExpired({
    config,
    skewMs,
  }: GoogleOAuthExpiryAssessment): boolean {
    if (config.expiresAt.state === "unknown") return false;
    const expiresAt = Date.parse(config.expiresAt.value);
    if (Number.isNaN(expiresAt)) return false;
    return Date.now() + skewMs >= expiresAt;
  }
  async ensureValidOAuthFileConfig(
    config: OAuthFileConfig,
  ): Promise<Result<OAuthFileConfig, OAuthFailure>> {
    const expiryAssessment: GoogleOAuthExpiryAssessment = {
      config,
      skewMs: 60_000,
    };
    if (!this.isOAuthAccessTokenExpired(expiryAssessment)) return ok(config);
    const accessRequest: GoogleAccessTokenRequest = {
      prompt: GoogleOAuthPrompt.Default,
      scope:
        config.driveMode === "shared" || config.folderId.state === "folderId"
          ? GoogleDriveOAuthScope.Shared
          : GoogleDriveOAuthScope.AppData,
    };
    const refreshed = await this.requestGoogleAccessToken(accessRequest);
    return refreshed.andThen((tokens) => {
      const update: GoogleOAuthConfigurationUpdate = {
        tokens,
        existing: configuredOAuthFile(config),
      };
      return this.oauthTokensToConfig(update);
    });
  }
  async fetchGoogleAccountEmail(
    accessToken: string,
  ): Promise<Result<GoogleAccountIdentity, OAuthFailure>> {
    let payload: unknown;
    try {
      const headers: HeadersInit = { Authorization: `Bearer ${accessToken}` };
      const requestInit: RequestInit = { headers };
      const response = await fetch(
        "https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName)",
        requestInit,
      );
      if (!response.ok)
        return err(new OAuthFailure(OAuthFailureKind.GoogleAccountLookup));
      payload = await response.json();
    } catch {
      return err(new OAuthFailure(OAuthFailureKind.GoogleAccountLookup));
    }
    if (!payload || typeof payload !== "object" || !("user" in payload))
      return ok(this.unavailableAccountIdentity());
    const user = payload.user;
    if (!user || typeof user !== "object")
      return ok(this.unavailableAccountIdentity());
    if (
      "emailAddress" in user &&
      typeof user.emailAddress === "string" &&
      user.emailAddress.trim()
    ) {
      const identity: GoogleAccountIdentity = {
        kind: GoogleAccountIdentityKind.Available,
        label: user.emailAddress,
      };
      return ok(identity);
    }
    if (
      "displayName" in user &&
      typeof user.displayName === "string" &&
      user.displayName.trim()
    ) {
      const identity: GoogleAccountIdentity = {
        kind: GoogleAccountIdentityKind.Available,
        label: user.displayName,
      };
      return ok(identity);
    }
    return ok(this.unavailableAccountIdentity());
  }

  private unavailableAccountIdentity(): GoogleAccountIdentity {
    return { kind: GoogleAccountIdentityKind.Unavailable };
  }
}

export const googleOAuthSession = new GoogleOAuthSession();
