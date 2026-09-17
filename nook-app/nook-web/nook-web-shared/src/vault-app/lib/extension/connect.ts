import { Effect } from "effect";
import { err, ok, type Result } from "neverthrow";
import {
  VaultStorageFailure,
  VaultStorageFailureKind,
  NativeVaultStorageFailure,
} from "$lib/runtime/storage-failure";
import type { NookAdoptedExtensionIdentityHandoff } from "$app-wasm";
type ExtensionMessageRequest = {
  readonly extensionId: string;
  readonly message: RuntimeMessage;
  readonly responseWait: ExtensionMessageResponseWait;
};

type ChromeExtensionRuntimeResponse =
  | CompanionIdentityDiscoveryTransportResponse
  | CompanionIdentityHandoffTransportResponse
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason?: string;
      readonly error?: string;
    }
  | {
      readonly ok: true;
      readonly requestId: string;
      readonly vaultStoreId: string;
    }
  | {
      readonly ok: true;
      readonly envelope: string;
      readonly nextNonce: string;
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

type PendingExtensionResponseRequest = {
  readonly browser: typeof globalThis;
  readonly wait: ExtensionMessageResponseWait;
  readonly resolve: (delivery: ExtensionMessageDelivery) => void;
};

type ChromeRuntimeResponseCallback = (
  response: ChromeExtensionRuntimeResponse | undefined,
) => void;

type ChromeRuntimeHost = {
  readonly lastError: { readonly message?: string } | undefined;
  readonly sendMessage: (
    extensionId: string,
    message: RuntimeMessage,
    callback: ChromeRuntimeResponseCallback,
  ) => void;
};

type ExtensionBrowserHost = typeof globalThis & {
  readonly chrome?: { readonly runtime?: ChromeRuntimeHost };
};

enum ChromeRuntimeAvailabilityKind {
  Unavailable = "unavailable",
  Available = "available",
}

type ChromeRuntimeAvailability =
  | { readonly kind: ChromeRuntimeAvailabilityKind.Unavailable }
  | {
      readonly kind: ChromeRuntimeAvailabilityKind.Available;
      readonly runtime: ChromeRuntimeHost;
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
  type RuntimeMessage,
  type CompanionIdentityDiscoveryTransportResponse,
  type CompanionIdentityHandoffTransportResponse,
} from "$web-shared/extension/runtime-messages";
import {
  ExtensionIdentityRequestSource,
  type ExtensionConnectRequestFor,
  type PairedExtensionIdentityDiscoveryFor,
} from "$web-shared/extension/extension-connect-types";
import { ExtensionConnectScope } from "$web-shared/extension/extension-connect-scope";
import {
  ExtensionPairingDeliveryKind,
  type ExtensionPairingDelivery,
} from "./extension-pairing-delivery";
import {
  identityHandoffResponseDecoder,
  pairingApprovalResponseDecoder,
} from "./extension-response-decoders";

export const EXTENSION_CONNECT_PATH = "/extension-connect";

export { ExtensionConnectScope, ExtensionIdentityRequestSource };
export {
  ExtensionPairingDeliveryKind,
  ExtensionPairingRejectionReason,
  type ExtensionPairingDelivery,
} from "./extension-pairing-delivery";
export {
  AcceptedIdentityHandoffResponseSchema,
  ExtensionResponseDecodeFailureKind as IdentityHandoffResponseDecodeFailureKind,
  identityHandoffResponseDecoder,
  pairingApprovalResponseDecoder,
} from "./extension-response-decoders";

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
  | {
      kind: ExtensionMessageDeliveryKind.Received;
      response: ChromeExtensionRuntimeResponse;
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
  constructor(private readonly request: PendingExtensionResponseRequest) {
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
    const delivery: ExtensionMessageDelivery = {
      kind: ExtensionMessageDeliveryKind.Unavailable,
    };
    this.settle(delivery);
  }
  receive(response: ChromeExtensionRuntimeResponse): void {
    const delivery: ExtensionMessageDelivery = {
      kind: ExtensionMessageDeliveryKind.Received,
      response,
    };
    this.settle(delivery);
  }
}

/** Owns this browser host’s resources and interaction lifecycle. */
class ExtensionConnectionBrowser {
  constructor(private readonly browser: ExtensionBrowserHost) {}

  private chromeRuntimeLastError(runtime: ChromeRuntimeHost): boolean {
    const error = runtime.lastError;
    return (
      typeof error === "object" &&
      !!error &&
      "message" in error &&
      typeof error.message === "string" &&
      error.message.length > 0
    );
  }

  private chromeRuntime(): ChromeRuntimeAvailability {
    const chromeHost = this.browser.chrome;
    if (!chromeHost?.runtime) {
      return { kind: ChromeRuntimeAvailabilityKind.Unavailable };
    }
    if (typeof chromeHost.runtime.sendMessage !== "function") {
      return { kind: ChromeRuntimeAvailabilityKind.Unavailable };
    }
    return {
      kind: ChromeRuntimeAvailabilityKind.Available,
      runtime: chromeHost.runtime,
    };
  }

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

    const admittedScopes: ExtensionConnectScope[] = [];
    for (const scope of scopes) {
      const admitted = Effect.runSync(
        Effect.either(ExtensionConnectScope.decode(scope)),
      );
      if (admitted._tag === "Right") admittedScopes.push(admitted.right);
    }
    return admittedScopes;
  }

  extensionConnectRequestFromLocation(
    location: Location,
  ): ExtensionConnectRequestState {
    if (!this.isExtensionConnectPath(location.pathname)) {
      return { kind: ExtensionConnectRequestStateKind.Absent };
    }

    const params = new URLSearchParams(location.search);
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
      const runtimeAvailability = this.chromeRuntime();
      if (
        runtimeAvailability.kind === ChromeRuntimeAvailabilityKind.Unavailable
      ) {
        const resolveArgs: Parameters<typeof resolve>[0] = {
          kind: ExtensionMessageDeliveryKind.Unavailable,
        };
        resolve(resolveArgs);
        return;
      }
      const { runtime } = runtimeAvailability;
      const pendingRequest: PendingExtensionResponseRequest = {
        browser: this.browser,
        wait: responseWait,
        resolve,
      };
      const pending = new PendingExtensionResponse(pendingRequest);
      runtime.sendMessage(extensionId, message, (response) => {
        if (this.chromeRuntimeLastError(runtime)) {
          pending.unavailable();
          return;
        }
        if (response === undefined) {
          pending.unavailable();
          return;
        }
        pending.receive(response);
      });
    });
  }

  private pairingDeliveryFromResponse(
    response: ChromeExtensionRuntimeResponse,
  ): ExtensionPairingDelivery {
    const decoded = Effect.runSync(
      Effect.either(pairingApprovalResponseDecoder.decode(response)),
    );
    return decoded._tag === "Right"
      ? decoded.right
      : { kind: ExtensionPairingDeliveryKind.Rejected };
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
      const admissionRequest: Parameters<
        typeof admit_companion_identity_status
      >[0] = {
        discovery: protocolDiscovery,
        status: response.status,
        observedAt: Date.now(),
      };
      admission = admit_companion_identity_status(admissionRequest);
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
  }: IdentityEnvelopeRequest): Promise<
    Result<{ envelope: string; nextNonce: string }, VaultStorageFailure>
  > {
    const runtimeAvailability = this.chromeRuntime();
    if (runtimeAvailability.kind === ChromeRuntimeAvailabilityKind.Unavailable)
      return Promise.resolve(
        err(
          new VaultStorageFailure(
            VaultStorageFailureKind.IdentityHandoffUnavailable,
          ),
        ),
      );
    const { runtime } = runtimeAvailability;
    return new Promise((resolve) => {
      try {
        runtime.sendMessage(request.extensionRuntimeId, message, (response) => {
          if (this.chromeRuntimeLastError(runtime)) {
            resolve(
              err(
                new VaultStorageFailure(
                  VaultStorageFailureKind.IdentityHandoffRejected,
                ),
              ),
            );
            return;
          }
          const decodedResponse = Effect.runSync(
            Effect.either(
              identityHandoffResponseDecoder.decode(response),
            ),
          );
          if (decodedResponse._tag === "Right") {
            const identityEnvelope = {
              envelope: decodedResponse.right.envelope,
              nextNonce: decodedResponse.right.nextNonce,
            };
            resolve(ok(identityEnvelope));
            return;
          }
          resolve(
            err(
              new VaultStorageFailure(
                VaultStorageFailureKind.IdentityHandoffRejected,
              ),
            ),
          );
        });
      } catch {
        resolve(
          err(
            new VaultStorageFailure(
              VaultStorageFailureKind.IdentityHandoffUnavailable,
            ),
          ),
        );
      }
    });
  }

  async adoptExtensionIdentity({
    manager,
    request,
  }: ExtensionIdentityAdoption): Promise<
    Result<NookAdoptedExtensionIdentityHandoff, VaultStorageFailure>
  > {
    if (request.source === ExtensionIdentityRequestSource.PairedVault) {
      const begin: CompanionWebsiteHandoffBegin = {
        transaction: request.protocolTransaction,
        context: { kind: "paired-vault", vault_store_id: request.vaultStoreId },
      };
      let handoff: ReturnType<typeof manager.begin_companion_identity_handoff>;
      try {
        handoff = manager.begin_companion_identity_handoff(begin);
      } catch (failure) {
        return err(new NativeVaultStorageFailure(failure));
      }
      let consumed = false;
      try {
        let payload: ExtensionPairedVaultIdentityHandoffRequestMessage["payload"];
        try {
          payload = handoff.request;
        } catch (failure) {
          return err(new NativeVaultStorageFailure(failure));
        }
        const message: ExtensionPairedVaultIdentityHandoffRequestMessage = {
          type: ExtensionPairedVaultIdentityHandoffRequestMessageType.NookExtensionPairedVaultIdentityHandoffRequest,
          payload,
        };
        const sendArgs: ExtensionMessageRequest = {
          extensionId: request.extensionRuntimeId,
          message,
          responseWait: {
            kind: ExtensionMessageResponseWaitKind.Bounded,
            timeoutMs: EXTENSION_MESSAGE_TIMEOUT_MS,
          },
        };
        const delivery = await this.sendExtensionMessage(sendArgs);
        if (
          delivery.kind !== ExtensionMessageDeliveryKind.Received ||
          !delivery.response ||
          typeof delivery.response !== "object" ||
          !("ok" in delivery.response) ||
          delivery.response.ok !== true ||
          !("response" in delivery.response)
        )
          return err(
            new VaultStorageFailure(
              VaultStorageFailureKind.IdentityHandoffRejected,
            ),
          );
        let admission: ReturnType<typeof admit_companion_handoff_response>;
        try {
          admission = admit_companion_handoff_response(
            delivery.response.response,
          );
        } catch (failure) {
          return err(new NativeVaultStorageFailure(failure));
        }
        if (admission.kind !== "accepted")
          return err(
            new VaultStorageFailure(
              VaultStorageFailureKind.IdentityHandoffRejected,
            ),
          );
        consumed = true;
        try {
          return ok(await handoff.finish(manager, admission.response));
        } catch (failure) {
          return err(new NativeVaultStorageFailure(failure));
        }
      } finally {
        if (!consumed) {
          try {
            handoff.cancel(manager);
          } catch {
            // eslint-disable-next-line no-unsafe-finally -- Existing cleanup-result precedence is preserved.
            return err(
              new VaultStorageFailure(
                VaultStorageFailureKind.IdentityHandoffCleanupFailed,
              ),
            );
          }
        }
      }
    }
    let pending: ReturnType<typeof manager.begin_extension_identity_handoff>;
    try {
      pending = manager.begin_extension_identity_handoff();
    } catch (failure) {
      return err(new NativeVaultStorageFailure(failure));
    }
    let consumed = false;
    try {
      let recipientPublicKey: string;
      try {
        recipientPublicKey = pending.recipient_public_key;
      } catch (failure) {
        return err(new NativeVaultStorageFailure(failure));
      }
      const nonce = request.nonce;
      const message: ExtensionIdentityHandoffRequestMessage = {
        type: ExtensionIdentityHandoffRequestMessageType.NookExtensionIdentityHandoffRequest,
        payload: {
          recipientPublicKey,
          nonce,
          expectedDeviceId: request.deviceId,
          expectedDevicePublicKey: request.devicePublicKey,
          expectedDeviceSigningPublicKey: request.deviceSigningPublicKey,
        },
      };
      const identityEnvelopeRequest: IdentityEnvelopeRequest = {
        request,
        message,
      };
      const delivered = await this.requestIdentityEnvelope(
        identityEnvelopeRequest,
      );
      if (delivered.isErr()) return err(delivered.error);
      let context: ReturnType<
        typeof NookExtensionIdentityHandoffContext.vault_creation
      >;
      try {
        context = NookExtensionIdentityHandoffContext.vault_creation();
      } catch (failure) {
        return err(new NativeVaultStorageFailure(failure));
      }
      consumed = true;
      let adopted: NookAdoptedExtensionIdentityHandoff;
      try {
        adopted = await pending.finish(
          manager,
          delivered.value.envelope,
          nonce,
          request.deviceId,
          request.devicePublicKey,
          request.deviceSigningPublicKey,
          context,
        );
      } catch (failure) {
        return err(new NativeVaultStorageFailure(failure));
      } finally {
        context.free();
      }
      request.nonce = delivered.value.nextNonce;
      return ok(adopted);
    } finally {
      if (!consumed) {
        try {
          pending.cancel(manager);
        } catch {
          // eslint-disable-next-line no-unsafe-finally -- Existing cleanup-result precedence is preserved.
          return err(
            new VaultStorageFailure(
              VaultStorageFailureKind.IdentityHandoffCleanupFailed,
            ),
          );
        }
      }
    }
  }
}

export const extensionConnectionBrowser = new ExtensionConnectionBrowser(
  globalThis,
);
