import { stripBasePath } from "$lib/runtime/routes";
import type { NookVaultManager } from "$app-wasm";
import {
  ExtensionPairedVaultIdentityDiscoveryMessageType,
  ExtensionPairedVaultIdentityHandoffRequestMessageType,
  ExtensionPairedVaultIdentityStatusMessageStatus,
  ExtensionPairedVaultUnlockRequestMessageType,
  ExtensionIdentityHandoffRequestMessageType,
  OpenCompanionLauncherMessageType,
  isExtensionPairedVaultIdentityStatusMessage,
  type ExtensionIdentityHandoffRequestMessage,
  type ExtensionPairedVaultIdentityDiscoveryMessage,
  type ExtensionPairedVaultIdentityHandoffRequestMessage,
  type ExtensionPairedVaultUnlockRequestMessage,
  type OpenCompanionLauncherMessage,
} from "$web-shared/extension/runtime-messages";
import {
  ExtensionIdentityRequestSource,
  type ExtensionConnectRequestFor,
  type PairedExtensionIdentityDiscoveryFor,
} from "$web-shared/extension/extension-connect-types";
import { ExtensionConnectScope } from "$web-shared/extension/extension-connect-scope";

export const EXTENSION_CONNECT_PATH = "/extension-connect";

export { ExtensionConnectScope, ExtensionIdentityRequestSource };

export type ExtensionConnectRequest =
  ExtensionConnectRequestFor<ExtensionConnectScope>;
export type PairedExtensionIdentityDiscovery =
  PairedExtensionIdentityDiscoveryFor<ExtensionConnectRequest>;

export type AdoptExtensionIdentityArgs = {
  manager: NookVaultManager;
  request: ExtensionConnectRequest;
};

export enum ExtensionConnectRequestStateKind {
  Absent = "absent",
  Requested = "requested",
}

export type ExtensionConnectRequestState =
  | { kind: ExtensionConnectRequestStateKind.Absent }
  | {
      kind: ExtensionConnectRequestStateKind.Requested;
      request: ExtensionConnectRequest;
    };

export enum InstalledExtensionRuntimeKind {
  NotInstalled = "not-installed",
  Installed = "installed",
}

export type InstalledExtensionRuntime =
  | { kind: InstalledExtensionRuntimeKind.NotInstalled }
  | {
      kind: InstalledExtensionRuntimeKind.Installed;
      extensionRuntimeId: string;
    };

const validScopes = new Set<ExtensionConnectScope>([
  ExtensionConnectScope.VaultAccess,
  ExtensionConnectScope.PasswordFilling,
  ExtensionConnectScope.PasskeyManagement,
  ExtensionConnectScope.SyncProviderCredentials,
]);
const extensionRuntimeIdAttribute = "data-nook-extension-runtime-id";
const EXTENSION_MESSAGE_TIMEOUT_MS = 5_000;

export function isExtensionConnectPath(pathname: string): boolean {
  const normalized = stripBasePath(pathname).replace(/\/$/, "") || "/";
  return normalized === EXTENSION_CONNECT_PATH;
}

function parseScopes(params: URLSearchParams): ExtensionConnectScope[] {
  const raw = params.get("scopes");
  const scopes = (raw ?? "")
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);

  return scopes.filter((scope): scope is ExtensionConnectScope =>
    validScopes.has(scope as ExtensionConnectScope),
  );
}

export function extensionConnectRequestFromLocation(
  location: Location,
): ExtensionConnectRequestState {
  if (!isExtensionConnectPath(location.pathname)) {
    return { kind: ExtensionConnectRequestStateKind.Absent };
  }

  const params = new URLSearchParams(location.search);
  const deviceId = params.get("device_id")?.trim() ?? "";
  const devicePublicKey = params.get("device_public_key")?.trim() ?? "";
  const deviceSigningPublicKey =
    params.get("device_signing_public_key")?.trim() ?? "";
  const extensionRuntimeId = params.get("extension_id")?.trim() ?? "";
  const deviceLabel =
    params.get("device_label")?.trim() ??
    "Nook Extension - this browser profile";
  const nonce = params.get("nonce")?.trim() ?? "";
  const scopes = parseScopes(params);

  if (
    !deviceId ||
    !devicePublicKey ||
    !deviceSigningPublicKey ||
    !extensionRuntimeId ||
    !nonce ||
    scopes.length === 0
  ) {
    return { kind: ExtensionConnectRequestStateKind.Absent };
  }

  return {
    kind: ExtensionConnectRequestStateKind.Requested,
    request: {
      source: ExtensionIdentityRequestSource.ExtensionConnect,
      deviceId,
      devicePublicKey,
      deviceSigningPublicKey,
      extensionRuntimeId,
      deviceLabel,
      nonce,
      scopes,
    },
  };
}

function requestId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

enum ExtensionMessageDeliveryKind {
  Unavailable = "unavailable",
  Received = "received",
}

type ExtensionMessageDelivery =
  | { kind: ExtensionMessageDeliveryKind.Unavailable }
  | { kind: ExtensionMessageDeliveryKind.Received; response: unknown };

export function readInstalledExtensionRuntimeId(): InstalledExtensionRuntime {
  const extensionRuntimeId = document.documentElement
    .getAttribute(extensionRuntimeIdAttribute)
    ?.trim();
  return extensionRuntimeId
    ? { kind: InstalledExtensionRuntimeKind.Installed, extensionRuntimeId }
    : { kind: InstalledExtensionRuntimeKind.NotInstalled };
}

function sendExtensionMessage(
  extensionId: string,
  message: unknown,
): Promise<ExtensionMessageDelivery> {
  return new Promise((resolve) => {
    const runtime = (
      globalThis as typeof globalThis & {
        chrome?: {
          runtime?: {
            sendMessage?: (
              extensionId: string,
              message: unknown,
              callback: (response?: unknown) => void,
            ) => void;
            lastError?: { message?: string };
          };
        };
      }
    ).chrome?.runtime;
    if (!runtime?.sendMessage) {
      resolve({ kind: ExtensionMessageDeliveryKind.Unavailable });
      return;
    }

    let settled = false;
    const finishUnavailable = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve({ kind: ExtensionMessageDeliveryKind.Unavailable });
    };
    const finishReceived = (response: unknown) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve({ kind: ExtensionMessageDeliveryKind.Received, response });
    };
    const timer = window.setTimeout(
      finishUnavailable,
      EXTENSION_MESSAGE_TIMEOUT_MS,
    );
    runtime.sendMessage(extensionId, message, (...responses) => {
      if (runtime.lastError?.message) {
        finishUnavailable();
        return;
      }
      if (responses.length === 0) {
        finishUnavailable();
        return;
      }
      finishReceived(responses[0]);
    });
  });
}

export async function openInstalledExtension(): Promise<boolean> {
  const installedExtension = readInstalledExtensionRuntimeId();
  if (installedExtension.kind === InstalledExtensionRuntimeKind.NotInstalled) {
    return false;
  }

  const message: OpenCompanionLauncherMessage = {
    type: OpenCompanionLauncherMessageType.NookOpenCompanionLauncher,
    payload: { intent: "pair" },
  };
  const delivery = await sendExtensionMessage(
    installedExtension.extensionRuntimeId,
    message,
  );
  if (delivery.kind !== ExtensionMessageDeliveryKind.Received) return false;
  const response = delivery.response;
  return (
    !!response &&
    typeof response === "object" &&
    "ok" in response &&
    response.ok === true
  );
}

async function discoverPairedExtensionIdentityOnce(
  vaultStoreId: string,
): Promise<
  | { kind: ExtensionMessageDeliveryKind.Unavailable }
  | {
      kind: ExtensionMessageDeliveryKind.Received;
      discovery: PairedExtensionIdentityDiscovery;
    }
> {
  const installedExtension = readInstalledExtensionRuntimeId();
  if (installedExtension.kind === InstalledExtensionRuntimeKind.NotInstalled) {
    return { kind: ExtensionMessageDeliveryKind.Unavailable };
  }

  const discoveryRequestId = requestId();
  const message: ExtensionPairedVaultIdentityDiscoveryMessage = {
    type: ExtensionPairedVaultIdentityDiscoveryMessageType.NookExtensionPairedVaultIdentityDiscovery,
    payload: {
      requestId: discoveryRequestId,
      vaultStoreId,
      expiresAt: Date.now() + EXTENSION_MESSAGE_TIMEOUT_MS,
    },
  };

  const delivery = await sendExtensionMessage(
    installedExtension.extensionRuntimeId,
    message,
  );
  if (delivery.kind !== ExtensionMessageDeliveryKind.Received) return delivery;
  const statusMessage = delivery.response;
  if (
    !isExtensionPairedVaultIdentityStatusMessage(statusMessage) ||
    statusMessage.payload.requestId !== discoveryRequestId ||
    statusMessage.payload.vaultStoreId !== vaultStoreId
  ) {
    return { kind: ExtensionMessageDeliveryKind.Unavailable };
  }
  if (
    statusMessage.payload.status !==
    ExtensionPairedVaultIdentityStatusMessageStatus.Unlocked
  ) {
    if (
      statusMessage.payload.status ===
      ExtensionPairedVaultIdentityStatusMessageStatus.DifferentVault
    ) {
      return {
        kind: ExtensionMessageDeliveryKind.Received,
        discovery: {
          status:
            ExtensionPairedVaultIdentityStatusMessageStatus.DifferentVault,
          connectedVaultStoreId: statusMessage.payload.connectedVaultStoreId,
          connectedVaultName: statusMessage.payload.connectedVaultName,
        },
      };
    }
    return {
      kind: ExtensionMessageDeliveryKind.Received,
      discovery: { status: statusMessage.payload.status },
    };
  }
  const scopes = statusMessage.payload.scopes.filter(
    (scope): scope is ExtensionConnectScope =>
      validScopes.has(scope as ExtensionConnectScope),
  );
  if (scopes.length === 0) {
    return {
      kind: ExtensionMessageDeliveryKind.Received,
      discovery: {
        status: ExtensionPairedVaultIdentityStatusMessageStatus.Unavailable,
      },
    };
  }
  return {
    kind: ExtensionMessageDeliveryKind.Received,
    discovery: {
      status: ExtensionPairedVaultIdentityStatusMessageStatus.Unlocked,
      request: {
        source: ExtensionIdentityRequestSource.PairedVault,
        vaultStoreId,
        deviceId: statusMessage.payload.deviceId,
        devicePublicKey: statusMessage.payload.devicePublicKey,
        deviceSigningPublicKey: statusMessage.payload.deviceSigningPublicKey,
        extensionRuntimeId: statusMessage.payload.extensionRuntimeId,
        deviceLabel: statusMessage.payload.deviceLabel,
        nonce: statusMessage.payload.nonce,
        scopes,
      },
    },
  };
}

export async function discoverPairedExtensionIdentity(
  vaultStoreId: string,
): Promise<PairedExtensionIdentityDiscovery> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await discoverPairedExtensionIdentityOnce(vaultStoreId);
    if (result.kind === ExtensionMessageDeliveryKind.Received) {
      return result.discovery;
    }
  }
  return {
    status: ExtensionPairedVaultIdentityStatusMessageStatus.Unavailable,
  };
}

export async function requestPairedExtensionUnlock(
  vaultStoreId: string,
): Promise<boolean> {
  const installedExtension = readInstalledExtensionRuntimeId();
  if (installedExtension.kind === InstalledExtensionRuntimeKind.NotInstalled) {
    return false;
  }

  const unlockRequestId = requestId();
  const message: ExtensionPairedVaultUnlockRequestMessage = {
    type: ExtensionPairedVaultUnlockRequestMessageType.NookExtensionPairedVaultUnlockRequest,
    payload: { requestId: unlockRequestId, vaultStoreId },
  };
  const delivery = await sendExtensionMessage(
    installedExtension.extensionRuntimeId,
    message,
  );
  if (delivery.kind !== ExtensionMessageDeliveryKind.Received) return false;
  const response = delivery.response;
  return (
    !!response &&
    typeof response === "object" &&
    "ok" in response &&
    response.ok === true &&
    "requestId" in response &&
    response.requestId === unlockRequestId &&
    "vaultStoreId" in response &&
    response.vaultStoreId === vaultStoreId
  );
}

type ExtensionIdentityHandoffResponse = {
  ok?: boolean;
  envelope?: unknown;
  nextNonce?: unknown;
  reason?: unknown;
};

function requestIdentityEnvelope(
  request: ExtensionConnectRequest,
  message:
    | ExtensionIdentityHandoffRequestMessage
    | ExtensionPairedVaultIdentityHandoffRequestMessage,
): Promise<{ envelope: string; nextNonce: string }> {
  const runtime = (
    globalThis as typeof globalThis & {
      chrome?: {
        runtime?: {
          sendMessage?: (
            extensionId: string,
            message: unknown,
            callback: (response?: ExtensionIdentityHandoffResponse) => void,
          ) => void;
          lastError?: { message?: string };
        };
      };
    }
  ).chrome?.runtime;
  if (!runtime?.sendMessage) {
    return Promise.reject(
      new Error("extension-identity-messaging-unavailable"),
    );
  }

  return new Promise((resolve, reject) => {
    runtime.sendMessage?.(request.extensionRuntimeId, message, (response) => {
      const runtimeError = runtime.lastError?.message;
      if (runtimeError) {
        reject(new Error(runtimeError));
        return;
      }
      if (
        response?.ok === true &&
        typeof response.envelope === "string" &&
        typeof response.nextNonce === "string" &&
        response.nextNonce.length > 0
      ) {
        resolve({
          envelope: response.envelope,
          nextNonce: response.nextNonce,
        });
        return;
      }
      reject(
        new Error(
          typeof response?.reason === "string"
            ? response.reason
            : "extension-identity-handoff-rejected",
        ),
      );
    });
  });
}

/** Adopt the unlocked extension identity without exposing private key material
 * to JavaScript. Only an age-encrypted, nonce-bound envelope crosses the
 * extension boundary; Rust/WASM validates and installs its contents. */
export async function adoptExtensionIdentity(
  args: AdoptExtensionIdentityArgs,
): Promise<void> {
  const { manager, request } = args;
  const nonce = request.nonce;
  const recipientPublicKey = manager.beginExtensionIdentityHandoff();
  const handoffPayload = {
    recipientPublicKey,
    nonce,
    expectedDeviceId: request.deviceId,
    expectedDevicePublicKey: request.devicePublicKey,
    expectedDeviceSigningPublicKey: request.deviceSigningPublicKey,
  };
  const message:
    | ExtensionIdentityHandoffRequestMessage
    | ExtensionPairedVaultIdentityHandoffRequestMessage =
    request.source === ExtensionIdentityRequestSource.PairedVault
      ? {
          type: ExtensionPairedVaultIdentityHandoffRequestMessageType.NookExtensionPairedVaultIdentityHandoffRequest,
          payload: {
            ...handoffPayload,
            vaultStoreId: request.vaultStoreId,
          },
        }
      : {
          type: ExtensionIdentityHandoffRequestMessageType.NookExtensionIdentityHandoffRequest,
          payload: handoffPayload,
        };
  const { envelope, nextNonce } = await requestIdentityEnvelope(
    request,
    message,
  );
  await manager.finishExtensionIdentityHandoff(
    envelope,
    nonce,
    request.deviceId,
    request.devicePublicKey,
    request.deviceSigningPublicKey,
  );
  request.nonce = nextNonce;
}
