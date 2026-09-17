import { err, ok, type Result } from "neverthrow";
import {
  ExtensionLocalEventLogUpdatedMessageType,
  type ExtensionEventLogRecord,
  type ExtensionLocalEventLogUpdatedMessage,
} from "./lifecycle-runtime-messages";

/** Publish encrypted event-log records for the extension's isolated content
 * bridge. No private key or decrypted vault value crosses the page boundary. */

type PublishExtensionEventLogUpdateArgs = {
  readonly vaultStoreId: string;
  readonly eventLogRecords: ExtensionEventLogRecord[];
};

export enum ExtensionPublicationFailure {
  BrowserDelivery = "browser-delivery",
}

export enum ExtensionPublicationOutcome {
  BrowserUnavailable = "browser-unavailable",
  NoRecords = "no-records",
  Published = "published",
}

/** Owns this browser host’s resources and interaction lifecycle. */
class ExtensionEventLogPublisher {
  constructor(private readonly browser: typeof globalThis) {}

  publishExtensionEventLogUpdate({
    vaultStoreId,
    eventLogRecords,
  }: PublishExtensionEventLogUpdateArgs): Result<
    ExtensionPublicationOutcome,
    ExtensionPublicationFailure
  > {
    if (!("window" in this.browser))
      return ok(ExtensionPublicationOutcome.BrowserUnavailable);
    if (eventLogRecords.length === 0)
      return ok(ExtensionPublicationOutcome.NoRecords);
    const message: ExtensionLocalEventLogUpdatedMessage = {
      type: ExtensionLocalEventLogUpdatedMessageType.NookExtensionLocalEventLogUpdated,
      payload: { vaultStoreId, eventLogRecords },
    };
    try {
      this.browser.window.postMessage(
        message,
        this.browser.window.location.origin,
      );
      return ok(ExtensionPublicationOutcome.Published);
    } catch {
      return err(ExtensionPublicationFailure.BrowserDelivery);
    }
  }
}

export const extensionEventLogPublisher = new ExtensionEventLogPublisher(
  globalThis,
);
