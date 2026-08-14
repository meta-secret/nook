type ExtensionMessageRequest = {
  readonly extensionId: string;
  readonly message: unknown;
};

type ExtensionPairingApprovalDelivery = {
  readonly request: ExtensionConnectRequest;
  readonly message: ExtensionPairingApprovedMessage;
};

type IdentityEnvelopeRequest = {
  readonly request: ExtensionConnectRequest;
  readonly message:
    | ExtensionIdentityHandoffRequestMessage
    | ExtensionPairedVaultIdentityHandoffRequestMessage;
};

import { stripBasePath } from "$lib/runtime/routes";
import {
  NookExtensionIdentityHandoffContext,
  type NookVaultManager,
} from "$app-wasm";
import {
  ExtensionPairedVaultIdentityDiscoveryMessageType,
  ExtensionPairedVaultIdentityHandoffRequestMessageType,
  ExtensionPairedVaultIdentityStatusMessageStatus,
  ExtensionPairedVaultUnlockRequestMessageType,
  ExtensionIdentityHandoffRequestMessageType,
  OpenCompanionLauncherIntent,
  OpenCompanionLauncherMessageType,
  isExtensionPairedVaultIdentityStatusMessage,
  type ExtensionIdentityHandoffRequestMessage,
  type ExtensionPairedVaultIdentityDiscoveryMessage,
  type ExtensionPairedVaultIdentityHandoffRequestMessage,
  type ExtensionPairedVaultUnlockRequestMessage,
  type ExtensionPairingApprovedMessage,
  type OpenCompanionLauncherMessage,
} from "$web-shared/extension/runtime-messages";
import {
  ExtensionIdentityRequestSource,
  type ExtensionConnectRequestFor,
  type PairedExtensionIdentityDiscoveryFor,
} from "$web-shared/extension/extension-connect-types";
import {
  ExtensionConnectScope,
  isExtensionConnectScopeValue,
} from "$web-shared/extension/extension-connect-scope";

export const EXTENSION_CONNECT_PATH = "/extension-connect";

export { ExtensionConnectScope, ExtensionIdentityRequestSource };

export type ExtensionConnectRequest =
  ExtensionConnectRequestFor<ExtensionConnectScope>;
export type PairedExtensionIdentityDiscovery =
  PairedExtensionIdentityDiscoveryFor<ExtensionConnectRequest>;

export type ExtensionIdentityAdoption = {
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

  return scopes.filter(isExtensionConnectScopeValue);
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

export enum ExtensionPairingDeliveryKind {
  Delivered = "delivered",
  MessagingUnavailable = "messaging-unavailable",
  PlaintextProviderMigrationRequired = "plaintext-provider-migration-required",
  Rejected = "rejected",
}

export type ExtensionPairingDelivery = {
  readonly kind: ExtensionPairingDeliveryKind;
};

export function readInstalledExtensionRuntimeId(): InstalledExtensionRuntime {
  const extensionRuntimeId = document.documentElement
    .getAttribute(extensionRuntimeIdAttribute)
    ?.trim();
  return extensionRuntimeId
    ? { kind: InstalledExtensionRuntimeKind.Installed, extensionRuntimeId }
    : { kind: InstalledExtensionRuntimeKind.NotInstalled };
}

function sendExtensionMessage({
  extensionId,
  message,
}: ExtensionMessageRequest): Promise<ExtensionMessageDelivery> {
  return new Promise((resolve) => {
    const runtime = (
      globalThis as typeof globalThis & {
        chrome?: {
          runtime?: {
            // eslint-disable-next-line max-params -- Chrome owns this positional API.
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
    const sendMessage = runtime?.sendMessage?.bind(runtime);
    if (!sendMessage) {
      const resolveArgs: Parameters<typeof resolve>[0] = {
        kind: ExtensionMessageDeliveryKind.Unavailable,
      };
      resolve(resolveArgs);
      return;
    }
    let settled = false;
    const finishUnavailable = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      const resolveArgs2: Parameters<typeof resolve>[0] = {
        kind: ExtensionMessageDeliveryKind.Unavailable,
      };
      resolve(resolveArgs2);
    };
    const finishReceived = (response: unknown) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      const resolveArgs3: Parameters<typeof resolve>[0] = {
        kind: ExtensionMessageDeliveryKind.Received,
        response,
      };
      resolve(resolveArgs3);
    };
    const timer = window.setTimeout(
      finishUnavailable,
      EXTENSION_MESSAGE_TIMEOUT_MS,
    );
    function receiveExtensionResponse(response?: unknown): void {
      if (runtime?.lastError?.message) {
        finishUnavailable();
        return;
      }
      if (arguments.length === 0) {
        finishUnavailable();
        return;
      }
      finishReceived(response);
    }
    sendMessage(extensionId, message, receiveExtensionResponse);
  });
}

function pairingDeliveryFromResponse(
  response: unknown,
): ExtensionPairingDelivery {
  if (
    response &&
    typeof response === "object" &&
    "ok" in response &&
    response.ok === true
  ) {
    return { kind: ExtensionPairingDeliveryKind.Delivered };
  }
  const migrationRequired =
    response &&
    typeof response === "object" &&
    (("reason" in response &&
      response.reason === "auth-provider-plaintext-migration-required") ||
      ("error" in response &&
        response.error === "auth-provider-plaintext-migration-required"));
  return {
    kind: migrationRequired
      ? ExtensionPairingDeliveryKind.PlaintextProviderMigrationRequired
      : ExtensionPairingDeliveryKind.Rejected,
  };
}

export async function deliverExtensionPairingApproval({
  request,
  message,
}: ExtensionPairingApprovalDelivery): Promise<ExtensionPairingDelivery> {
  let lastDelivery: ExtensionPairingDelivery = {
    kind: ExtensionPairingDeliveryKind.MessagingUnavailable,
  };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const sendArgs: Parameters<typeof sendExtensionMessage>[0] = {
      extensionId: request.extensionRuntimeId,
      message,
    };
    const delivery = await sendExtensionMessage(sendArgs);
    lastDelivery =
      delivery.kind === ExtensionMessageDeliveryKind.Received
        ? pairingDeliveryFromResponse(delivery.response)
        : { kind: ExtensionPairingDeliveryKind.MessagingUnavailable };
    if (lastDelivery.kind === ExtensionPairingDeliveryKind.Delivered) {
      return lastDelivery;
    }
    if (attempt < 2) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 150));
    }
  }
  return lastDelivery;
}

export async function openInstalledExtension(): Promise<boolean> {
  const installedExtension = readInstalledExtensionRuntimeId();
  if (installedExtension.kind === InstalledExtensionRuntimeKind.NotInstalled) {
    return false;
  }

  const message: OpenCompanionLauncherMessage = {
    type: OpenCompanionLauncherMessageType.NookOpenCompanionLauncher,
    payload: { intent: OpenCompanionLauncherIntent.Pair },
  };
  const sendExtensionMessageArgs: Parameters<typeof sendExtensionMessage>[0] = {
    extensionId: installedExtension.extensionRuntimeId,
    message,
  };
  const delivery = await sendExtensionMessage(sendExtensionMessageArgs);
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

  const sendExtensionMessageArgs2: Parameters<typeof sendExtensionMessage>[0] =
    { extensionId: installedExtension.extensionRuntimeId, message };
  const delivery = await sendExtensionMessage(sendExtensionMessageArgs2);
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
    isExtensionConnectScopeValue,
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
  const sendExtensionMessageArgs3: Parameters<typeof sendExtensionMessage>[0] =
    { extensionId: installedExtension.extensionRuntimeId, message };
  const delivery = await sendExtensionMessage(sendExtensionMessageArgs3);
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

function requestIdentityEnvelope({
  request,
  message,
}: IdentityEnvelopeRequest): Promise<{ envelope: string; nextNonce: string }> {
  const runtime = (
    globalThis as typeof globalThis & {
      chrome?: {
        runtime?: {
          // eslint-disable-next-line max-params -- Chrome owns this positional API.
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

  return new Promise(
    // eslint-disable-next-line max-params -- Host API owns this positional callback signature.
    (resolve, reject) => {
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
          const resolveArgs4: Parameters<typeof resolve>[0] = {
            envelope: response.envelope,
            nextNonce: response.nextNonce,
          };
          resolve(resolveArgs4);
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
    },
  );
}

/** Adopt the unlocked extension identity without exposing private key material
 * to JavaScript. Only an age-encrypted, nonce-bound envelope crosses the
 * extension boundary; Rust/WASM validates and installs its contents. */
export async function adoptExtensionIdentity(
  args: ExtensionIdentityAdoption,
): Promise<void> {
  const { manager, request } = args;
  const nonce = request.nonce;
  const recipientPublicKey = manager.begin_extension_identity_handoff();
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
  const requestIdentityEnvelopeArgs: Parameters<
    typeof requestIdentityEnvelope
  >[0] = { request, message };
  const { envelope, nextNonce } = await requestIdentityEnvelope(
    requestIdentityEnvelopeArgs,
  );
  const context =
    request.source === ExtensionIdentityRequestSource.PairedVault
      ? NookExtensionIdentityHandoffContext.paired_vault(request.vaultStoreId)
      : NookExtensionIdentityHandoffContext.vault_creation();
  await manager.finish_extension_identity_handoff(
    envelope,
    nonce,
    request.deviceId,
    request.devicePublicKey,
    request.deviceSigningPublicKey,
    context,
  );
  request.nonce = nextNonce;
}
