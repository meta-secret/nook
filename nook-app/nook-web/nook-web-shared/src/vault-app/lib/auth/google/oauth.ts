import { err, ok, type Result } from "neverthrow";
import { OAuthFailure, OAuthFailureKind } from "$lib/auth/oauth-failure";
/**
 * Google Identity Services (GIS) token client for Drive access.
 *
 * Browser-only — no server, no client secret, no redirect callback.
 * Access tokens are short-lived (~1h); silent refresh uses requestAccessToken
 * while the user's Google session is still active.
 *
 * Scopes (least privilege):
 * - `VaultFolder` (`drive.file` only, non-sensitive) for sign-in and silent
 *   refresh. It opens, creates, and shares the vault folder and reads and
 *   writes the event files this app created.
 * - `Shared` adds `drive.readonly`, a restricted scope, only where another
 *   account's files must be read: a joiner accepting an onboarding link, and
 *   the owner authorizing another account. Until Google verifies Nook, that
 *   consent shows the "Google hasn't verified this app" warning.
 *
 * A new provider sign-in sends `include_granted_scopes: false`: an account
 * that granted `drive.readonly` earlier would otherwise fold that restricted
 * grant back into the consent and get the unverified-app warning again. A
 * silent refresh and the shared requests keep earlier grants, so a refreshed
 * token still covers `drive.readonly` once the account granted it.
 */

import type { OAuthAccountIdentity } from "$lib/auth/providers";
import {
  google_drive_authorization_freshness,
  type GoogleDriveAccess,
} from "$app-wasm";
import { GOOGLE_OAUTH_CLIENT_ID } from "$lib/auth/google/config";

const GIS_SCRIPT_URL = "https://accounts.google.com/gsi/client";

export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";

export const DRIVE_READONLY_SCOPE =
  "https://www.googleapis.com/auth/drive.readonly";

export enum GoogleDriveOAuthScope {
  /** `drive.file`: the vault folder and the files this app created. */
  VaultFolder = "vault-folder",
  /** `drive.file` plus `drive.readonly`: files other accounts created. */
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
  /** The account Google preselects; empty lets the user choose. */
  readonly login_hint: string;
  /** False asks Google for exactly the requested scopes, without earlier grants. */
  readonly include_granted_scopes: boolean;
};

type TokenClient = {
  requestAccessToken: (request: GoogleTokenPromptRequest) => void;
};

export type GoogleAccessTokenRequest = {
  readonly prompt: GoogleOAuthPrompt;
  readonly scope: GoogleDriveOAuthScope;
  readonly accountHint: string;
  /** Whether the token also carries scopes the account granted before. */
  readonly includeGrantedScopes: boolean;
};

export type GoogleSharedDriveAccessRequest = {
  readonly prompt: GoogleOAuthPrompt;
  /** The authorized account an onboarding link names. */
  readonly accountHint: string;
};

export type GoogleDriveAccessGrant = {
  readonly tokens: GoogleOAuthTokens;
  readonly account: OAuthAccountIdentity;
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
/** The account a GIS answer names, in Rust's account vocabulary. */
export class GoogleAccountIdentities {
  static of(identity: GoogleAccountIdentity): OAuthAccountIdentity {
    switch (identity.kind) {
      case GoogleAccountIdentityKind.Available:
        return { state: "email", email: identity.label };
      case GoogleAccountIdentityKind.Unavailable:
        return { state: "unknown" };
    }
  }
}

/** The GIS login hint for an account: its address, or the empty hint that
 * lets the user choose. */
export class GoogleAccountHint {
  static of(account: OAuthAccountIdentity): string {
    switch (account.state) {
      case "email":
        return account.email;
      case "unknown":
        return "";
    }
  }
}

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
      case GoogleDriveOAuthScope.VaultFolder:
        return DRIVE_FILE_SCOPE;
      case GoogleDriveOAuthScope.Shared:
        return `${DRIVE_FILE_SCOPE} ${DRIVE_READONLY_SCOPE}`;
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
          login_hint: request.accountHint.trim(),
          include_granted_scopes: request.includeGrantedScopes,
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
      accountHint: request.accountHint,
      includeGrantedScopes: true,
    };
    return this.requestGoogleAccessToken(accessRequest);
  }
  /** The Drive access a GIS answer grants, as Rust's sign-in DTO. */
  driveAccess({ tokens, account }: GoogleDriveAccessGrant): GoogleDriveAccess {
    return {
      authorization: {
        accessToken: tokens.accessToken,
        expiresAt: tokens.expiresAt,
      },
      account,
    };
  }

  /** The access itself while Rust says it is current; otherwise a silent
   * GIS request for a fresh token of the same account. */
  async ensureFreshDriveAccess(
    access: GoogleDriveAccess,
  ): Promise<Result<GoogleDriveAccess, OAuthFailure>> {
    const check: Parameters<typeof google_drive_authorization_freshness>[0] = {
      authorization: access.authorization,
      now: new Date().toISOString(),
    };
    const freshness = google_drive_authorization_freshness(check);
    switch (freshness) {
      case "current":
        return ok(access);
      case "refreshDue":
        return this.refreshDriveAccess(access);
    }
  }

  private async refreshDriveAccess(
    access: GoogleDriveAccess,
  ): Promise<Result<GoogleDriveAccess, OAuthFailure>> {
    // A silent refresh never asks for a new scope; previously granted
    // `drive.readonly` comes back through `include_granted_scopes`.
    const accessRequest: GoogleAccessTokenRequest = {
      prompt: GoogleOAuthPrompt.Default,
      scope: GoogleDriveOAuthScope.VaultFolder,
      accountHint: GoogleAccountHint.of(access.account),
      includeGrantedScopes: true,
    };
    const refreshed = await this.requestGoogleAccessToken(accessRequest);
    return refreshed.map((tokens) => {
      const grant: GoogleDriveAccessGrant = { tokens, account: access.account };
      return this.driveAccess(grant);
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
