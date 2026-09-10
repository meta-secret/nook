import { err, ok, type Result } from "neverthrow";
import { OAuthFailure, OAuthFailureKind } from "$lib/auth/oauth-failure";

/**
 * CloudKit JS web auth for iCloud private-database vault storage.
 *
 * Browser-only — no server, no client secret. After sign-in, the web auth
 * token is passed to wasm for CloudKit REST calls.
 */

import {
  configuredOAuthFile,
  OAuthAccessTokenKind,
  oauth_access_token,
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
  type CloudKitConfiguration,
  type CloudKitRecordInfosResponse,
  cloudKitRuntime,
} from "$lib/auth/icloud/cloudkit-runtime";
import { CloudKitSetupFailure } from "$lib/auth/icloud/auth-errors";
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

export type ICloudOAuthTokens = {
  accessToken: string;
  accountName: ICloudAccountName;
};

export type ICloudWebAuthTokenRequest = {
  readonly signInTimeoutMs: number;
  readonly clickSignInControl: boolean;
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

enum CloudKitSignInResidency {
  Active = "active",
  Released = "released",
}
/** Owns CloudKit initialization, identity and each sign-in interaction. */
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
  private async fetchCurrentCloudKitIdentity(
    container: CloudKitContainer,
  ): Promise<Result<CloudKitIdentity, OAuthFailure>> {
    try {
      return ok(await container.fetchCurrentUserIdentity());
    } catch {
      return err(new OAuthFailure(OAuthFailureKind.CloudKitAuthentication));
    }
  }
  initICloudAuth(): Promise<Result<void, OAuthFailure>> {
    if (
      this.cloudKitInitialization.kind ===
      CloudKitInitializationKind.Initializing
    )
      return this.cloudKitInitialization.completion;
    const completion = this.initialize();
    this.cloudKitInitialization = {
      kind: CloudKitInitializationKind.Initializing,
      completion,
    };
    return completion;
  }
  private async initialize(): Promise<Result<void, OAuthFailure>> {
    const loaded = await cloudKitRuntime.loadCloudKitScript();
    if (loaded.isErr()) return err(loaded.error);
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
      services: { authTokenStore: cloudKitAuthTokenStore },
    };
    try {
      if (!window.CloudKit)
        return err(new OAuthFailure(OAuthFailureKind.CloudKitUnavailable));
      window.CloudKit.configure(configureArgs);
      return ok();
    } catch {
      return err(new OAuthFailure(OAuthFailureKind.CloudKitAuthentication));
    }
  }
  private setUpCloudKitAuth(
    container: CloudKitContainer,
  ): Promise<Result<CloudKitIdentity, OAuthFailure>> {
    if (this.cloudKitAuthSetup.kind === CloudKitAuthSetupKind.Initializing)
      return this.cloudKitAuthSetup.completion;
    const completion = this.performAuthSetup(container);
    this.cloudKitAuthSetup = {
      kind: CloudKitAuthSetupKind.Initializing,
      completion,
    };
    return completion;
  }
  private async performAuthSetup(
    container: CloudKitContainer,
  ): Promise<Result<CloudKitIdentity, OAuthFailure>> {
    try {
      const identity = await container.setUpAuth({
        grabAuthToken: true,
        persist: true,
      });
      this.cloudKitIdentity = identity;
      return ok(identity);
    } catch (error) {
      this.cloudKitIdentity = { kind: CloudKitIdentityKind.SignedOut };
      if (
        new CloudKitSetupFailure({
          error,
          hasSignInControl: this.hasCloudKitSignInControl(),
        }).expected
      )
        return ok(this.cloudKitIdentity);
      this.cloudKitAuthSetup = { kind: CloudKitAuthSetupKind.NotStarted };
      return err(new OAuthFailure(OAuthFailureKind.CloudKitAuthentication));
    }
  }
  async prepareICloudSignInControl(): Promise<Result<void, OAuthFailure>> {
    const initialized = await this.initICloudAuth();
    if (initialized.isErr()) return err(initialized.error);
    const admitted = cloudKitRuntime.getDefaultCloudKitContainer();
    if (admitted.isErr()) return err(admitted.error);
    const token = cloudKitSignInBrowser.readStoredWebAuthToken();
    if (token.isErr()) return err(token.error);
    const mount = document.getElementById(CLOUDKIT_SIGN_IN_BUTTON_ID);
    const existing = mount?.querySelector(
      'button, [role="button"], iframe, a, .apple-auth-button',
    );
    if (
      this.cloudKitAuthSetup.kind === CloudKitAuthSetupKind.Initializing &&
      this.cloudKitIdentity.kind === CloudKitIdentityKind.SignedOut &&
      token.value.kind === WebAuthTokenLookupKind.Unavailable &&
      !existing
    )
      this.cloudKitAuthSetup = { kind: CloudKitAuthSetupKind.NotStarted };
    return (await this.setUpCloudKitAuth(admitted.value)).map(() => {});
  }
  private clickCloudKitSignInButton(): Result<void, OAuthFailure> {
    try {
      const mount = document.getElementById(CLOUDKIT_SIGN_IN_BUTTON_ID);
      const control = mount
        ? mount.querySelector<HTMLElement>(
            'button, [role="button"], iframe, a, .apple-auth-button',
          ) || mount
        : mount;
      if (!control)
        return err(new OAuthFailure(OAuthFailureKind.ControlUnavailable));
      control.click();
      return ok();
    } catch {
      return err(new OAuthFailure(OAuthFailureKind.ControlUnavailable));
    }
  }
  private requireStoredWebAuthToken(
    identity = this.cloudKitIdentity,
  ): Result<ICloudOAuthTokens, OAuthFailure> {
    const token = cloudKitSignInBrowser.readStoredWebAuthToken();
    if (token.isErr()) return err(token.error);
    if (token.value.kind === WebAuthTokenLookupKind.Unavailable)
      return err(new OAuthFailure(OAuthFailureKind.TokenUnavailable));
    return ok({
      accessToken: token.value.token,
      accountName: new CloudKitAccountPresentation(identity).name,
    });
  }
  private normalizedICloudShortGuid(
    value: string,
  ): Result<string, OAuthFailure> {
    const trimmed = value.trim();
    if (!trimmed)
      return err(new OAuthFailure(OAuthFailureKind.SharedLinkRequired));
    if (trimmed.startsWith("icloud-share-v1:")) {
      try {
        const target = parse_icloud_shared_storage_target(trimmed);
        if (target.shortGuid?.trim()) return ok(target.shortGuid.trim());
      } catch {
        return err(new OAuthFailure(OAuthFailureKind.SharedLinkRequired));
      }
    }
    try {
      const candidate = new URL(trimmed).pathname
        .split("/")
        .filter(Boolean)
        .at(-1);
      if (candidate) return ok(candidate);
    } catch {
      /* A raw short GUID is an admitted alternative to a URL. */
    }
    return ok(trimmed);
  }
  private requireCloudKitRecordInfo(
    response: CloudKitRecordInfosResponse,
  ): Result<
    {
      zoneID: { zoneName: string; ownerRecordName: string };
      rootRecordName: string;
    },
    OAuthFailure
  > {
    const info = response.results[0];
    const zoneID = info?.zoneID;
    const rootRecordName =
      info?.rootRecordName?.trim() || info?.rootRecord?.recordName?.trim();
    if (
      !zoneID?.zoneName?.trim() ||
      !zoneID.ownerRecordName?.trim() ||
      !rootRecordName
    )
      return err(new OAuthFailure(OAuthFailureKind.SharedLocationMissing));
    return ok({
      zoneID: {
        zoneName: zoneID.zoneName,
        ownerRecordName: zoneID.ownerRecordName,
      },
      rootRecordName,
    });
  }
  private async previewCloudKitRecord({
    container,
    shortGuid,
  }: CloudKitRecordPreviewRequest): Promise<
    Result<CloudKitRecordPreview, OAuthFailure>
  > {
    if (!container.fetchRecordInfos)
      return ok({ kind: CloudKitRecordPreviewKind.Unavailable });
    try {
      return ok({
        kind: CloudKitRecordPreviewKind.Available,
        response: await container.fetchRecordInfos([shortGuid]),
      });
    } catch {
      return err(new OAuthFailure(OAuthFailureKind.SharedConnection));
    }
  }
  private async sharedContainer(): Promise<
    Result<CloudKitContainer, OAuthFailure>
  > {
    const initialized = await this.initICloudAuth();
    if (initialized.isErr()) return err(initialized.error);
    try {
      await initNookWasm();
    } catch {
      return err(new OAuthFailure(OAuthFailureKind.InvalidConfiguration));
    }
    return cloudKitRuntime.getDefaultCloudKitContainer();
  }
  async createICloudSharedVault(
    title: string,
  ): Promise<Result<ICloudSharedStorageTarget, OAuthFailure>> {
    const admitted = await this.sharedContainer();
    if (admitted.isErr()) return err(admitted.error);
    const container = admitted.value;
    const setup =
      this.cloudKitIdentity.kind === CloudKitIdentityKind.SignedIn
        ? ok(this.cloudKitIdentity)
        : await this.setUpCloudKitAuth(container);
    if (setup.isErr()) return err(setup.error);
    const current =
      setup.value.kind === CloudKitIdentityKind.SignedIn
        ? setup
        : await this.fetchCurrentCloudKitIdentity(container);
    if (current.isErr()) return err(current.error);
    const ownerRecordNameValue =
      current.value.kind === CloudKitIdentityKind.SignedIn
        ? current.value.identity.userRecordName
        : false;
    const ownerRecordName =
      typeof ownerRecordNameValue === "string"
        ? ownerRecordNameValue.trim()
        : "";
    if (!ownerRecordName)
      return err(new OAuthFailure(OAuthFailureKind.SharedSignInRequired));
    const database = container.privateCloudDatabase;
    if (!database)
      return err(new OAuthFailure(OAuthFailureKind.SharedCreation));
    // Each remaining effect is the CloudKit SDK or Rust WASM API.
    try {
      const suffix = crypto.randomUUID();
      const zoneName = `nook-shared-${suffix}`;
      const rootRecordName = `nook-root-${suffix}`;
      await database.saveRecordZones([{ zoneName }]);
      const saved = await database.saveRecords(
        {
          recordType: "NookVault",
          recordName: rootRecordName,
          createShortGUID: true,
          fields: { content: { value: "" } },
        },
        { zoneID: zoneName },
      );
      const root = saved.records[0];
      const shortGuid = root?.shortGUID?.trim();
      if (!root || !shortGuid)
        return err(new OAuthFailure(OAuthFailureKind.SharedIdentifierMissing));
      await database.shareWithUI({
        record: root,
        zoneID: zoneName,
        shareTitle: title.trim() || "Nook",
        shareType: "com.meta-secret.nook.vault",
        supportedAccess: [CloudKitShareAccess.Private],
        supportedPermissions: [CloudKitSharePermission.ReadWrite],
      });
      return ok({
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
      });
    } catch {
      return err(new OAuthFailure(OAuthFailureKind.SharedCreation));
    }
  }
  async acceptICloudSharedVault(
    shareReference: string,
  ): Promise<Result<ICloudSharedStorageTarget, OAuthFailure>> {
    const admitted = await this.sharedContainer();
    if (admitted.isErr()) return err(admitted.error);
    const container = admitted.value;
    let encodedTarget: EncodedICloudSharedTarget = {
      kind: EncodedICloudSharedTargetKind.PlainShortGuid,
    };
    if (shareReference.trim().startsWith("icloud-share-v1:")) {
      try {
        encodedTarget = {
          kind: EncodedICloudSharedTargetKind.EncodedTarget,
          target: parse_icloud_shared_storage_target(shareReference.trim()),
        };
      } catch {
        return err(new OAuthFailure(OAuthFailureKind.SharedLinkRequired));
      }
    }
    const guid = this.normalizedICloudShortGuid(shareReference);
    if (guid.isErr()) return err(guid.error);
    const shortGuid = guid.value;
    const identity =
      this.cloudKitIdentity.kind === CloudKitIdentityKind.SignedIn
        ? ok(this.cloudKitIdentity)
        : await this.fetchCurrentCloudKitIdentity(container);
    if (identity.isErr()) return err(identity.error);
    if (
      encodedTarget.kind === EncodedICloudSharedTargetKind.EncodedTarget &&
      identity.value.kind === CloudKitIdentityKind.SignedIn &&
      identity.value.identity.userRecordName?.trim() ===
        encodedTarget.target.ownerRecordName.trim()
    ) {
      try {
        const target = encodedTarget.target;
        return ok({
          ...target,
          role: "owner",
          storageTargetId: create_icloud_shared_storage_target(
            "owner",
            target.zoneName,
            target.ownerRecordName,
            target.rootRecordName,
            target.shortGuid,
          ),
        });
      } catch {
        return err(new OAuthFailure(OAuthFailureKind.SharedConnection));
      }
    }
    if (!container.acceptShares || !container.fetchRecordInfos)
      return err(new OAuthFailure(OAuthFailureKind.SharedConnection));
    const preview = await this.previewCloudKitRecord({ container, shortGuid });
    if (preview.isErr()) return err(preview.error);
    let response: CloudKitRecordInfosResponse;
    if (
      preview.value.kind === CloudKitRecordPreviewKind.Available &&
      preview.value.response.results[0]?.participantStatus ===
        CloudKitParticipantStatus.Accepted
    )
      response = preview.value.response;
    else {
      try {
        response = await container.acceptShares([shortGuid]);
      } catch {
        return err(new OAuthFailure(OAuthFailureKind.SharedConnection));
      }
    }
    const info = this.requireCloudKitRecordInfo(response);
    if (info.isErr()) return err(info.error);
    const { zoneID, rootRecordName } = info.value;
    try {
      return ok({
        role: "participant",
        zoneName: zoneID.zoneName,
        ownerRecordName: zoneID.ownerRecordName,
        rootRecordName,
        shortGuid,
        storageTargetId: create_icloud_shared_storage_target(
          "participant",
          zoneID.zoneName,
          zoneID.ownerRecordName,
          rootRecordName,
          shortGuid,
        ),
      });
    } catch {
      return err(new OAuthFailure(OAuthFailureKind.SharedConnection));
    }
  }
  private signInOutcome(
    outcome: Result<CloudKitIdentity, OAuthFailure>,
  ): Result<CloudKitIdentity, OAuthFailure> {
    if (outcome.isErr()) {
      this.cloudKitAuthSetup = { kind: CloudKitAuthSetupKind.NotStarted };
      this.cloudKitIdentity = { kind: CloudKitIdentityKind.SignedOut };
    }
    return outcome;
  }
  private async waitForCloudKitSignIn({
    container,
    timeoutMs,
    clickSignInControl,
  }: CloudKitSignInRequest): Promise<Result<CloudKitIdentity, OAuthFailure>> {
    if (clickSignInControl && cloudKitRuntime.isBraveBrowser()) {
      return this.signInOutcome(
        (
          await cloudKitSignInBrowser.requestDirectCloudKitWebAuthToken(
            timeoutMs,
          )
        ).map(() => this.cloudKitIdentity),
      );
    }
    const wait = clickSignInControl
      ? cloudKitSignInBrowser.startStoredWebAuthTokenWait(timeoutMs)
      : cloudKitSignInBrowser.startNativeCloudKitWebAuthTokenWait(timeoutMs);
    let residency = CloudKitSignInResidency.Active;
    let expectedFailure = false;
    const signIn = (async (): Promise<
      Result<CloudKitIdentity, OAuthFailure>
    > => {
      try {
        const userIdentity = await container.whenUserSignsIn();
        const identity: CloudKitIdentity = {
          kind: CloudKitIdentityKind.SignedIn,
          identity: userIdentity,
        };
        if (residency === CloudKitSignInResidency.Active)
          this.cloudKitIdentity = identity;
        return ok(identity);
      } catch (error) {
        if (
          !clickSignInControl ||
          new CloudKitSetupFailure({
            error,
            hasSignInControl: this.hasCloudKitSignInControl(),
          }).expected
        ) {
          expectedFailure = true;
          return ok({ kind: CloudKitIdentityKind.SignedOut });
        }
        return err(new OAuthFailure(OAuthFailureKind.CloudKitAuthentication));
      }
    })();
    try {
      if (clickSignInControl) {
        const clicked = this.clickCloudKitSignInButton();
        if (clicked.isErr()) return this.signInOutcome(err(clicked.error));
      }
      const first = await Promise.race([wait.completion, signIn]);
      if (first.isErr()) return this.signInOutcome(err(first.error));
      const immediate = cloudKitSignInBrowser.readStoredWebAuthToken();
      if (immediate.isErr()) return this.signInOutcome(err(immediate.error));
      if (immediate.value.kind === WebAuthTokenLookupKind.Available)
        return ok(this.cloudKitIdentity);
      if (expectedFailure && clickSignInControl) {
        wait.cancel();
        return this.signInOutcome(
          (
            await cloudKitSignInBrowser.requestDirectCloudKitWebAuthToken(
              timeoutMs,
            )
          ).map(() => this.cloudKitIdentity),
        );
      }
      return this.signInOutcome(
        (await wait.completion).map(() => this.cloudKitIdentity),
      );
    } finally {
      residency = CloudKitSignInResidency.Released;
      wait.cancel();
    }
  }
  async requestPreparedICloudWebAuthToken(
    request: ICloudWebAuthTokenRequest,
  ): Promise<Result<ICloudOAuthTokens, OAuthFailure>> {
    if (
      !window.CloudKit ||
      this.cloudKitAuthSetup.kind === CloudKitAuthSetupKind.NotStarted
    )
      return err(new OAuthFailure(OAuthFailureKind.ControlUnavailable));
    if (this.cloudKitIdentity.kind === CloudKitIdentityKind.SignedIn)
      return this.requireStoredWebAuthToken();
    const container = cloudKitRuntime.getDefaultCloudKitContainer();
    if (container.isErr()) return err(container.error);
    const identity = await this.waitForCloudKitSignIn({
      container: container.value,
      timeoutMs: request.signInTimeoutMs,
      clickSignInControl: request.clickSignInControl,
    });
    return identity.andThen((value) => this.requireStoredWebAuthToken(value));
  }
  async requestICloudWebAuthToken(
    request: ICloudWebAuthTokenRequest,
  ): Promise<Result<ICloudOAuthTokens, OAuthFailure>> {
    const initialized = await this.initICloudAuth();
    if (initialized.isErr()) return err(initialized.error);
    const container = cloudKitRuntime.getDefaultCloudKitContainer();
    if (container.isErr()) return err(container.error);
    const identity = await this.setUpCloudKitAuth(container.value);
    if (identity.isErr()) return err(identity.error);
    const stored = cloudKitSignInBrowser.readStoredWebAuthToken();
    if (stored.isErr()) return err(stored.error);
    if (
      identity.value.kind === CloudKitIdentityKind.SignedOut &&
      stored.value.kind === WebAuthTokenLookupKind.Unavailable
    ) {
      const signedIn = await this.waitForCloudKitSignIn({
        container: container.value,
        timeoutMs: request.signInTimeoutMs,
        clickSignInControl: request.clickSignInControl,
      });
      if (signedIn.isErr()) return err(signedIn.error);
    }
    return this.requireStoredWebAuthToken();
  }
  oauthTokensToICloudConfig({
    tokens,
    existing,
  }: ICloudOAuthConfigurationUpdate): Result<OAuthFileConfig, OAuthFailure> {
    try {
      return ok(
        icloud_oauth_tokens_to_config(
          tokens.accessToken,
          tokens.accountName.kind === ICloudAccountNameKind.Available
            ? storedOAuthAccountEmail(tokens.accountName.value)
            : unknownOAuthAccountIdentity(),
          existing,
        ),
      );
    } catch {
      return err(new OAuthFailure(OAuthFailureKind.InvalidConfiguration));
    }
  }
  async ensureValidICloudOAuthFileConfig(
    config: OAuthFileConfig,
  ): Promise<Result<OAuthFileConfig, OAuthFailure>> {
    if (oauth_access_token(config).kind === OAuthAccessTokenKind.Available)
      return ok(config);
    const refreshed = await this.requestICloudWebAuthToken({
      signInTimeoutMs: ICLOUD_SIGN_IN_TIMEOUT_MS,
      clickSignInControl: true,
    });
    return refreshed.andThen((tokens) =>
      this.oauthTokensToICloudConfig({
        tokens,
        existing: configuredOAuthFile(config),
      }),
    );
  }
}
export const iCloudOAuthSession = new ICloudOAuthSession();
