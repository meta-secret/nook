import { stripBasePath } from "$lib/routes";
import type { NookVaultManager } from "$app-wasm";
import type { ExtensionIdentityHandoffRequestMessage } from "$web-shared/extension/runtime-messages";

export const EXTENSION_CONNECT_PATH = "/extension-connect";

export type ExtensionConnectScope =
  | "vault-access"
  | "password-filling"
  | "sync-provider-credentials";

export type ExtensionConnectRequest = {
  deviceId: string;
  devicePublicKey: string;
  deviceSigningPublicKey: string;
  extensionRuntimeId: string;
  deviceLabel: string;
  nonce: string;
  scopes: ExtensionConnectScope[];
};

const validScopes = new Set<ExtensionConnectScope>([
  "vault-access",
  "password-filling",
  "sync-provider-credentials",
]);

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
    deviceId,
    devicePublicKey,
    deviceSigningPublicKey,
    extensionRuntimeId,
    deviceLabel,
    nonce,
    scopes,
  };
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
  message: ExtensionIdentityHandoffRequestMessage,
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
  const message: ExtensionIdentityHandoffRequestMessage = {
    type: "nook:extension-identity-handoff-request",
    payload: {
      recipientPublicKey,
      nonce,
      expectedDeviceId: request.deviceId,
      expectedDevicePublicKey: request.devicePublicKey,
      expectedDeviceSigningPublicKey: request.deviceSigningPublicKey,
    },
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
