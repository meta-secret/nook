import { I18N_KEYS } from "../../../../generated/i18n-keys";

/**
 * CloudKit JS web auth for iCloud private-database vault storage.
 *
 * Browser-only — no server, no client secret. After sign-in, the web auth
 * token is passed to wasm for CloudKit REST calls.
 */

import {
  configuredOAuthFile,
  oauthAccessToken,
  OAuthAccessTokenKind,
  storedOAuthAccountEmail,
  unknownOAuthAccountIdentity,
  type OAuthFileConfig,
  type StoredOAuthFileConfiguration,
} from "$lib/auth/providers";
import { icloud_oauth_tokens_to_config } from "$app-wasm";
import {
  default as initNookWasm,
  create_icloud_shared_storage_target,
  parse_icloud_shared_storage_target,
  type ICloudSharedTarget,
} from "$app-wasm";
import {
  ICLOUD_API_TOKEN,
  ICLOUD_CONTAINER_ID,
  ICLOUD_ENVIRONMENT,
} from "$lib/auth/icloud/config";
import { browserLogRuntime } from "$lib/runtime/log";
import {
  CloudKitButtonTheme,
  CloudKitParticipantStatus,
  CloudKitShareAccess,
  CloudKitSharePermission,
} from "$lib/auth/icloud/cloudkit-state";
import {
  CLOUDKIT_SIGN_IN_BUTTON_ID,
  CLOUDKIT_SIGN_OUT_BUTTON_ID,
  cloudKitAuthTokenStore,
  WebAuthTokenLookupKind,
  type CloudKitContainer,
  type CloudKitAuthErrorDetails,
  type CloudKitConfiguration,
  type CloudKitRecordInfo,
  type CloudKitRecordInfosResponse,
  type CloudKitUserIdentity,
  cloudKitRuntime,
} from "$lib/auth/icloud/cloudkit-runtime";
import {
  CloudKitFailureDiagnostic,
  CloudKitFailurePresentation,
  CloudKitSetupFailure,
} from "$lib/auth/icloud/auth-errors";
import {
  CloudKitAuthSetupKind,
  CloudKitIdentityKind,
  CloudKitInitializationKind,
  CloudKitAccountPresentation,
  ICloudAccountNameKind,
  type CloudKitAuthSetup,
  type CloudKitIdentity,
  type CloudKitInitialization,
  type ICloudAccountName,
} from "$lib/auth/icloud/auth-state";
import {
  ICLOUD_SIGN_IN_TIMEOUT_MS,
  cloudKitSignInBrowser,
} from "$lib/auth/icloud/web-auth-wait";

export {
  ICloudAccountNameKind,
  type ICloudAccountName,
} from "$lib/auth/icloud/auth-state";

export { ICLOUD_SIGN_IN_TIMEOUT_MS } from "$lib/auth/icloud/web-auth-wait";

const log = browserLogRuntime.createLogger("icloud-oauth");

export type ICloudOAuthTokens = {
  accessToken: string;
  accountName: ICloudAccountName;
};

export type ICloudWebAuthTokenRequest = {
  readonly signInTimeoutMs: number;
  readonly clickSignInControl: boolean;
};

type CloudKitAuthFailureLog = {
  readonly message: string;
  readonly details: CloudKitAuthErrorDetails;
};

type CloudKitRecordPreviewRequest = {
  readonly container: CloudKitContainer;
  readonly shortGuid: string;
};

type CloudKitSignInRequest = {
  readonly container: CloudKitContainer;
  readonly timeoutMs: number;
  readonly clickSignInControl: boolean;
};

export type ICloudOAuthConfigurationUpdate = {
  readonly tokens: ICloudOAuthTokens;
  readonly existing: StoredOAuthFileConfiguration;
};

export type ICloudSharedStorageTarget = ICloudSharedTarget & {
  storageTargetId: string;
};

enum EncodedICloudSharedTargetKind {
  PlainShortGuid = "plain-short-guid",
  EncodedTarget = "encoded-target",
}

type EncodedICloudSharedTarget =
  | { kind: EncodedICloudSharedTargetKind.PlainShortGuid }
  | {
      kind: EncodedICloudSharedTargetKind.EncodedTarget;
      target: ICloudSharedTarget;
    };

enum CloudKitRecordPreviewKind {
  Unavailable = "unavailable",
  Available = "available",
}

type CloudKitRecordPreview =
  | { kind: CloudKitRecordPreviewKind.Unavailable }
  | {
      kind: CloudKitRecordPreviewKind.Available;
      response: CloudKitRecordInfosResponse;
    };

/** Owns the browser runtime resources shared by these interactions. */
class ICloudOAuthSession {
  private cloudKitInitialization: CloudKitInitialization = {
    kind: CloudKitInitializationKind.NotStarted,
  };
  private cloudKitAuthSetup: CloudKitAuthSetup = {
    kind: CloudKitAuthSetupKind.NotStarted,
  };
  private cloudKitIdentity: CloudKitIdentity = {
    kind: CloudKitIdentityKind.SignedOut,
  };
  private currentAuthSetup(): CloudKitAuthSetup {
    return this.cloudKitAuthSetup;
  }

  private currentCloudKitIdentity(): CloudKitIdentity {
    return this.cloudKitIdentity;
  }

  private cloudKitIdentityFromExternal(
    identity: CloudKitUserIdentity,
  ): CloudKitIdentity {
    return {
      kind: CloudKitIdentityKind.SignedIn,
      identity,
    };
  }

  private async fetchCurrentCloudKitIdentity(
    container: CloudKitContainer,
  ): Promise<CloudKitIdentity> {
    return container.fetchCurrentUserIdentity();
  }

  private rememberCloudKitIdentity(identity: CloudKitIdentity): void {
    this.cloudKitIdentity = identity;
  }

  resetICloudAuthStateForTests(): void {
    this.cloudKitInitialization = {
      kind: CloudKitInitializationKind.NotStarted,
    };
    this.cloudKitAuthSetup = { kind: CloudKitAuthSetupKind.NotStarted };
    this.cloudKitIdentity = { kind: CloudKitIdentityKind.SignedOut };
    cloudKitRuntime.clearTokenListeners();
  }

  isICloudOAuthConfigured(): boolean {
    return Boolean(
      ICLOUD_CONTAINER_ID.trim() &&
      ICLOUD_API_TOKEN.trim() &&
      ICLOUD_CONTAINER_ID.startsWith("iCloud."),
    );
  }

  private hasCloudKitSignInControl(): boolean {
    return (
      "document" in globalThis &&
      Boolean(document.getElementById(CLOUDKIT_SIGN_IN_BUTTON_ID))
    );
  }

  private logCloudKitAuthFailure({ message }: CloudKitAuthFailureLog): void {
    log.warn(message);
  }

  async initICloudAuth(): Promise<void> {
    if (
      this.cloudKitInitialization.kind ===
      CloudKitInitializationKind.Initializing
    ) {
      log.info("CloudKit auth init reused existing promise");
      return this.cloudKitInitialization.completion;
    }
    const operation = (async () => {
      log.info("CloudKit auth init started");
      await cloudKitRuntime.loadCloudKitScript();
      const configureArgs: CloudKitConfiguration = {
        containers: [
          {
            containerIdentifier: ICLOUD_CONTAINER_ID,
            environment: ICLOUD_ENVIRONMENT,
            apiTokenAuth: {
              apiToken: ICLOUD_API_TOKEN,
              persist: true,
              signInButton: {
                id: CLOUDKIT_SIGN_IN_BUTTON_ID,
                theme: CloudKitButtonTheme.Black,
              },
              signOutButton: {
                id: CLOUDKIT_SIGN_OUT_BUTTON_ID,
                theme: CloudKitButtonTheme.Black,
              },
            },
          },
        ],
        services: {
          authTokenStore: cloudKitAuthTokenStore,
        },
      };
      window.CloudKit!.configure(configureArgs);
      log.info("CloudKit auth configured");
    })();
    this.cloudKitInitialization = {
      kind: CloudKitInitializationKind.Initializing,
      completion: operation,
    };
    return operation;
  }

  private setUpCloudKitAuth(
    container: CloudKitContainer,
  ): Promise<CloudKitIdentity> {
    const existingSetup = this.currentAuthSetup();
    if (existingSetup.kind === CloudKitAuthSetupKind.Initializing) {
      log.info("CloudKit setUpAuth reused existing promise");
      return existingSetup.completion;
    }
    log.info("CloudKit setUpAuth started");
    const operation = (() => {
      const setUpAuthArgs: Parameters<typeof container.setUpAuth>[0] = {
        grabAuthToken: true,
        persist: true,
      };
      return container.setUpAuth(setUpAuthArgs);
    })()
      .then((identity) => {
        this.rememberCloudKitIdentity(identity);
        log.info("CloudKit setUpAuth completed");
        return identity;
      })
      .catch((error) => {
        const expectedFailureArgs: ConstructorParameters<
          typeof CloudKitSetupFailure
        >[0] = {
          error,
          hasSignInControl: this.hasCloudKitSignInControl(),
        };
        if (new CloudKitSetupFailure(expectedFailureArgs).expected) {
          log.info("CloudKit auth setup waiting for Apple sign-in");
          const identity: CloudKitIdentity = {
            kind: CloudKitIdentityKind.SignedOut,
          };
          this.cloudKitIdentity = identity;
          return identity;
        }
        this.cloudKitAuthSetup = { kind: CloudKitAuthSetupKind.NotStarted };
        this.cloudKitIdentity = { kind: CloudKitIdentityKind.SignedOut };
        throw error;
      });
    this.cloudKitAuthSetup = {
      kind: CloudKitAuthSetupKind.Initializing,
      completion: operation,
    };
    return operation;
  }

  async prepareICloudSignInControl(): Promise<void> {
    log.info("CloudKit sign-in control prepare started");
    await this.initICloudAuth();
    const container = cloudKitRuntime.getDefaultCloudKitContainer();
    const mount = document.getElementById(CLOUDKIT_SIGN_IN_BUTTON_ID);
    const existingControl = mount?.querySelector(
      'button, [role="button"], iframe, a, .apple-auth-button',
    );
    const authSetup = this.currentAuthSetup();
    const identity = this.currentCloudKitIdentity();
    if (
      authSetup.kind === CloudKitAuthSetupKind.Initializing &&
      identity.kind === CloudKitIdentityKind.SignedOut &&
      cloudKitSignInBrowser.readStoredWebAuthToken().kind ===
        WebAuthTokenLookupKind.Unavailable &&
      !existingControl
    ) {
      this.cloudKitAuthSetup = { kind: CloudKitAuthSetupKind.NotStarted };
    }
    try {
      await this.setUpCloudKitAuth(container);
      log.info("CloudKit sign-in control ready");
    } catch (error) {
      const logCloudKitAuthFailureArgs: Parameters<
        typeof this.logCloudKitAuthFailure
      >[0] = {
        message: "CloudKit auth setup failed",
        details: new CloudKitFailureDiagnostic(error).details,
      };
      this.logCloudKitAuthFailure(logCloudKitAuthFailureArgs);
      const ErrorArgs: ConstructorParameters<typeof Error>[1] = {
        cause: error,
      };
      throw new Error(
        new CloudKitFailurePresentation(error).translationKey,
        ErrorArgs,
      );
    }
  }

  private clickCloudKitSignInButton(): void {
    const mount = document.getElementById(CLOUDKIT_SIGN_IN_BUTTON_ID);
    const control = ((v) => (v ? v : mount))(
      mount?.querySelector<HTMLElement>(
        'button, [role="button"], iframe, a, .apple-auth-button',
      ),
    );
    if (!control) {
      log.warn("CloudKit sign-in control click failed: control missing ");
      throw new Error(
        "Apple sign-in control is not ready. Reload and try again.",
      );
    }
    log.info("CloudKit sign-in control click forwarded");
    control.click();
  }

  private requireStoredWebAuthToken(
    identity = this.currentCloudKitIdentity(),
  ): ICloudOAuthTokens {
    const token = cloudKitSignInBrowser.readStoredWebAuthToken();
    if (token.kind === WebAuthTokenLookupKind.Unavailable) {
      throw new Error("iCloud sign-in did not return a web auth token.");
    }
    const accountName = new CloudKitAccountPresentation(identity).name;
    return {
      accessToken: token.token,
      accountName,
    };
  }

  private normalizedICloudShortGuid(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) {
      throw new Error(I18N_KEYS.ProviderSetupIcloudSharedLinkRequired);
    }
    if (trimmed.startsWith("icloud-share-v1:")) {
      const target = parse_icloud_shared_storage_target(trimmed);
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

  private requireCloudKitRecordInfo(
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
      throw new Error(I18N_KEYS.ProviderSetupIcloudSharedLocationMissing);
    }
    return { zoneID, rootRecordName };
  }

  private async previewCloudKitRecord({
    container,
    shortGuid,
  }: CloudKitRecordPreviewRequest): Promise<CloudKitRecordPreview> {
    try {
      if (!container.fetchRecordInfos) {
        return { kind: CloudKitRecordPreviewKind.Unavailable };
      }
      return {
        kind: CloudKitRecordPreviewKind.Available,
        response: await container.fetchRecordInfos([shortGuid]),
      };
    } catch {
      return { kind: CloudKitRecordPreviewKind.Unavailable };
    }
  }

  async createICloudSharedVault(
    title: string,
  ): Promise<ICloudSharedStorageTarget> {
    await this.initICloudAuth();
    await initNookWasm();
    const container = cloudKitRuntime.getDefaultCloudKitContainer();
    const currentIdentity = this.currentCloudKitIdentity();
    const setupIdentity =
      currentIdentity.kind === CloudKitIdentityKind.SignedIn
        ? currentIdentity
        : await this.setUpCloudKitAuth(container);
    const identity =
      setupIdentity.kind === CloudKitIdentityKind.SignedIn
        ? setupIdentity
        : await this.fetchCurrentCloudKitIdentity(container);
    const ownerRecordName =
      identity.kind === CloudKitIdentityKind.SignedIn
        ? identity.identity.userRecordName?.trim()
        : "";
    if (!ownerRecordName) {
      throw new Error(I18N_KEYS.ProviderSetupIcloudSharedSignInFirst);
    }
    const suffix = crypto.randomUUID();
    const zoneName = `nook-shared-${suffix}`;
    const rootRecordName = `nook-root-${suffix}`;
    const database = container.privateCloudDatabase;
    if (!database) {
      throw new Error(I18N_KEYS.ProviderSetupIcloudSharedCreateFailed);
    }
    await database.saveRecordZones([{ zoneName }]);
    const saveRecordsArgs: Parameters<typeof database.saveRecords>[0] = {
      // Reuse the deployed NookVault record type as the share root; shared
      // mode must not depend on an undeployed CloudKit production schema.
      recordType: "NookVault",
      recordName: rootRecordName,
      createShortGUID: true,
      fields: { content: { value: "" } },
    };
    const saveRecordsArgs2: Parameters<typeof database.saveRecords>[1] = {
      zoneID: zoneName,
    };
    const saved = await database.saveRecords(saveRecordsArgs, saveRecordsArgs2);
    const root = saved.records[0];
    const shortGuid = root?.shortGUID?.trim();
    if (!root || !shortGuid) {
      throw new Error(I18N_KEYS.ProviderSetupIcloudSharedIdentifierMissing);
    }
    const shareWithUIArgs: Parameters<typeof database.shareWithUI>[0] = {
      record: root,
      zoneID: zoneName,
      shareTitle: title.trim() || "Nook",
      shareType: "com.meta-secret.nook.vault",
      supportedAccess: [CloudKitShareAccess.Private],
      supportedPermissions: [CloudKitSharePermission.ReadWrite],
    };
    await database.shareWithUI(shareWithUIArgs);
    return {
      role: "owner",
      zoneName,
      ownerRecordName,
      rootRecordName,
      shortGuid,
      storageTargetId: create_icloud_shared_storage_target(
        "owner",
        zoneName,
        ownerRecordName,
        rootRecordName,
        shortGuid,
      ),
    };
  }

  async acceptICloudSharedVault(
    shareReference: string,
  ): Promise<ICloudSharedStorageTarget> {
    await this.initICloudAuth();
    await initNookWasm();
    const container = cloudKitRuntime.getDefaultCloudKitContainer();
    const encodedTarget: EncodedICloudSharedTarget = shareReference
      .trim()
      .startsWith("icloud-share-v1:")
      ? {
          kind: EncodedICloudSharedTargetKind.EncodedTarget,
          target: parse_icloud_shared_storage_target(shareReference.trim()),
        }
      : { kind: EncodedICloudSharedTargetKind.PlainShortGuid };
    const shortGuid = this.normalizedICloudShortGuid(shareReference);
    const currentIdentity = this.currentCloudKitIdentity();
    const identity =
      currentIdentity.kind === CloudKitIdentityKind.SignedIn
        ? currentIdentity
        : await this.fetchCurrentCloudKitIdentity(container);
    if (
      encodedTarget.kind === EncodedICloudSharedTargetKind.EncodedTarget &&
      identity.kind === CloudKitIdentityKind.SignedIn &&
      identity.identity.userRecordName?.trim() ===
        encodedTarget.target.ownerRecordName.trim()
    ) {
      const storageTargetId = create_icloud_shared_storage_target(
        "owner",
        encodedTarget.target.zoneName,
        encodedTarget.target.ownerRecordName,
        encodedTarget.target.rootRecordName,
        encodedTarget.target.shortGuid,
      );
      return { ...encodedTarget.target, role: "owner", storageTargetId };
    }
    if (!container.acceptShares || !container.fetchRecordInfos) {
      throw new Error(I18N_KEYS.ProviderSetupIcloudSharedConnectFailed);
    }
    const recordPreviewRequest: Parameters<
      typeof this.previewCloudKitRecord
    >[0] = {
      container,
      shortGuid,
    };
    const current = await this.previewCloudKitRecord(recordPreviewRequest);
    const response =
      current.kind === CloudKitRecordPreviewKind.Available &&
      current.response.results[0]?.participantStatus ===
        CloudKitParticipantStatus.Accepted
        ? current.response
        : await container.acceptShares([shortGuid]);
    const { zoneID, rootRecordName } = this.requireCloudKitRecordInfo(response);
    const ownerRecordName = zoneID.ownerRecordName!;
    return {
      role: "participant",
      zoneName: zoneID.zoneName,
      ownerRecordName,
      rootRecordName,
      shortGuid,
      storageTargetId: create_icloud_shared_storage_target(
        "participant",
        zoneID.zoneName,
        ownerRecordName,
        rootRecordName,
        shortGuid,
      ),
    };
  }

  private async waitForCloudKitSignIn({
    container,
    timeoutMs,
    clickSignInControl,
  }: CloudKitSignInRequest): Promise<CloudKitIdentity> {
    const shouldClickSignInControl = clickSignInControl;
    const useDirectAuthWithoutNativeClick =
      shouldClickSignInControl && cloudKitRuntime.isBraveBrowser();
    log.info("CloudKit sign-in wait started");
    if (useDirectAuthWithoutNativeClick) {
      await cloudKitSignInBrowser.requestDirectCloudKitWebAuthToken(timeoutMs);
      log.info("CloudKit sign-in succeeded through direct primary auth ");
      return this.currentCloudKitIdentity();
    }
    const tokenPromise = shouldClickSignInControl
      ? cloudKitSignInBrowser.waitForStoredWebAuthToken(timeoutMs)
      : cloudKitSignInBrowser.waitForNativeCloudKitWebAuthToken(timeoutMs);
    let sawExpectedSignInFailure = false;
    const signInPromise = container
      .whenUserSignsIn()
      .then((userIdentity) => {
        const identity = this.cloudKitIdentityFromExternal(userIdentity);
        this.rememberCloudKitIdentity(identity);
        log.info("CloudKit whenUserSignsIn resolved");
        return identity;
      })
      .catch((error) => {
        const expectedFailureArgs2: ConstructorParameters<
          typeof CloudKitSetupFailure
        >[0] = {
          error,
          hasSignInControl: this.hasCloudKitSignInControl(),
        };
        if (new CloudKitSetupFailure(expectedFailureArgs2).expected) {
          sawExpectedSignInFailure = true;
          log.info("CloudKit sign-in callback waiting for web auth token ");
          return { kind: CloudKitIdentityKind.SignedOut } as CloudKitIdentity;
        }
        // Native Apple UI may still finish after CloudKit rejects the callback.
        // Keep waiting for the token instead of failing while the popup is open.
        if (!shouldClickSignInControl) {
          sawExpectedSignInFailure = true;
          log.info(
            "CloudKit sign-in callback failed during native click; waiting for token ",
          );
          return { kind: CloudKitIdentityKind.SignedOut } as CloudKitIdentity;
        }
        throw error;
      });
    signInPromise.catch(() => {
      // The CloudKit token store can resolve first; keep later callback failures handled.
    });
    if (shouldClickSignInControl) {
      this.clickCloudKitSignInButton();
    }
    try {
      await Promise.race([tokenPromise, signInPromise]);
      // After the race, the token may already be in cookies or session
      // storage even when putToken was not called (CloudKit JS may bypass
      // the custom authTokenStore).  Check directly before blocking on
      // tokenPromise so we don't wait for the full timeout.
      const immediateToken = cloudKitSignInBrowser.readStoredWebAuthToken();
      if (immediateToken.kind === WebAuthTokenLookupKind.Available) {
        log.info("CloudKit sign-in succeeded with immediate token");
        return this.currentCloudKitIdentity();
      }
      if (sawExpectedSignInFailure && shouldClickSignInControl) {
        // Only open the direct Web Services window when we still own the click.
        // After a native CloudKit button click the Apple window is already open;
        // a second window.open is blocked on Brave and fails the flow immediately.
        await cloudKitSignInBrowser.requestDirectCloudKitWebAuthToken(
          timeoutMs,
        );
        log.info("CloudKit sign-in succeeded through direct fallback ");
        return this.currentCloudKitIdentity();
      }
      await tokenPromise;
      log.info("CloudKit sign-in succeeded after token wait");
      return this.currentCloudKitIdentity();
    } catch (error) {
      // Allow a fresh setUpAuth attempt on the next user interaction so
      // retries do not reuse a stale cached promise.
      this.cloudKitAuthSetup = { kind: CloudKitAuthSetupKind.NotStarted };
      this.cloudKitIdentity = { kind: CloudKitIdentityKind.SignedOut };
      const logCloudKitAuthFailureArgs2: Parameters<
        typeof this.logCloudKitAuthFailure
      >[0] = {
        message: "CloudKit sign-in failed",
        details: new CloudKitFailureDiagnostic(error).details,
      };
      this.logCloudKitAuthFailure(logCloudKitAuthFailureArgs2);
      const ErrorArgs2: ConstructorParameters<typeof Error>[1] = {
        cause: error,
      };
      throw new Error(
        new CloudKitFailurePresentation(error).translationKey,
        ErrorArgs2,
      );
    }
  }

  requestPreparedICloudWebAuthToken(
    request: ICloudWebAuthTokenRequest,
  ): Promise<ICloudOAuthTokens> {
    log.info("CloudKit prepared token request started");
    if (
      !window.CloudKit ||
      this.currentAuthSetup().kind === CloudKitAuthSetupKind.NotStarted
    ) {
      return Promise.reject(
        new Error(
          "Apple sign-in control is still loading. Try again in a moment.",
        ),
      );
    }
    if (this.currentCloudKitIdentity().kind === CloudKitIdentityKind.SignedIn) {
      log.info("CloudKit prepared token request using existing identity");
      return Promise.resolve(this.requireStoredWebAuthToken());
    }
    const container = cloudKitRuntime.getDefaultCloudKitContainer();
    const waitForCloudKitSignInArgs: Parameters<
      typeof this.waitForCloudKitSignIn
    >[0] = {
      container,
      timeoutMs: request.signInTimeoutMs,
      clickSignInControl: request.clickSignInControl,
    };
    return this.waitForCloudKitSignIn(waitForCloudKitSignInArgs).then(
      (identity) => this.requireStoredWebAuthToken(identity),
    );
  }

  async requestICloudWebAuthToken(
    request: ICloudWebAuthTokenRequest,
  ): Promise<ICloudOAuthTokens> {
    log.info("CloudKit direct token request started");
    await this.initICloudAuth();
    const container = cloudKitRuntime.getDefaultCloudKitContainer();
    const identity = await this.setUpCloudKitAuth(container).catch((error) => {
      const logCloudKitAuthFailureArgs3: Parameters<
        typeof this.logCloudKitAuthFailure
      >[0] = {
        message: "CloudKit auth setup failed",
        details: new CloudKitFailureDiagnostic(error).details,
      };
      this.logCloudKitAuthFailure(logCloudKitAuthFailureArgs3);
      const ErrorArgs3: ConstructorParameters<typeof Error>[1] = {
        cause: error,
      };
      throw new Error(
        new CloudKitFailurePresentation(error).translationKey,
        ErrorArgs3,
      );
    });

    if (
      identity.kind === CloudKitIdentityKind.SignedOut &&
      cloudKitSignInBrowser.readStoredWebAuthToken().kind ===
        WebAuthTokenLookupKind.Available
    ) {
      log.info("CloudKit direct token request reused stored token");
      return this.requireStoredWebAuthToken();
    }

    if (identity.kind === CloudKitIdentityKind.SignedOut) {
      const waitForCloudKitSignInArgs2: Parameters<
        typeof this.waitForCloudKitSignIn
      >[0] = {
        container,
        timeoutMs: request.signInTimeoutMs,
        clickSignInControl: request.clickSignInControl,
      };
      await this.waitForCloudKitSignIn(waitForCloudKitSignInArgs2);
    }
    log.info("CloudKit direct token request returning token");
    return this.requireStoredWebAuthToken();
  }

  oauthTokensToICloudConfig({
    tokens,
    existing,
  }: ICloudOAuthConfigurationUpdate): OAuthFileConfig {
    return icloud_oauth_tokens_to_config(
      tokens.accessToken,
      tokens.accountName.kind === ICloudAccountNameKind.Available
        ? storedOAuthAccountEmail(tokens.accountName.value)
        : unknownOAuthAccountIdentity(),
      existing,
    );
  }

  async ensureValidICloudOAuthFileConfig(
    config: OAuthFileConfig,
  ): Promise<OAuthFileConfig> {
    if (oauthAccessToken(config).kind === OAuthAccessTokenKind.Available) {
      return config;
    }
    const request: ICloudWebAuthTokenRequest = {
      signInTimeoutMs: ICLOUD_SIGN_IN_TIMEOUT_MS,
      clickSignInControl: true,
    };
    const refreshed = await this.requestICloudWebAuthToken(request);
    const oauthTokensToICloudConfigArgs: Parameters<
      typeof this.oauthTokensToICloudConfig
    >[0] = { tokens: refreshed, existing: configuredOAuthFile(config) };
    return this.oauthTokensToICloudConfig(oauthTokensToICloudConfigArgs);
  }
}

export const iCloudOAuthSession = new ICloudOAuthSession();
