import { Effect } from "effect";
import { err, ok, type Result } from "neverthrow";
import {
  VaultStorageFailure,
  VaultStorageFailureKind,
  NativeVaultStorageFailure,
} from "$lib/runtime/storage-failure";
import type { NookAdoptedExtensionIdentityHandoff } from "$app-wasm";
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

type ExtensionIdentityEnvelope = {
  readonly envelope: string;
  readonly nextNonce: string;
};

enum IdentityHandoffAttemptKind {
  Pending = "pending",
  Consumed = "consumed",
}

type IdentityHandoffAttempt = {
  readonly kind: IdentityHandoffAttemptKind;
  readonly outcome: Result<
    NookAdoptedExtensionIdentityHandoff,
    VaultStorageFailure
  >;
};

type PairedIdentityAdoptionAttempt = ExtensionIdentityAdoption & {
  readonly request: Extract<
    ExtensionConnectRequest,
    { source: ExtensionIdentityRequestSource.PairedVault }
  >;
  readonly handoff: ReturnType<
    NookVaultManager["begin_companion_identity_handoff"]
  >;
};

type NewIdentityAdoptionAttempt = ExtensionIdentityAdoption & {
  readonly request: Extract<
    ExtensionConnectRequest,
    { source: ExtensionIdentityRequestSource.ExtensionConnect }
  >;
  readonly pending: ReturnType<
    NookVaultManager["begin_extension_identity_handoff"]
  >;
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
import { ExtensionConnectScope } from "$web-shared/extension/extension-connect-scope";
import {
  ExtensionPairingDeliveryKind,
  type ExtensionPairingDelivery,
} from "./extension-pairing-delivery";
import {
  companionResponseDecoder,
  identityHandoffResponseDecoder,
  pairingApprovalResponseDecoder,
} from "./extension-response-decoders";
import {
  EXTENSION_MESSAGE_TIMEOUT_MS,
  ExtensionMessageChannel,
  ExtensionMessageDeliveryKind,
  ExtensionMessageResponseWaitKind,
  type ChromeExtensionRuntimeResponse,
  type ExtensionBrowserHost,
  type ExtensionMessageDelivery,
  type ExtensionMessageRequest,
} from "./extension-message-channel";

export const EXTENSION_CONNECT_PATH = "/extension-connect";

export { ExtensionConnectScope, ExtensionIdentityRequestSource };
export {
  ExtensionPairingDeliveryKind,
  ExtensionPairingRejectionReason,
  type ExtensionPairingDelivery,
} from "./extension-pairing-delivery";
export {
  AcceptedIdentityHandoffResponseSchema,
  companionResponseDecoder,
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

const PAIRED_IDENTITY_UNAVAILABLE_RETRY_MS = 150;

/** Owns this browser host’s resources and interaction lifecycle. */
class ExtensionConnectionBrowser {
  private readonly messageChannel: ExtensionMessageChannel;

  constructor(private readonly browser: ExtensionBrowserHost) {
    this.messageChannel = new ExtensionMessageChannel(browser);
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
    const sendArgs: Parameters<ExtensionMessageChannel["send"]>[0] = {
      extensionId: request.extensionRuntimeId,
      message,
      responseWait: { kind: ExtensionMessageResponseWaitKind.BrowserChannel },
    };
    const delivery = await this.messageChannel.send(sendArgs);
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
      ExtensionMessageChannel["send"]
    >[0] = {
      extensionId: installedExtension.extensionRuntimeId,
      message,
      responseWait: {
        kind: ExtensionMessageResponseWaitKind.Bounded,
        timeoutMs: EXTENSION_MESSAGE_TIMEOUT_MS,
      },
    };
    const delivery = await this.messageChannel.send(sendExtensionMessageArgs);
    if (delivery.kind !== ExtensionMessageDeliveryKind.Received) return false;
    const decoded = Effect.runSync(
      Effect.either(companionResponseDecoder.decodeLauncher(delivery.response)),
    );
    return decoded._tag === "Right";
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
      ExtensionMessageChannel["send"]
    >[0] = {
      extensionId: installedExtension.extensionRuntimeId,
      message,
      responseWait: {
        kind: ExtensionMessageResponseWaitKind.Bounded,
        timeoutMs: EXTENSION_MESSAGE_TIMEOUT_MS,
      },
    };
    const delivery = await this.messageChannel.send(sendExtensionMessageArgs2);
    if (delivery.kind !== ExtensionMessageDeliveryKind.Received)
      return delivery;
    const decoded = Effect.runSync(
      Effect.either(
        companionResponseDecoder.decodeIdentityDiscovery(delivery.response),
      ),
    );
    if (decoded._tag === "Left") {
      return { kind: ExtensionMessageDeliveryKind.Unavailable };
    }
    let admission: ReturnType<typeof admit_companion_identity_status>;
    try {
      const admissionRequest: Parameters<
        typeof admit_companion_identity_status
      >[0] = {
        discovery: protocolDiscovery,
        status: decoded.right.status,
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
      ExtensionMessageChannel["send"]
    >[0] = {
      extensionId: installedExtension.extensionRuntimeId,
      message,
      responseWait: {
        kind: ExtensionMessageResponseWaitKind.Bounded,
        timeoutMs: EXTENSION_MESSAGE_TIMEOUT_MS,
      },
    };
    const delivery = await this.messageChannel.send(sendExtensionMessageArgs3);
    if (delivery.kind !== ExtensionMessageDeliveryKind.Received) return false;
    const decoded = Effect.runSync(
      Effect.either(companionResponseDecoder.decodeUnlock(delivery.response)),
    );
    return (
      decoded._tag === "Right" &&
      decoded.right.requestId === unlockRequestId &&
      decoded.right.vaultStoreId === vaultStoreId
    );
  }

  private requestIdentityEnvelope({
    request,
    message,
  }: IdentityEnvelopeRequest): Promise<
    Result<ExtensionIdentityEnvelope, VaultStorageFailure>
  > {
    const sendArgs: ExtensionMessageRequest = {
      extensionId: request.extensionRuntimeId,
      message,
      responseWait: { kind: ExtensionMessageResponseWaitKind.BrowserChannel },
    };
    return this.messageChannel.send(sendArgs).then(
      (delivery) => {
        if (delivery.kind !== ExtensionMessageDeliveryKind.Received)
          return err(
            new VaultStorageFailure(
              VaultStorageFailureKind.IdentityHandoffUnavailable,
            ),
          );
        const decodedResponse = Effect.runSync(
          Effect.either(
            identityHandoffResponseDecoder.decode(delivery.response),
          ),
        );
        if (decodedResponse._tag === "Right") {
          const identityEnvelope: ExtensionIdentityEnvelope = {
            envelope: decodedResponse.right.envelope,
            nextNonce: decodedResponse.right.nextNonce,
          };
          return ok(identityEnvelope);
        }
        return err(
          new VaultStorageFailure(
            VaultStorageFailureKind.IdentityHandoffRejected,
          ),
        );
      },
      () =>
        err(
          new VaultStorageFailure(
            VaultStorageFailureKind.IdentityHandoffUnavailable,
          ),
        ),
    );
  }

  private async completePairedIdentityAdoption({
    manager,
    request,
    handoff,
  }: PairedIdentityAdoptionAttempt): Promise<IdentityHandoffAttempt> {
    let payload: ExtensionPairedVaultIdentityHandoffRequestMessage["payload"];
    try {
      payload = handoff.request;
    } catch (failure) {
      return {
        kind: IdentityHandoffAttemptKind.Pending,
        outcome: err(new NativeVaultStorageFailure(failure)),
      };
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
    let delivery: ExtensionMessageDelivery;
    try {
      delivery = await this.messageChannel.send(sendArgs);
    } catch (failure) {
      return {
        kind: IdentityHandoffAttemptKind.Pending,
        outcome: err(new NativeVaultStorageFailure(failure)),
      };
    }
    if (delivery.kind !== ExtensionMessageDeliveryKind.Received)
      return {
        kind: IdentityHandoffAttemptKind.Pending,
        outcome: err(
          new VaultStorageFailure(
            VaultStorageFailureKind.IdentityHandoffRejected,
          ),
        ),
      };
    const decoded = Effect.runSync(
      Effect.either(
        companionResponseDecoder.decodeIdentityHandoff(delivery.response),
      ),
    );
    if (decoded._tag === "Left")
      return {
        kind: IdentityHandoffAttemptKind.Pending,
        outcome: err(
          new VaultStorageFailure(
            VaultStorageFailureKind.IdentityHandoffRejected,
          ),
        ),
      };
    let admission: ReturnType<typeof admit_companion_handoff_response>;
    try {
      admission = admit_companion_handoff_response(decoded.right.response);
    } catch (failure) {
      return {
        kind: IdentityHandoffAttemptKind.Pending,
        outcome: err(new NativeVaultStorageFailure(failure)),
      };
    }
    if (admission.kind !== "accepted")
      return {
        kind: IdentityHandoffAttemptKind.Pending,
        outcome: err(
          new VaultStorageFailure(
            VaultStorageFailureKind.IdentityHandoffRejected,
          ),
        ),
      };
    try {
      return {
        kind: IdentityHandoffAttemptKind.Consumed,
        outcome: ok(await handoff.finish(manager, admission.response)),
      };
    } catch (failure) {
      return {
        kind: IdentityHandoffAttemptKind.Consumed,
        outcome: err(new NativeVaultStorageFailure(failure)),
      };
    }
  }

  private async completeNewIdentityAdoption({
    manager,
    request,
    pending,
  }: NewIdentityAdoptionAttempt): Promise<IdentityHandoffAttempt> {
    let recipientPublicKey: string;
    try {
      recipientPublicKey = pending.recipient_public_key;
    } catch (failure) {
      return {
        kind: IdentityHandoffAttemptKind.Pending,
        outcome: err(new NativeVaultStorageFailure(failure)),
      };
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
    if (delivered.isErr())
      return {
        kind: IdentityHandoffAttemptKind.Pending,
        outcome: err(delivered.error),
      };
    let context: ReturnType<
      typeof NookExtensionIdentityHandoffContext.vault_creation
    >;
    try {
      context = NookExtensionIdentityHandoffContext.vault_creation();
    } catch (failure) {
      return {
        kind: IdentityHandoffAttemptKind.Pending,
        outcome: err(new NativeVaultStorageFailure(failure)),
      };
    }
    let outcome: IdentityHandoffAttempt["outcome"];
    try {
      const adopted = await pending.finish(
        manager,
        delivered.value.envelope,
        nonce,
        request.deviceId,
        request.devicePublicKey,
        request.deviceSigningPublicKey,
        context,
      );
      request.nonce = delivered.value.nextNonce;
      outcome = ok(adopted);
    } catch (failure) {
      outcome = err(new NativeVaultStorageFailure(failure));
    } finally {
      context.free();
    }
    return { kind: IdentityHandoffAttemptKind.Consumed, outcome };
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
        context: {
          kind: "paired-vault",
          vault_store_id: request.vaultStoreId,
        },
      };
      let handoff: ReturnType<typeof manager.begin_companion_identity_handoff>;
      try {
        handoff = manager.begin_companion_identity_handoff(begin);
      } catch (failure) {
        return err(new NativeVaultStorageFailure(failure));
      }
      const pairedIdentityAdoptionAttempt: PairedIdentityAdoptionAttempt = {
        manager,
        request,
        handoff,
      };
      const attempt = await this.completePairedIdentityAdoption(
        pairedIdentityAdoptionAttempt,
      );
      if (attempt.kind === IdentityHandoffAttemptKind.Pending) {
        try {
          handoff.cancel(manager);
        } catch {
          return err(
            new VaultStorageFailure(
              VaultStorageFailureKind.IdentityHandoffCleanupFailed,
            ),
          );
        }
      }
      return attempt.outcome;
    }
    let pending: ReturnType<typeof manager.begin_extension_identity_handoff>;
    try {
      pending = manager.begin_extension_identity_handoff();
    } catch (failure) {
      return err(new NativeVaultStorageFailure(failure));
    }
    const newIdentityAdoptionAttempt: NewIdentityAdoptionAttempt = {
      manager,
      request,
      pending,
    };
    const attempt = await this.completeNewIdentityAdoption(
      newIdentityAdoptionAttempt,
    );
    if (attempt.kind === IdentityHandoffAttemptKind.Pending) {
      try {
        pending.cancel(manager);
      } catch {
        return err(
          new VaultStorageFailure(
            VaultStorageFailureKind.IdentityHandoffCleanupFailed,
          ),
        );
      }
    }
    return attempt.outcome;
  }
}

export const extensionConnectionBrowser = new ExtensionConnectionBrowser(
  globalThis,
);
