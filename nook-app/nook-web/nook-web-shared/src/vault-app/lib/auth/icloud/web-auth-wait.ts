import { err, ok, type Result } from "neverthrow";
import { OAuthFailure, OAuthFailureKind } from "$lib/auth/oauth-failure";
import {
  ICLOUD_API_TOKEN,
  ICLOUD_CONTAINER_ID,
  ICLOUD_ENVIRONMENT,
} from "$lib/auth/icloud/config";
import {
  cloudKitRuntime,
  WebAuthTokenLookupKind,
  type WebAuthTokenLookup,
} from "$lib/auth/icloud/cloudkit-runtime";

export const ICLOUD_SIGN_IN_TIMEOUT_MS = 60_000;

enum CloudKitTokenWaitMode {
  Stored = "stored",
  Native = "native",
}
enum CloudKitTokenWaitState {
  Waiting = "waiting",
  Settled = "settled",
}
type CloudKitTokenWaitRequest = {
  browser: typeof globalThis;
  owner: CloudKitSignInBrowser;
  timeoutMs: number;
  mode: CloudKitTokenWaitMode;
  popup?: Window;
};

/** Owns every listener, timer and optional popup until one terminal outcome. */
export class CloudKitTokenWait {
  private state = CloudKitTokenWaitState.Waiting;
  private readonly timeout: ReturnType<typeof setTimeout>;
  private readonly poll: ReturnType<typeof setInterval>;
  private resolve: (outcome: Result<string, OAuthFailure>) => void = () => {};
  readonly completion = new Promise<Result<string, OAuthFailure>>((resolve) => {
    this.resolve = resolve;
  });
  private readonly tokenListener = (outcome: Result<string, OAuthFailure>) =>
    this.finish(outcome);
  private readonly messageListener = (event: MessageEvent<unknown>) => {
    const token = this.request.owner.webAuthTokenFromMessageData(event.data);
    if (token.kind === WebAuthTokenLookupKind.Unavailable) return;
    const stored = cloudKitRuntime.storeCloudKitWebAuthToken({
      containerIdentifier: ICLOUD_CONTAINER_ID,
      token,
    });
    this.finish(stored.isErr() ? err(stored.error) : ok(token.token));
  };
  constructor(private readonly request: CloudKitTokenWaitRequest) {
    this.timeout = setTimeout(
      () => this.finish(err(new OAuthFailure(OAuthFailureKind.TimedOut))),
      request.timeoutMs,
    );
    this.poll = setInterval(() => this.observe(), 500);
    cloudKitRuntime.addTokenListener(this.tokenListener);
    if (request.mode === CloudKitTokenWaitMode.Native) {
      try {
        request.browser.window.addEventListener(
          "message",
          this.messageListener,
        );
      } catch {
        this.finish(
          err(new OAuthFailure(OAuthFailureKind.CloudKitAuthentication)),
        );
        return;
      }
    }
    this.observe();
  }
  private observe(): void {
    if (this.state === CloudKitTokenWaitState.Settled) return;
    let popupClosed = false;
    try {
      popupClosed = this.request.popup ? this.request.popup.closed : false;
    } catch {
      this.finish(
        err(new OAuthFailure(OAuthFailureKind.CloudKitAuthentication)),
      );
      return;
    }
    if (popupClosed) {
      this.finish(err(new OAuthFailure(OAuthFailureKind.Cancelled)));
      return;
    }
    const token = this.request.owner.readStoredWebAuthToken();
    if (token.isErr()) this.finish(err(token.error));
    else if (token.value.kind === WebAuthTokenLookupKind.Available)
      this.finish(ok(token.value.token));
  }
  private finish(outcome: Result<string, OAuthFailure>): void {
    if (this.state === CloudKitTokenWaitState.Settled) return;
    this.state = CloudKitTokenWaitState.Settled;
    clearTimeout(this.timeout);
    clearInterval(this.poll);
    cloudKitRuntime.removeTokenListener(this.tokenListener);
    let terminalOutcome = outcome;
    try {
      this.request.browser.window.removeEventListener(
        "message",
        this.messageListener,
      );
    } catch {
      terminalOutcome = err(new OAuthFailure(OAuthFailureKind.CleanupFailed));
    }
    try {
      this.request.popup?.close();
    } catch {
      terminalOutcome = err(new OAuthFailure(OAuthFailureKind.CleanupFailed));
    }
    this.resolve(terminalOutcome);
  }
  cancel(): void {
    this.finish(err(new OAuthFailure(OAuthFailureKind.Cancelled)));
  }
}

/** Browser I/O admission and ownership of each CloudKit token wait. */
class CloudKitSignInBrowser {
  constructor(private readonly browser: typeof globalThis) {}
  readStoredWebAuthToken(): Result<WebAuthTokenLookup, OAuthFailure> {
    try {
      for (const part of this.browser.document.cookie.split(";")) {
        const trimmed = part.trim();
        if (!trimmed.startsWith("ckWebAuthToken")) continue;
        const eq = trimmed.indexOf("=");
        if (eq === -1) continue;
        const value = trimmed.slice(eq + 1);
        if (value)
          return ok({
            kind: WebAuthTokenLookupKind.Available,
            token: decodeURIComponent(value),
          });
      }
    } catch {
      return err(new OAuthFailure(OAuthFailureKind.BrowserStorage));
    }
    return cloudKitRuntime.readStoredToken(ICLOUD_CONTAINER_ID);
  }
  startStoredWebAuthTokenWait(
    timeoutMs = ICLOUD_SIGN_IN_TIMEOUT_MS,
  ): CloudKitTokenWait {
    return new CloudKitTokenWait({
      browser: this.browser,
      owner: this,
      timeoutMs,
      mode: CloudKitTokenWaitMode.Stored,
    });
  }
  startNativeCloudKitWebAuthTokenWait(
    timeoutMs = ICLOUD_SIGN_IN_TIMEOUT_MS,
  ): CloudKitTokenWait {
    return new CloudKitTokenWait({
      browser: this.browser,
      owner: this,
      timeoutMs,
      mode: CloudKitTokenWaitMode.Native,
    });
  }
  private async fetchCloudKitWebAuthChallenge(): Promise<
    Result<string, OAuthFailure>
  > {
    const container = encodeURIComponent(ICLOUD_CONTAINER_ID);
    const environment = encodeURIComponent(ICLOUD_ENVIRONMENT);
    const apiToken = encodeURIComponent(ICLOUD_API_TOKEN);
    let value: unknown;
    try {
      const response = await fetch(
        `https://api.apple-cloudkit.com/database/1/${container}/${environment}/public/users/current?ckAPIToken=${apiToken}`,
        { method: "GET", headers: { Accept: "application/json" } },
      );
      value = await response.json();
    } catch {
      return err(new OAuthFailure(OAuthFailureKind.InvalidChallenge));
    }
    if (
      !value ||
      typeof value !== "object" ||
      !("serverErrorCode" in value) ||
      value.serverErrorCode !== "AUTHENTICATION_REQUIRED" ||
      !("redirectURL" in value) ||
      typeof value.redirectURL !== "string" ||
      !value.redirectURL
    )
      return err(new OAuthFailure(OAuthFailureKind.InvalidChallenge));
    return ok(value.redirectURL);
  }
  webAuthTokenFromMessageData(data: unknown): WebAuthTokenLookup {
    if (typeof data === "string") {
      let decoded: unknown;
      try {
        decoded = JSON.parse(data);
      } catch {
        return { kind: WebAuthTokenLookupKind.Unavailable };
      }
      return this.webAuthTokenFromMessageData(decoded);
    }
    if (!data || typeof data !== "object")
      return { kind: WebAuthTokenLookupKind.Unavailable };
    for (const key of [
      "ckWebAuthToken",
      "webAuthToken",
      "authToken",
      "token",
    ]) {
      const candidate =
        key === "ckWebAuthToken" && "ckWebAuthToken" in data
          ? data.ckWebAuthToken
          : key === "webAuthToken" && "webAuthToken" in data
            ? data.webAuthToken
            : key === "authToken" && "authToken" in data
              ? data.authToken
              : key === "token" && "token" in data
                ? data.token
                : false;
      if (typeof candidate === "string" && candidate.trim())
        return {
          kind: WebAuthTokenLookupKind.Available,
          token: candidate.trim(),
        };
    }
    return { kind: WebAuthTokenLookupKind.Unavailable };
  }
  async requestDirectCloudKitWebAuthToken(
    timeoutMs = ICLOUD_SIGN_IN_TIMEOUT_MS,
  ): Promise<Result<string, OAuthFailure>> {
    const challenge = await this.fetchCloudKitWebAuthChallenge();
    if (challenge.isErr()) return err(challenge.error);
    let opened: ReturnType<Window["open"]>;
    try {
      opened = this.browser.window.open(
        challenge.value,
        "nook-icloud-auth",
        "popup,width=520,height=720",
      );
    } catch {
      return err(new OAuthFailure(OAuthFailureKind.PopupBlocked));
    }
    if (!opened) return err(new OAuthFailure(OAuthFailureKind.PopupBlocked));
    const wait = new CloudKitTokenWait({
      browser: this.browser,
      owner: this,
      timeoutMs,
      mode: CloudKitTokenWaitMode.Native,
      popup: opened,
    });
    return wait.completion;
  }
}
export const cloudKitSignInBrowser = new CloudKitSignInBrowser(globalThis);
