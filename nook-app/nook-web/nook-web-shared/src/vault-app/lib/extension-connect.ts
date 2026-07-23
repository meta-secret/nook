import { stripBasePath } from "$lib/routes";
import type { NookVaultManager } from "$app-wasm";
import {
  isExtensionPairedVaultIdentityStatusMessage,
  type ExtensionIdentityHandoffRequestMessage,
  type ExtensionPairedVaultIdentityDiscoveryMessage,
  type ExtensionPairedVaultIdentityHandoffRequestMessage,
  type ExtensionPairedVaultUnlockRequestMessage,
  type OpenCompanionLauncherMessage,
} from "$web-shared/extension/runtime-messages";
import type {
  ExtensionConnectRequestFor,
  PairedExtensionIdentityDiscoveryFor,
} from "$web-shared/extension/extension-connect-types";

export const EXTENSION_CONNECT_PATH = "/extension-connect";

export type ExtensionConnectScope =
  | "vault-access"
  | "password-filling"
  | "passkey-management"
  | "sync-provider-credentials";

export type ExtensionConnectRequest =
  ExtensionConnectRequestFor<ExtensionConnectScope>;
export type PairedExtensionIdentityDiscovery =
  PairedExtensionIdentityDiscoveryFor<ExtensionConnectRequest>;

const validScopes = new Set<ExtensionConnectScope>([
  "vault-access",
  "password-filling",
  "passkey-management",
  "sync-provider-credentials",
]);
const extensionRuntimeIdAttribute = "data-nook-extension-runtime-id";
const EXTENSION_MESSAGE_TIMEOUT_MS = 5_000;

export function isExtensionConnectPath(pathname: string): boolean {
  const normalized = stripBasePath(pathname).replace(/\/$/, "") || "/";
  return normalized === EXTENSION_CONNECT_PATH;
}

function parseScopes(raw: string | null): ExtensionConnectScope[] {
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
): ExtensionConnectRequest | undefined {
  if (!isExtensionConnectPath(location.pathname)) return undefined;

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
  const scopes = parseScopes(params.get("scopes"));

  if (
    !deviceId ||
    !devicePublicKey ||
    !deviceSigningPublicKey ||
    !extensionRuntimeId ||
    !nonce ||
    scopes.length === 0
  ) {
    return undefined;
  }

  return {
    source: "extension-connect",
    deviceId,
    devicePublicKey,
    deviceSigningPublicKey,
    extensionRuntimeId,
    deviceLabel,
    nonce,
    scopes,
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

export function readInstalledExtensionRuntimeId(): string | undefined {
  return (
    document.documentElement
      .getAttribute(extensionRuntimeIdAttribute)
      ?.trim() || undefined
  );
}

function sendExtensionMessage(
  extensionId: string,
  message: unknown,
): Promise<unknown | undefined> {
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
      resolve(undefined);
      return;
    }

    let settled = false;
    const finish = (response?: unknown) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(response);
    };
    const timer = window.setTimeout(
      () => finish(),
      EXTENSION_MESSAGE_TIMEOUT_MS,
    );
    runtime.sendMessage(extensionId, message, (response) => {
      if (runtime.lastError?.message) {
        finish();
        return;
      }
      finish(response);
    });
  });
}

export async function openInstalledExtension(): Promise<boolean> {
  const extensionRuntimeId = readInstalledExtensionRuntimeId();
  if (!extensionRuntimeId) return false;

  const message: OpenCompanionLauncherMessage = {
    type: "nook:open-companion-launcher",
    payload: { intent: "pair" },
  };
  const response = await sendExtensionMessage(extensionRuntimeId, message);
  return (
    !!response &&
    typeof response === "object" &&
    "ok" in response &&
    response.ok === true
  );
}

async function discoverPairedExtensionIdentityOnce(
  vaultStoreId: string,
): Promise<PairedExtensionIdentityDiscovery | undefined> {
  const extensionRuntimeId = readInstalledExtensionRuntimeId();
  if (!extensionRuntimeId) return Promise.resolve(undefined);

  const discoveryRequestId = requestId();
  const message: ExtensionPairedVaultIdentityDiscoveryMessage = {
    type: "nook:extension-paired-vault-identity-discovery",
    payload: {
      requestId: discoveryRequestId,
      vaultStoreId,
      expiresAt: Date.now() + EXTENSION_MESSAGE_TIMEOUT_MS,
    },
  };

  const statusMessage = await sendExtensionMessage(extensionRuntimeId, message);
  if (
    !isExtensionPairedVaultIdentityStatusMessage(statusMessage) ||
    statusMessage.payload.requestId !== discoveryRequestId ||
    statusMessage.payload.vaultStoreId !== vaultStoreId
  ) {
    return undefined;
  }
  if (statusMessage.payload.status !== "unlocked") {
    return { status: statusMessage.payload.status };
  }
  const scopes = statusMessage.payload.scopes.filter(
    (scope): scope is ExtensionConnectScope =>
      validScopes.has(scope as ExtensionConnectScope),
  );
  if (scopes.length === 0) return { status: "unavailable" };
  return {
    status: "unlocked",
    request: {
      source: "paired-vault",
      vaultStoreId,
      deviceId: statusMessage.payload.deviceId,
      devicePublicKey: statusMessage.payload.devicePublicKey,
      deviceSigningPublicKey: statusMessage.payload.deviceSigningPublicKey,
      extensionRuntimeId: statusMessage.payload.extensionRuntimeId,
      deviceLabel: statusMessage.payload.deviceLabel,
      nonce: statusMessage.payload.nonce,
      scopes,
    },
  };
}

export async function discoverPairedExtensionIdentity(
  vaultStoreId: string,
): Promise<PairedExtensionIdentityDiscovery> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await discoverPairedExtensionIdentityOnce(vaultStoreId);
    if (result) return result;
  }
  return { status: "unavailable" };
}

export async function requestPairedExtensionUnlock(
  vaultStoreId: string,
): Promise<boolean> {
  const extensionId = readInstalledExtensionRuntimeId();
  if (!extensionId) return false;

  const unlockRequestId = requestId();
  const message: ExtensionPairedVaultUnlockRequestMessage = {
    type: "nook:extension-paired-vault-unlock-request",
    payload: { requestId: unlockRequestId, vaultStoreId },
  };
  const response = await sendExtensionMessage(extensionId, message);
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
  manager: NookVaultManager,
  request: ExtensionConnectRequest,
): Promise<void> {
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
    request.source === "paired-vault"
      ? {
          type: "nook:extension-paired-vault-identity-handoff-request",
          payload: {
            ...handoffPayload,
            vaultStoreId: request.vaultStoreId,
          },
        }
      : {
          type: "nook:extension-identity-handoff-request",
          payload: handoffPayload,
        };
  const { envelope, nextNonce } = await requestIdentityEnvelope(
    request,
    message,
  );
  manager.finishExtensionIdentityHandoff(
    envelope,
    nonce,
    request.deviceId,
    request.devicePublicKey,
    request.deviceSigningPublicKey,
  );
  request.nonce = nextNonce;
}
