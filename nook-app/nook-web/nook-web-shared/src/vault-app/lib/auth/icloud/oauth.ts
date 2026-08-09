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
} from "$lib/auth/icloud/config";
import { createLogger } from "$lib/runtime/log";
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
  cloudKitSignInControlDiagnostics,
  currentBrowserDiagnostics,
  iCloudConfigDiagnostics,
  getDefaultCloudKitContainer,
  isBraveBrowser,
  loadCloudKitScript,
  tokenDiagnostics,
  WebAuthTokenLookupKind,
  webAuthTokenListeners,
  webAuthTokenStorageDiagnostics,
  type CloudKitContainer,
  type CloudKitAuthErrorDetails,
  type CloudKitConfiguration,
  type CloudKitRecordInfo,
  type CloudKitRecordInfosResponse,
  type CloudKitUserIdentity,
} from "$lib/auth/icloud/cloudkit-runtime";
import {
  cloudKitAuthErrorDetails,
  cloudKitAuthErrorTranslationKey,
  isExpectedCloudKitSignInSetupFailure,
} from "$lib/auth/icloud/auth-errors";
import {
  CloudKitAuthSetupKind,
  CloudKitIdentityKind,
  CloudKitInitializationKind,
  iCloudAccountNameFromIdentity,
  ICloudAccountNameKind,
  type CloudKitAuthSetup,
  type CloudKitIdentity,
  type CloudKitInitialization,
  type ICloudAccountName,
} from "$lib/auth/icloud/auth-state";
import {
  ICLOUD_SIGN_IN_TIMEOUT_MS,
  readStoredWebAuthToken,
  requestDirectCloudKitWebAuthToken,
  waitForNativeCloudKitWebAuthToken,
  waitForStoredWebAuthToken,
} from "$lib/auth/icloud/web-auth-wait";
export {
  ICloudAccountNameKind,
  type ICloudAccountName,
} from "$lib/auth/icloud/auth-state";
export { ICLOUD_SIGN_IN_TIMEOUT_MS } from "$lib/auth/icloud/web-auth-wait";

const log = createLogger("icloud-oauth");

export type ICloudOAuthTokens = {
  accessToken: string;
  accountName: ICloudAccountName;
};

type ICloudWebAuthTokenRequestOptions = {
  signInTimeoutMs?: number;
  clickSignInControl?: boolean;
};

let cloudKitInitialization: CloudKitInitialization = {
  kind: CloudKitInitializationKind.NotStarted,
};
let cloudKitAuthSetup: CloudKitAuthSetup = {
  kind: CloudKitAuthSetupKind.NotStarted,
};
let cloudKitIdentity: CloudKitIdentity = {
  kind: CloudKitIdentityKind.SignedOut,
};

function currentAuthSetup(): CloudKitAuthSetup {
  return cloudKitAuthSetup;
}

function currentCloudKitIdentity(): CloudKitIdentity {
  return cloudKitIdentity;
}

function cloudKitIdentityFromExternal(
  identity: CloudKitUserIdentity,
): CloudKitIdentity {
  return {
    kind: CloudKitIdentityKind.SignedIn,
    identity,
  };
}

async function fetchCurrentCloudKitIdentity(
  container: CloudKitContainer,
): Promise<CloudKitIdentity> {
  if (!container.fetchCurrentUserIdentity) {
    return { kind: CloudKitIdentityKind.SignedOut };
  }
  return cloudKitIdentityFromExternal(
    await container.fetchCurrentUserIdentity(),
  );
}

function rememberCloudKitIdentity(identity: CloudKitIdentity): void {
  cloudKitIdentity = identity;
}

/** @internal Clears module singletons between unit tests. */
export function resetICloudAuthStateForTests(): void {
  cloudKitInitialization = {
    kind: CloudKitInitializationKind.NotStarted,
  };
  cloudKitAuthSetup = { kind: CloudKitAuthSetupKind.NotStarted };
  cloudKitIdentity = { kind: CloudKitIdentityKind.SignedOut };
  webAuthTokenListeners.clear();
}

export function isICloudOAuthConfigured(): boolean {
  return Boolean(
    ICLOUD_CONTAINER_ID.trim() &&
    ICLOUD_API_TOKEN.trim() &&
    ICLOUD_CONTAINER_ID.startsWith("iCloud."),
  );
}

function hasCloudKitSignInControl(): boolean {
  return (
    "document" in globalThis &&
    Boolean(document.getElementById(CLOUDKIT_SIGN_IN_BUTTON_ID))
  );
}

function logCloudKitAuthFailure({
  message,
  details,
}: {
  readonly message: string;
  readonly details: CloudKitAuthErrorDetails;
}): void {
  const warnArgs = {
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
  };
  log.warn(message + " " + JSON.stringify(warnArgs));
}

export async function initICloudAuth(): Promise<void> {
  if (cloudKitInitialization.kind === CloudKitInitializationKind.Initializing) {
    log.info("CloudKit auth init reused existing promise");
    return cloudKitInitialization.completion;
  }
  const operation = (async () => {
    const infoArgs = {
      config: iCloudConfigDiagnostics(),
      browser: currentBrowserDiagnostics(),
    };
    log.info("CloudKit auth init started" + " " + JSON.stringify(infoArgs));
    await loadCloudKitScript();
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
    const infoArgs2 = {
      config: iCloudConfigDiagnostics(),
      hasCloudKitGlobal: Boolean(window.CloudKit),
    };
    log.info("CloudKit auth configured" + " " + JSON.stringify(infoArgs2));
  })();
  cloudKitInitialization = {
    kind: CloudKitInitializationKind.Initializing,
    completion: operation,
  };
  return operation;
}

function setUpCloudKitAuth(
  container: CloudKitContainer,
): Promise<CloudKitIdentity> {
  const existingSetup = currentAuthSetup();
  if (existingSetup.kind === CloudKitAuthSetupKind.Initializing) {
    log.info("CloudKit setUpAuth reused existing promise");
    return existingSetup.completion;
  }
  const infoArgs3 = {
    grabAuthToken: true,
    persist: true,
    hasSignInMount: hasCloudKitSignInControl(),
    control: cloudKitSignInControlDiagnostics(),
  };
  log.info("CloudKit setUpAuth started" + " " + JSON.stringify(infoArgs3));
  const operation = (() => {
    const setUpAuthArgs: Parameters<typeof container.setUpAuth>[0] = {
      grabAuthToken: true,
      persist: true,
    };
    return container.setUpAuth(setUpAuthArgs);
  })()
    .then((identity) => {
      rememberCloudKitIdentity(identity);
      const infoArgs4 = {
        signedIn: identity.kind === CloudKitIdentityKind.SignedIn,
        token: tokenDiagnostics(readStoredWebAuthToken()),
        storage: webAuthTokenStorageDiagnostics(),
        control: cloudKitSignInControlDiagnostics(),
      };
      log.info(
        "CloudKit setUpAuth completed" + " " + JSON.stringify(infoArgs4),
      );
      return identity;
    })
    .catch((error) => {
      const expectedFailureArgs: Parameters<
        typeof isExpectedCloudKitSignInSetupFailure
      >[0] = {
        error,
        hasSignInControl: hasCloudKitSignInControl(),
      };
      if (isExpectedCloudKitSignInSetupFailure(expectedFailureArgs)) {
        const infoArgs5 = {
          details: cloudKitAuthErrorDetails(error),
          hasSignInMount: hasCloudKitSignInControl(),
          storage: webAuthTokenStorageDiagnostics(),
          control: cloudKitSignInControlDiagnostics(),
        };
        log.info(
          "CloudKit auth setup waiting for Apple sign-in" +
            " " +
            JSON.stringify(infoArgs5),
        );
        const identity: CloudKitIdentity = {
          kind: CloudKitIdentityKind.SignedOut,
        };
        cloudKitIdentity = identity;
        return identity;
      }
      cloudKitAuthSetup = { kind: CloudKitAuthSetupKind.NotStarted };
      cloudKitIdentity = { kind: CloudKitIdentityKind.SignedOut };
      throw error;
    });
  cloudKitAuthSetup = {
    kind: CloudKitAuthSetupKind.Initializing,
    completion: operation,
  };
  return operation;
}

export async function prepareICloudSignInControl(): Promise<void> {
  log.info("CloudKit sign-in control prepare started");
  await initICloudAuth();
  const container = getDefaultCloudKitContainer();
  const mount = document.getElementById(CLOUDKIT_SIGN_IN_BUTTON_ID);
  const existingControl = mount?.querySelector(
    'button, [role="button"], iframe, a, .apple-auth-button',
  );
  const authSetup = currentAuthSetup();
  const identity = currentCloudKitIdentity();
  if (
    authSetup.kind === CloudKitAuthSetupKind.Initializing &&
    identity.kind === CloudKitIdentityKind.SignedOut &&
    readStoredWebAuthToken().kind === WebAuthTokenLookupKind.Unavailable &&
    !existingControl
  ) {
    cloudKitAuthSetup = { kind: CloudKitAuthSetupKind.NotStarted };
  }
  try {
    await setUpCloudKitAuth(container);
    const infoArgs6 = {
      hasSignInMount: hasCloudKitSignInControl(),
      token: tokenDiagnostics(readStoredWebAuthToken()),
      storage: webAuthTokenStorageDiagnostics(),
      control: cloudKitSignInControlDiagnostics(),
    };
    log.info(
      "CloudKit sign-in control ready" + " " + JSON.stringify(infoArgs6),
    );
  } catch (error) {
    const logCloudKitAuthFailureArgs: Parameters<
      typeof logCloudKitAuthFailure
    >[0] = {
      message: "CloudKit auth setup failed",
      details: cloudKitAuthErrorDetails(error),
    };
    logCloudKitAuthFailure(logCloudKitAuthFailureArgs);
    const ErrorArgs: ConstructorParameters<typeof Error>[1] = { cause: error };
    throw new Error(cloudKitAuthErrorTranslationKey(error), ErrorArgs);
  }
}

function clickCloudKitSignInButton(): void {
  const mount = document.getElementById(CLOUDKIT_SIGN_IN_BUTTON_ID);
  const control =
    mount?.querySelector<HTMLElement>(
      'button, [role="button"], iframe, a, .apple-auth-button',
    ) ?? mount;
  if (!control) {
    const warnArgs2 = {
      hasMount: Boolean(mount),
    };
    log.warn(
      "CloudKit sign-in control click failed: control missing " +
        JSON.stringify(warnArgs2),
    );
    throw new Error(
      "Apple sign-in control is not ready. Reload and try again.",
    );
  }
  const infoArgs7 = {
    mountTag: mount?.tagName,
    controlTag: control.tagName,
    controlRole: control.getAttribute("role")?.valueOf(),
    control: cloudKitSignInControlDiagnostics(),
  };
  log.info(
    "CloudKit sign-in control click forwarded" +
      " " +
      JSON.stringify(infoArgs7),
  );
  control.click();
}

function requireStoredWebAuthToken(
  identity = currentCloudKitIdentity(),
): ICloudOAuthTokens {
  const token = readStoredWebAuthToken();
  if (token.kind === WebAuthTokenLookupKind.Unavailable) {
    throw new Error("iCloud sign-in did not return a web auth token.");
  }
  const accountName = iCloudAccountNameFromIdentity(identity);
  return {
    accessToken: token.token,
    accountName,
  };
}

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

function normalizedICloudShortGuid(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(I18N_KEYS.ProviderSetupIcloudSharedLinkRequired);
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
    throw new Error(I18N_KEYS.ProviderSetupIcloudSharedLocationMissing);
  }
  return { zoneID, rootRecordName };
}

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

async function previewCloudKitRecord({
  container,
  shortGuid,
}: {
  readonly container: CloudKitContainer;
  readonly shortGuid: string;
}): Promise<CloudKitRecordPreview> {
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

/** Create a shareable CloudKit root hierarchy in the owner's private DB. */
export async function createICloudSharedVault(
  title: string,
): Promise<ICloudSharedStorageTarget> {
  await initICloudAuth();
  await initNookWasm();
  const container = getDefaultCloudKitContainer();
  const currentIdentity = currentCloudKitIdentity();
  const setupIdentity =
    currentIdentity.kind === CloudKitIdentityKind.SignedIn
      ? currentIdentity
      : await setUpCloudKitAuth(container);
  const identity =
    setupIdentity.kind === CloudKitIdentityKind.SignedIn
      ? setupIdentity
      : await fetchCurrentCloudKitIdentity(container);
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
  const container = getDefaultCloudKitContainer();
  const encodedTarget: EncodedICloudSharedTarget = shareReference
    .trim()
    .startsWith("icloud-share-v1:")
    ? {
        kind: EncodedICloudSharedTargetKind.EncodedTarget,
        target: parseICloudSharedStorageTarget(shareReference.trim()),
      }
    : { kind: EncodedICloudSharedTargetKind.PlainShortGuid };
  const shortGuid = normalizedICloudShortGuid(shareReference);
  const currentIdentity = currentCloudKitIdentity();
  const identity =
    currentIdentity.kind === CloudKitIdentityKind.SignedIn
      ? currentIdentity
      : await fetchCurrentCloudKitIdentity(container);
  if (
    encodedTarget.kind === EncodedICloudSharedTargetKind.EncodedTarget &&
    identity.kind === CloudKitIdentityKind.SignedIn &&
    identity.identity.userRecordName?.trim() ===
      encodedTarget.target.ownerRecordName.trim()
  ) {
    const storageTargetId = createICloudSharedStorageTarget(
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
  const previewCloudKitRecordArgs: Parameters<typeof previewCloudKitRecord>[0] =
    { container, shortGuid };
  const current = await previewCloudKitRecord(previewCloudKitRecordArgs);
  const response =
    current.kind === CloudKitRecordPreviewKind.Available &&
    current.response.results[0]?.participantStatus ===
      CloudKitParticipantStatus.Accepted
      ? current.response
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

async function waitForCloudKitSignIn({
  container,
  timeoutMs,
  options,
}: {
  readonly container: CloudKitContainer;
  readonly timeoutMs: number;
  readonly options: Pick<
    ICloudWebAuthTokenRequestOptions,
    "clickSignInControl"
  >;
}): Promise<CloudKitIdentity> {
  const shouldClickSignInControl = options.clickSignInControl !== false;
  const useDirectAuthWithoutNativeClick =
    shouldClickSignInControl && isBraveBrowser();
  const infoArgs8 = {
    timeoutMs,
    clickSignInControl: shouldClickSignInControl,
    directAuthWithoutNativeClick: useDirectAuthWithoutNativeClick,
    tokenBeforeWait: tokenDiagnostics(readStoredWebAuthToken()),
    storage: webAuthTokenStorageDiagnostics(),
    control: cloudKitSignInControlDiagnostics(),
  };
  log.info("CloudKit sign-in wait started" + " " + JSON.stringify(infoArgs8));
  if (useDirectAuthWithoutNativeClick) {
    await requestDirectCloudKitWebAuthToken(timeoutMs);
    const infoArgs9 = {
      token: tokenDiagnostics(readStoredWebAuthToken()),
    };
    log.info(
      "CloudKit sign-in succeeded through direct primary auth " +
        JSON.stringify(infoArgs9),
    );
    return currentCloudKitIdentity();
  }
  const tokenPromise = shouldClickSignInControl
    ? waitForStoredWebAuthToken(timeoutMs)
    : waitForNativeCloudKitWebAuthToken(timeoutMs);
  let sawExpectedSignInFailure = false;
  const signInPromise = container
    .whenUserSignsIn()
    .then((userIdentity) => {
      const identity = cloudKitIdentityFromExternal(userIdentity);
      rememberCloudKitIdentity(identity);
      const infoArgs10 = {
        signedIn: identity.kind === CloudKitIdentityKind.SignedIn,
        token: tokenDiagnostics(readStoredWebAuthToken()),
        storage: webAuthTokenStorageDiagnostics(),
      };
      log.info(
        "CloudKit whenUserSignsIn resolved" + " " + JSON.stringify(infoArgs10),
      );
      return identity;
    })
    .catch((error) => {
      const expectedFailureArgs2: Parameters<
        typeof isExpectedCloudKitSignInSetupFailure
      >[0] = {
        error,
        hasSignInControl: hasCloudKitSignInControl(),
      };
      if (isExpectedCloudKitSignInSetupFailure(expectedFailureArgs2)) {
        sawExpectedSignInFailure = true;
        const infoArgs11 = {
          details: cloudKitAuthErrorDetails(error),
          hasSignInMount: hasCloudKitSignInControl(),
          storage: webAuthTokenStorageDiagnostics(),
          control: cloudKitSignInControlDiagnostics(),
        };
        log.info(
          "CloudKit sign-in callback waiting for web auth token " +
            JSON.stringify(infoArgs11),
        );
        return { kind: CloudKitIdentityKind.SignedOut } as CloudKitIdentity;
      }
      // Native Apple UI may still finish after CloudKit rejects the callback.
      // Keep waiting for the token instead of failing while the popup is open.
      if (!shouldClickSignInControl) {
        sawExpectedSignInFailure = true;
        const infoArgs12 = {
          details: cloudKitAuthErrorDetails(error),
          storage: webAuthTokenStorageDiagnostics(),
          control: cloudKitSignInControlDiagnostics(),
        };
        log.info(
          "CloudKit sign-in callback failed during native click; waiting for token " +
            JSON.stringify(infoArgs12),
        );
        return { kind: CloudKitIdentityKind.SignedOut } as CloudKitIdentity;
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
    if (immediateToken.kind === WebAuthTokenLookupKind.Available) {
      const infoArgs13 = {
        signedIn:
          currentCloudKitIdentity().kind === CloudKitIdentityKind.SignedIn,
        token: tokenDiagnostics(immediateToken),
      };
      log.info(
        "CloudKit sign-in succeeded with immediate token" +
          " " +
          JSON.stringify(infoArgs13),
      );
      return currentCloudKitIdentity();
    }
    if (sawExpectedSignInFailure && shouldClickSignInControl) {
      // Only open the direct Web Services window when we still own the click.
      // After a native CloudKit button click the Apple window is already open;
      // a second window.open is blocked on Brave and fails the flow immediately.
      await requestDirectCloudKitWebAuthToken(timeoutMs);
      const infoArgs14 = {
        token: tokenDiagnostics(readStoredWebAuthToken()),
      };
      log.info(
        "CloudKit sign-in succeeded through direct fallback " +
          JSON.stringify(infoArgs14),
      );
      return currentCloudKitIdentity();
    }
    await tokenPromise;
    const infoArgs15 = {
      signedIn:
        currentCloudKitIdentity().kind === CloudKitIdentityKind.SignedIn,
      token: tokenDiagnostics(readStoredWebAuthToken()),
    };
    log.info(
      "CloudKit sign-in succeeded after token wait" +
        " " +
        JSON.stringify(infoArgs15),
    );
    return currentCloudKitIdentity();
  } catch (error) {
    // Allow a fresh setUpAuth attempt on the next user interaction so
    // retries do not reuse a stale cached promise.
    cloudKitAuthSetup = { kind: CloudKitAuthSetupKind.NotStarted };
    cloudKitIdentity = { kind: CloudKitIdentityKind.SignedOut };
    const logCloudKitAuthFailureArgs2: Parameters<
      typeof logCloudKitAuthFailure
    >[0] = {
      message: "CloudKit sign-in failed",
      details: cloudKitAuthErrorDetails(error),
    };
    logCloudKitAuthFailure(logCloudKitAuthFailureArgs2);
    const ErrorArgs2: ConstructorParameters<typeof Error>[1] = { cause: error };
    throw new Error(cloudKitAuthErrorTranslationKey(error), ErrorArgs2);
  }
}

export function requestPreparedICloudWebAuthToken(
  options: ICloudWebAuthTokenRequestOptions = {},
): Promise<ICloudOAuthTokens> {
  const infoArgs16 = {
    hasCloudKitGlobal: Boolean(window.CloudKit),
    hasAuthSetupPromise:
      currentAuthSetup().kind === CloudKitAuthSetupKind.Initializing,
    hasAuthSetupUserIdentity:
      currentCloudKitIdentity().kind === CloudKitIdentityKind.SignedIn,
    clickSignInControl: options.clickSignInControl !== false,
  };
  log.info(
    "CloudKit prepared token request started" +
      " " +
      JSON.stringify(infoArgs16),
  );
  if (
    !window.CloudKit ||
    currentAuthSetup().kind === CloudKitAuthSetupKind.NotStarted
  ) {
    return Promise.reject(
      new Error(
        "Apple sign-in control is still loading. Try again in a moment.",
      ),
    );
  }
  if (currentCloudKitIdentity().kind === CloudKitIdentityKind.SignedIn) {
    log.info("CloudKit prepared token request using existing identity");
    return Promise.resolve(requireStoredWebAuthToken());
  }
  const container = getDefaultCloudKitContainer();
  const waitForCloudKitSignInArgs: Parameters<typeof waitForCloudKitSignIn>[0] =
    {
      container,
      timeoutMs: options.signInTimeoutMs ?? ICLOUD_SIGN_IN_TIMEOUT_MS,
      options,
    };
  return waitForCloudKitSignIn(waitForCloudKitSignInArgs).then((identity) =>
    requireStoredWebAuthToken(identity),
  );
}

export async function requestICloudWebAuthToken(
  options: ICloudWebAuthTokenRequestOptions = {},
): Promise<ICloudOAuthTokens> {
  log.info("CloudKit direct token request started");
  await initICloudAuth();
  const container = getDefaultCloudKitContainer();
  const identity = await setUpCloudKitAuth(container).catch((error) => {
    const logCloudKitAuthFailureArgs3: Parameters<
      typeof logCloudKitAuthFailure
    >[0] = {
      message: "CloudKit auth setup failed",
      details: cloudKitAuthErrorDetails(error),
    };
    logCloudKitAuthFailure(logCloudKitAuthFailureArgs3);
    const ErrorArgs3: ConstructorParameters<typeof Error>[1] = { cause: error };
    throw new Error(cloudKitAuthErrorTranslationKey(error), ErrorArgs3);
  });

  if (
    identity.kind === CloudKitIdentityKind.SignedOut &&
    readStoredWebAuthToken().kind === WebAuthTokenLookupKind.Available
  ) {
    log.info("CloudKit direct token request reused stored token");
    return requireStoredWebAuthToken();
  }

  if (identity.kind === CloudKitIdentityKind.SignedOut) {
    const waitForCloudKitSignInArgs2: Parameters<
      typeof waitForCloudKitSignIn
    >[0] = {
      container,
      timeoutMs: options.signInTimeoutMs ?? ICLOUD_SIGN_IN_TIMEOUT_MS,
      options,
    };
    await waitForCloudKitSignIn(waitForCloudKitSignInArgs2);
  }

  const infoArgs17 = {
    token: tokenDiagnostics(readStoredWebAuthToken()),
  };
  log.info(
    "CloudKit direct token request returning token" +
      " " +
      JSON.stringify(infoArgs17),
  );
  return requireStoredWebAuthToken();
}

export function oauthTokensToICloudConfig({
  tokens,
  existing,
}: {
  readonly tokens: ICloudOAuthTokens;
  readonly existing: StoredOAuthFileConfiguration;
}): OAuthFileConfig {
  return iCloudOAuthTokensToConfigCore(
    tokens.accessToken,
    tokens.accountName.kind === ICloudAccountNameKind.Available
      ? storedOAuthAccountEmail(tokens.accountName.value)
      : unknownOAuthAccountIdentity(),
    existing,
  );
}

export async function ensureValidICloudOAuthFileConfig(
  config: OAuthFileConfig,
): Promise<OAuthFileConfig> {
  if (oauthAccessToken(config).kind === OAuthAccessTokenKind.Available) {
    return config;
  }
  const refreshed = await requestICloudWebAuthToken();
  const oauthTokensToICloudConfigArgs: Parameters<
    typeof oauthTokensToICloudConfig
  >[0] = { tokens: refreshed, existing: configuredOAuthFile(config) };
  return oauthTokensToICloudConfig(oauthTokensToICloudConfigArgs);
}
