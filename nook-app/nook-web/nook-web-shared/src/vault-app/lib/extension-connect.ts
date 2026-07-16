import { stripBasePath } from "$lib/routes";
import type { NookVaultManager } from "$app-wasm";
import {
  isExtensionPairedVaultIdentityStatusMessage,
  type ExtensionIdentityHandoffRequestMessage,
  type ExtensionPairedVaultIdentityDiscoveryMessage,
  type ExtensionPairedVaultIdentityHandoffRequestMessage,
} from "$web-shared/extension/runtime-messages";

export const EXTENSION_CONNECT_PATH = "/extension-connect";

export type ExtensionConnectScope =
  | "vault-access"
  | "password-filling"
  | "sync-provider-credentials";

type ExtensionIdentityRequestBase = {
  deviceId: string;
  devicePublicKey: string;
  deviceSigningPublicKey: string;
  extensionRuntimeId: string;
  deviceLabel: string;
  nonce: string;
  scopes: ExtensionConnectScope[];
};

export type ExtensionConnectRequest =
  | (ExtensionIdentityRequestBase & {
      source: "extension-connect";
    })
  | (ExtensionIdentityRequestBase & {
      source: "paired-vault";
      vaultStoreId: string;
    });

export type PairedExtensionIdentityDiscovery =
  | { status: "unavailable" | "locked" }
  | { status: "unlocked"; request: ExtensionConnectRequest };

const validScopes = new Set<ExtensionConnectScope>([
  "vault-access",
  "password-filling",
  "sync-provider-credentials",
]);
const extensionRuntimeIdAttribute = "data-nook-extension-runtime-id";

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

function discoverPairedExtensionIdentityOnce(
  vaultStoreId: string,
): Promise<PairedExtensionIdentityDiscovery | undefined> {
  const extensionRuntimeId = document.documentElement
    .getAttribute(extensionRuntimeIdAttribute)
    ?.trim();
  if (!extensionRuntimeId) return Promise.resolve(undefined);

  const discoveryRequestId = requestId();
  const message: ExtensionPairedVaultIdentityDiscoveryMessage = {
    type: "nook:extension-paired-vault-identity-discovery",
    payload: {
      requestId: discoveryRequestId,
      vaultStoreId,
    },
  };

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

    runtime.sendMessage(extensionRuntimeId, message, (statusMessage) => {
      if (runtime.lastError?.message) {
        resolve(undefined);
        return;
      }
      if (
        !isExtensionPairedVaultIdentityStatusMessage(statusMessage) ||
        statusMessage.payload.requestId !== discoveryRequestId ||
        statusMessage.payload.vaultStoreId !== vaultStoreId
      ) {
        resolve(undefined);
        return;
      }
      if (statusMessage.payload.status !== "unlocked") {
        resolve({ status: statusMessage.payload.status });
        return;
      }
      const scopes = statusMessage.payload.scopes.filter(
        (scope): scope is ExtensionConnectScope =>
          validScopes.has(scope as ExtensionConnectScope),
      );
      if (scopes.length === 0) {
        resolve({ status: "unavailable" });
        return;
      }
      resolve({
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
      });
    });
  });
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

export function scopeLabel(scope: ExtensionConnectScope): string {
  if (scope === "vault-access") return "Vault access";
  if (scope === "password-filling") return "Password filling";
  return "Sync provider credentials";
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
