import type { NookAdoptedExtensionIdentityHandoff } from "$app-wasm";
type ExtensionMessageRequest = {
  readonly extensionId: string;
  readonly message: unknown;
  readonly responseWait: ExtensionMessageResponseWait;
};

type ExtensionPairingApprovalDelivery = {
  readonly request: ExtensionConnectRequest;
  readonly message: ExtensionPairingApprovedMessage;
};

type IdentityEnvelopeRequest = {
  readonly request: Extract<
    ExtensionConnectRequest,
    { source: ExtensionIdentityRequestSource.ExtensionConnect }
  >;
  readonly message: ExtensionIdentityHandoffRequestMessage;
};
import { ApplicationPath } from "$lib/runtime/routes";
import {
  admit_companion_handoff_response,
  admit_companion_identity_status,
  NookExtensionIdentityHandoffContext,
  type CompanionIdentityDiscoveryObservation,
  type CompanionIdentityDiscoveryRequest,
  type CompanionWebsiteHandoffBegin,
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

const PAIRED_IDENTITY_UNAVAILABLE_RETRY_MS = 150;

enum ExtensionMessageResponseWaitKind {
  BrowserChannel = "browser-channel",
  Bounded = "bounded",
}

type ExtensionMessageResponseWait =
  | { readonly kind: ExtensionMessageResponseWaitKind.BrowserChannel }
  | {
      readonly kind: ExtensionMessageResponseWaitKind.Bounded;
      readonly timeoutMs: number;
    };

enum ExtensionMessageResponseTimerKind {
  NotScheduled = "not-scheduled",
  Scheduled = "scheduled",
}

type ExtensionMessageResponseTimer =
  | { readonly kind: ExtensionMessageResponseTimerKind.NotScheduled }
  | {
      readonly kind: ExtensionMessageResponseTimerKind.Scheduled;
      readonly handle: number;
    };

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

type ExtensionIdentityHandoffResponse = {
  ok?: boolean;
  envelope?: unknown;
  nextNonce?: unknown;
  reason?: unknown;
};

enum ExtensionResponsePhase {
  Pending = "pending",
  Settled = "settled",
}
type ExtensionResponseState =
  | {
      kind: ExtensionResponsePhase.Pending;
      timer: ExtensionMessageResponseTimer;
    }
  | { kind: ExtensionResponsePhase.Settled };

/** Only a pending response owns timer completion; native callback aliases are invalidated. */
class PendingExtensionResponse {
  private state: ExtensionResponseState = {
    kind: ExtensionResponsePhase.Pending,
    timer: { kind: ExtensionMessageResponseTimerKind.NotScheduled },
  };
  constructor(
    private readonly request: {
      browser: typeof globalThis;
      wait: ExtensionMessageResponseWait;
      resolve: (delivery: ExtensionMessageDelivery) => void;
    },
  ) {
    if (request.wait.kind === ExtensionMessageResponseWaitKind.Bounded) {
      this.state = {
        kind: ExtensionResponsePhase.Pending,
        timer: {
          kind: ExtensionMessageResponseTimerKind.Scheduled,
          handle: request.browser.window.setTimeout(
            () => this.unavailable(),
            request.wait.timeoutMs,
          ),
        },
      };
    }
  }
  private settle(delivery: ExtensionMessageDelivery): void {
    const pending = this.state;
    if (pending.kind !== ExtensionResponsePhase.Pending) return;
    this.state = { kind: ExtensionResponsePhase.Settled };
    if (pending.timer.kind === ExtensionMessageResponseTimerKind.Scheduled)
      this.request.browser.window.clearTimeout(pending.timer.handle);
    this.request.resolve(delivery);
  }
  unavailable(): void {
    this.settle({ kind: ExtensionMessageDeliveryKind.Unavailable });
  }
  receive(response: unknown): void {
    this.settle({ kind: ExtensionMessageDeliveryKind.Received, response });
  }
}

/** Owns this browser host’s resources and interaction lifecycle. */
class ExtensionConnectionBrowser {
  constructor(private readonly browser: typeof globalThis) {}

  isExtensionConnectPath(pathname: string): boolean {
    const normalized =
      new ApplicationPath(pathname).relative.replace(/\/$/, "") || "/";
    return normalized === EXTENSION_CONNECT_PATH;
  }

  private parseScopes(params: URLSearchParams): ExtensionConnectScope[] {
    const raw = params.get("scopes");
    const scopes = ((v) => (v ? v : ""))(raw)
      .split(",")
      .map((scope) => scope.trim())
      .filter(Boolean);

    return scopes.filter(isExtensionConnectScopeValue);
  }

  extensionConnectRequestFromLocation(
    location: Location,
  ): ExtensionConnectRequestState {
    if (!this.isExtensionConnectPath(this.browser.location.pathname)) {
      return { kind: ExtensionConnectRequestStateKind.Absent };
    }

    const params = new URLSearchParams(this.browser.location.search);
    const deviceId = ((v) => (v ? v : ""))(params.get("device_id")?.trim());
    const devicePublicKey = ((v) => (v ? v : ""))(
      params.get("device_public_key")?.trim(),
    );
    const deviceSigningPublicKey = ((v) => (v ? v : ""))(
      params.get("device_signing_public_key")?.trim(),
    );
    const extensionRuntimeId = ((v) => (v ? v : ""))(
      params.get("extension_id")?.trim(),
    );
    const [deviceLabel = "Nook Extension - this browser profile"] = [
      params.get("device_label")?.trim(),
    ];
    const nonce = ((v) => (v ? v : ""))(params.get("nonce")?.trim());
    const scopes = this.parseScopes(params);

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

  private requestId(): string {
    if (typeof this.browser.crypto.randomUUID === "function")
      return this.browser.crypto.randomUUID();
    const bytes = new Uint8Array(16);
    this.browser.crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
      "",
    );
  }

  readInstalledExtensionRuntimeId(): InstalledExtensionRuntime {
    const extensionRuntimeId = this.browser.document.documentElement
      .getAttribute(extensionRuntimeIdAttribute)
      ?.trim();
    return extensionRuntimeId
      ? { kind: InstalledExtensionRuntimeKind.Installed, extensionRuntimeId }
      : { kind: InstalledExtensionRuntimeKind.NotInstalled };
  }

  private sendExtensionMessage({
    extensionId,
    message,
    responseWait,
  }: ExtensionMessageRequest): Promise<ExtensionMessageDelivery> {
    return new Promise((resolve) => {
      const runtime = (
        this.browser as typeof this.browser & {
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
      const pending = new PendingExtensionResponse({
        browser: this.browser,
        wait: responseWait,
        resolve,
      });
      function receiveExtensionResponse(response?: unknown): void {
        if (runtime?.lastError?.message) {
          pending.unavailable();
          return;
        }
        if (arguments.length === 0) {
          pending.unavailable();
          return;
        }
        pending.receive(response);
      }
      sendMessage(extensionId, message, receiveExtensionResponse);
    });
  }

  private pairingDeliveryFromResponse(
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

  async deliverExtensionPairingApproval({
    request,
    message,
  }: ExtensionPairingApprovalDelivery): Promise<ExtensionPairingDelivery> {
    const sendArgs: Parameters<typeof this.sendExtensionMessage>[0] = {
      extensionId: request.extensionRuntimeId,
      message,
      responseWait: { kind: ExtensionMessageResponseWaitKind.BrowserChannel },
    };
    const delivery = await this.sendExtensionMessage(sendArgs);
    return delivery.kind === ExtensionMessageDeliveryKind.Received
      ? this.pairingDeliveryFromResponse(delivery.response)
      : { kind: ExtensionPairingDeliveryKind.MessagingUnavailable };
  }

  async openInstalledExtension(): Promise<boolean> {
    const installedExtension = this.readInstalledExtensionRuntimeId();
    if (
      installedExtension.kind === InstalledExtensionRuntimeKind.NotInstalled
    ) {
      return false;
    }

    const message: OpenCompanionLauncherMessage = {
      type: OpenCompanionLauncherMessageType.NookOpenCompanionLauncher,
      payload: { intent: OpenCompanionLauncherIntent.Pair },
    };
    const sendExtensionMessageArgs: Parameters<
      typeof this.sendExtensionMessage
    >[0] = {
      extensionId: installedExtension.extensionRuntimeId,
      message,
      responseWait: {
        kind: ExtensionMessageResponseWaitKind.Bounded,
        timeoutMs: EXTENSION_MESSAGE_TIMEOUT_MS,
      },
    };
    const delivery = await this.sendExtensionMessage(sendExtensionMessageArgs);
    if (delivery.kind !== ExtensionMessageDeliveryKind.Received) return false;
    const response = delivery.response;
    return (
      !!response &&
      typeof response === "object" &&
      "ok" in response &&
      response.ok === true
    );
  }

  private async discoverPairedExtensionIdentityOnce(
    vaultStoreId: string,
  ): Promise<
    | { kind: ExtensionMessageDeliveryKind.Unavailable }
    | {
        kind: ExtensionMessageDeliveryKind.Received;
        discovery: PairedExtensionIdentityDiscovery;
      }
  > {
    const installedExtension = this.readInstalledExtensionRuntimeId();
    if (
      installedExtension.kind === InstalledExtensionRuntimeKind.NotInstalled
    ) {
      return { kind: ExtensionMessageDeliveryKind.Unavailable };
    }

    const discoveryRequestId = this.requestId();
    const discoveryRequest = {
      requestId: discoveryRequestId,
      vaultStoreId,
      expiresAt: Date.now() + EXTENSION_MESSAGE_TIMEOUT_MS,
    } satisfies CompanionIdentityDiscoveryRequest;
    const protocolDiscovery = {
      request: discoveryRequest,
      observedAt: Date.now(),
    } satisfies CompanionIdentityDiscoveryObservation;
    const message: ExtensionPairedVaultIdentityDiscoveryMessage = {
      type: ExtensionPairedVaultIdentityDiscoveryMessageType.NookExtensionPairedVaultIdentityDiscovery,
      payload: protocolDiscovery,
    };

    const sendExtensionMessageArgs2: Parameters<
      typeof this.sendExtensionMessage
    >[0] = {
      extensionId: installedExtension.extensionRuntimeId,
      message,
      responseWait: {
        kind: ExtensionMessageResponseWaitKind.Bounded,
        timeoutMs: EXTENSION_MESSAGE_TIMEOUT_MS,
      },
    };
    const delivery = await this.sendExtensionMessage(sendExtensionMessageArgs2);
    if (delivery.kind !== ExtensionMessageDeliveryKind.Received)
      return delivery;
    const response = delivery.response;
    if (
      !response ||
      typeof response !== "object" ||
      !("ok" in response) ||
      response.ok !== true ||
      !("status" in response)
    ) {
      return { kind: ExtensionMessageDeliveryKind.Unavailable };
    }
    let admission: ReturnType<typeof admit_companion_identity_status>;
    try {
      const admissionRequest = {
        discovery: protocolDiscovery,
        status: response.status,
        observedAt: Date.now(),
      };
      admission = Reflect.apply(admit_companion_identity_status, this.browser, [
        admissionRequest,
      ]);
    } catch {
      return { kind: ExtensionMessageDeliveryKind.Unavailable };
    }
    if (admission.kind !== "accepted") {
      return { kind: ExtensionMessageDeliveryKind.Unavailable };
    }
    const transaction = admission.transaction;
    const status = transaction.status;
    if (
      status.status !== ExtensionPairedVaultIdentityStatusMessageStatus.Unlocked
    ) {
      if (
        status.status ===
        ExtensionPairedVaultIdentityStatusMessageStatus.DifferentVault
      ) {
        return {
          kind: ExtensionMessageDeliveryKind.Received,
          discovery: {
            status:
              ExtensionPairedVaultIdentityStatusMessageStatus.DifferentVault,
            connectedVaultStoreId: status.connected_vault_store_id,
            connectedVaultName: status.connected_vault_name,
          },
        };
      }
      return {
        kind: ExtensionMessageDeliveryKind.Received,
        discovery: { status: status.status },
      };
    }
    const unlockedAppKey = status.app_key;
    return {
      kind: ExtensionMessageDeliveryKind.Received,
      discovery: {
        status: ExtensionPairedVaultIdentityStatusMessageStatus.Unlocked,
        request: {
          source: ExtensionIdentityRequestSource.PairedVault,
          vaultStoreId,
          deviceId: unlockedAppKey.appKey.appId,
          devicePublicKey: unlockedAppKey.appKey.encryptionPublicKey,
          deviceSigningPublicKey: unlockedAppKey.appKey.signingPublicKey,
          extensionRuntimeId: unlockedAppKey.extensionRuntimeId,
          deviceLabel: unlockedAppKey.appKey.installationLabel,
          nonce: unlockedAppKey.nonce,
          scopes: unlockedAppKey.scopes,
          protocolTransaction: transaction,
        },
      },
    };
  }

  async discoverPairedExtensionIdentity(
    vaultStoreId: string,
  ): Promise<PairedExtensionIdentityDiscovery> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result =
        await this.discoverPairedExtensionIdentityOnce(vaultStoreId);
      if (result.kind === ExtensionMessageDeliveryKind.Received) {
        if (
          result.discovery.status !==
            ExtensionPairedVaultIdentityStatusMessageStatus.Unavailable ||
          attempt === 2
        ) {
          return result.discovery;
        }
      }
      if (attempt < 2) {
        // The service worker can answer while its offscreen session is still
        // starting. Retry its transient unavailable status before leaving a
        // paired vault on its local unlock screen.
        await new Promise<void>((resolve) => {
          this.browser.window.setTimeout(
            resolve,
            PAIRED_IDENTITY_UNAVAILABLE_RETRY_MS,
          );
        });
      }
    }
    return {
      status: ExtensionPairedVaultIdentityStatusMessageStatus.Unavailable,
    };
  }

  async requestPairedExtensionUnlock(vaultStoreId: string): Promise<boolean> {
    const installedExtension = this.readInstalledExtensionRuntimeId();
    if (
      installedExtension.kind === InstalledExtensionRuntimeKind.NotInstalled
    ) {
      return false;
    }

    const unlockRequestId = this.requestId();
    const message: ExtensionPairedVaultUnlockRequestMessage = {
      type: ExtensionPairedVaultUnlockRequestMessageType.NookExtensionPairedVaultUnlockRequest,
      payload: { requestId: unlockRequestId, vaultStoreId },
    };
    const sendExtensionMessageArgs3: Parameters<
      typeof this.sendExtensionMessage
    >[0] = {
      extensionId: installedExtension.extensionRuntimeId,
      message,
      responseWait: {
        kind: ExtensionMessageResponseWaitKind.Bounded,
        timeoutMs: EXTENSION_MESSAGE_TIMEOUT_MS,
      },
    };
    const delivery = await this.sendExtensionMessage(sendExtensionMessageArgs3);
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

  private requestIdentityEnvelope({
    request,
    message,
  }: IdentityEnvelopeRequest): Promise<{
    envelope: string;
    nextNonce: string;
  }> {
    const runtime = (
      this.browser as typeof this.browser & {
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
        runtime.sendMessage?.(
          request.extensionRuntimeId,
          message,
          (response) => {
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
          },
        );
      },
    );
  }

  async adoptExtensionIdentity(
    args: ExtensionIdentityAdoption,
  ): Promise<NookAdoptedExtensionIdentityHandoff> {
    const { manager, request } = args;
    if (request.source === ExtensionIdentityRequestSource.PairedVault) {
      const begin: CompanionWebsiteHandoffBegin = {
        transaction: request.protocolTransaction,
        context: {
          kind: "paired-vault",
          vault_store_id: request.vaultStoreId,
        },
      };
      const handoff = manager.begin_companion_identity_handoff(begin);
      const message: ExtensionPairedVaultIdentityHandoffRequestMessage = {
        type: ExtensionPairedVaultIdentityHandoffRequestMessageType.NookExtensionPairedVaultIdentityHandoffRequest,
        payload: handoff.request,
      };
      const sendArgs: Parameters<typeof this.sendExtensionMessage>[0] = {
        extensionId: request.extensionRuntimeId,
        message,
        responseWait: {
          kind: ExtensionMessageResponseWaitKind.Bounded,
          timeoutMs: EXTENSION_MESSAGE_TIMEOUT_MS,
        },
      };
      let consumed = false;
      try {
        const delivery = await this.sendExtensionMessage(sendArgs);
        if (
          delivery.kind !== ExtensionMessageDeliveryKind.Received ||
          !delivery.response ||
          typeof delivery.response !== "object" ||
          !("ok" in delivery.response) ||
          delivery.response.ok !== true ||
          !("response" in delivery.response)
        ) {
          throw new Error("extension-identity-handoff-rejected");
        }
        let admission: ReturnType<typeof admit_companion_handoff_response>;
        try {
          admission = Reflect.apply(
            admit_companion_handoff_response,
            this.browser,
            [delivery.response.response],
          );
        } catch {
          throw new Error("extension-identity-handoff-rejected");
        }
        if (admission.kind !== "accepted") {
          throw new Error("extension-identity-handoff-rejected");
        }
        consumed = true;
        return await handoff.finish(manager, admission.response);
      } catch (error) {
        if (!consumed) {
          try {
            handoff.cancel(manager);
          } catch {
            /* Preserve the original delivery error, as the lifecycle cleanup did. */
          }
        }
        throw error;
      }
    }
    const nonce = request.nonce;
    const pending = manager.begin_extension_identity_handoff();
    let consumed = false;
    try {
      const recipientPublicKey = pending.recipient_public_key;
      const handoffPayload = {
        recipientPublicKey,
        nonce,
        expectedDeviceId: request.deviceId,
        expectedDevicePublicKey: request.devicePublicKey,
        expectedDeviceSigningPublicKey: request.deviceSigningPublicKey,
      };
      const message: ExtensionIdentityHandoffRequestMessage = {
        type: ExtensionIdentityHandoffRequestMessageType.NookExtensionIdentityHandoffRequest,
        payload: handoffPayload,
      };
      const requestIdentityEnvelopeArgs: Parameters<
        typeof this.requestIdentityEnvelope
      >[0] = { request, message };
      const { envelope, nextNonce } = await this.requestIdentityEnvelope(
        requestIdentityEnvelopeArgs,
      );
      const context = NookExtensionIdentityHandoffContext.vault_creation();
      consumed = true;
      const adopted = await pending.finish(
        manager,
        envelope,
        nonce,
        request.deviceId,
        request.devicePublicKey,
        request.deviceSigningPublicKey,
        context,
      );
      request.nonce = nextNonce;
      return adopted;
    } catch (error) {
      if (!consumed) {
        try {
          pending.cancel(manager);
        } catch {
          /* Preserve the original delivery error, as the lifecycle cleanup did. */
        }
      }
      throw error;
    }
  }
}

export const extensionConnectionBrowser = new ExtensionConnectionBrowser(
  globalThis,
);
