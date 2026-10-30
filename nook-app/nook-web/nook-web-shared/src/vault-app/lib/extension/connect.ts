import { Effect } from "effect";
import { ExtensionVaultEventLogChannel } from "./vault-event-log";
type ExtensionPairingApprovalDelivery = {
  readonly request: ExtensionConnectRequest;
  readonly message: ExtensionPairingApprovedMessage;
};
type AcknowledgedDelivery = {
  readonly extensionRuntimeId: string;
  readonly message: RuntimeMessage;
};

import { ApplicationPath } from "$lib/runtime/routes";
import type {
  ExtensionPairingApprovedMessage,
  RuntimeMessage,
} from "$web-shared/extension/runtime-messages";
import {
  ExtensionKeyringProvidersMessageType,
  type ExtensionKeyringProvidersMessage,
  type KeyringProvidersDelivery,
} from "$web-shared/extension/keyring-providers-message";
import type { ExtensionConnectRequestFor } from "$web-shared/extension/extension-connect-types";
import { ExtensionConnectScope } from "$web-shared/extension/extension-connect-scope";
import {
  ExtensionSidePanelSignalType,
  type ExtensionSidePanelSignal,
} from "$web-shared/extension/side-panel-signal-message";
import {
  ExtensionConnectFollowKind,
  type ExtensionConnectFollow,
} from "$web-shared/extension/extension-connect-progress";
import {
  ExtensionPairingDeliveryKind,
  type ExtensionPairingDelivery,
} from "./extension-pairing-delivery";
import {
  companionResponseDecoder,
  pairingApprovalResponseDecoder,
} from "./extension-response-decoders";
import {
  EXTENSION_MESSAGE_TIMEOUT_MS,
  ExtensionMessageChannel,
  ExtensionMessageDeliveryKind,
  ExtensionMessageResponseWaitKind,
  type ChromeExtensionRuntimeResponse,
  type ExtensionBrowserHost,
} from "./extension-message-channel";

export const EXTENSION_CONNECT_PATH = "/extension-connect";

export { ExtensionConnectScope };
export {
  ExtensionPairingDeliveryKind,
  ExtensionPairingRejectionReason,
} from "./extension-pairing-delivery";
export {
  companionResponseDecoder,
  pairingApprovalResponseDecoder,
} from "./extension-response-decoders";

export type ExtensionConnectRequest =
  ExtensionConnectRequestFor<ExtensionConnectScope>;

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
        Effect.result(ExtensionConnectScope.decode(scope)),
      );
      if (admitted._tag === "Success") admittedScopes.push(admitted.success);
    }
    return admittedScopes;
  }

  /** The connect id the starting extension page named; it only names the
   * progress port, so a URL without one still connects, unfollowed. */
  private parseFollow(params: URLSearchParams): ExtensionConnectFollow {
    const connectId = params.get("connect_id")?.trim();
    return connectId
      ? { kind: ExtensionConnectFollowKind.Named, connectId }
      : { kind: ExtensionConnectFollowKind.Unnamed };
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
    const scopes = this.parseScopes(params);

    if (
      !deviceId ||
      !devicePublicKey ||
      !deviceSigningPublicKey ||
      !extensionRuntimeId ||
      scopes.length === 0
    ) {
      return { kind: ExtensionConnectRequestStateKind.Absent };
    }

    return {
      kind: ExtensionConnectRequestStateKind.Requested,
      request: {
        follow: this.parseFollow(params),
        deviceId,
        devicePublicKey,
        deviceSigningPublicKey,
        extensionRuntimeId,
        deviceLabel,
        scopes,
      },
    };
  }

  readInstalledExtensionRuntimeId(): InstalledExtensionRuntime {
    const extensionRuntimeId = this.browser.document.documentElement
      .getAttribute(extensionRuntimeIdAttribute)
      ?.trim();
    return extensionRuntimeId
      ? { kind: InstalledExtensionRuntimeKind.Installed, extensionRuntimeId }
      : { kind: InstalledExtensionRuntimeKind.NotInstalled };
  }

  pullVaultEventLog(
    request: Parameters<ExtensionVaultEventLogChannel["pull"]>[0],
  ): ReturnType<ExtensionVaultEventLogChannel["pull"]> {
    return new ExtensionVaultEventLogChannel(this.browser).pull(request);
  }

  private pairingDeliveryFromResponse(
    response: ChromeExtensionRuntimeResponse,
  ): ExtensionPairingDelivery {
    const decoded = Effect.runSync(
      Effect.result(pairingApprovalResponseDecoder.decode(response)),
    );
    return decoded._tag === "Success"
      ? decoded.success
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

  /** Ask the installed extension to show its side panel in this window.
   * Answers whether the browser opened it. */
  async openExtensionSidePanel(): Promise<boolean> {
    const installedExtension = this.readInstalledExtensionRuntimeId();
    if (
      installedExtension.kind === InstalledExtensionRuntimeKind.NotInstalled
    ) {
      return false;
    }
    const message: ExtensionSidePanelSignal = {
      type: ExtensionSidePanelSignalType.NookOpenSidePanel,
    };
    const signal: AcknowledgedDelivery = {
      extensionRuntimeId: installedExtension.extensionRuntimeId,
      message,
    };
    return this.sendAcknowledged(signal);
  }

  /** Hand the installed extension the keyring's providers after they
   * changed. Answers whether it acknowledged them. */
  deliverKeyringProviders({
    extensionRuntimeId,
    shares,
  }: KeyringProvidersDelivery): Promise<boolean> {
    const message: ExtensionKeyringProvidersMessage = {
      type: ExtensionKeyringProvidersMessageType.NookExtensionKeyringProviders,
      payload: shares,
    };
    const delivery: AcknowledgedDelivery = { extensionRuntimeId, message };
    return this.sendAcknowledged(delivery);
  }

  /** Send a message the extension answers with a plain acknowledgement. */
  private async sendAcknowledged({
    extensionRuntimeId,
    message,
  }: AcknowledgedDelivery): Promise<boolean> {
    const sendArgs: Parameters<ExtensionMessageChannel["send"]>[0] = {
      extensionId: extensionRuntimeId,
      message,
      responseWait: {
        kind: ExtensionMessageResponseWaitKind.Bounded,
        timeoutMs: EXTENSION_MESSAGE_TIMEOUT_MS,
      },
    };
    const delivery = await this.messageChannel.send(sendArgs);
    if (delivery.kind !== ExtensionMessageDeliveryKind.Received) return false;
    const decoded = Effect.runSync(
      Effect.result(
        companionResponseDecoder.decodeAcknowledged(delivery.response),
      ),
    );
    return decoded._tag === "Success";
  }
}

export const extensionConnectionBrowser = new ExtensionConnectionBrowser(
  globalThis,
);
