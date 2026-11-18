import { err, ok, type Result } from "neverthrow";
import type { NookEncryptedSearchCatalogHint } from "../vault-app/lib/nook-wasm/nook_wasm";
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
  readonly catalogHint: NookEncryptedSearchCatalogHint;
};

export enum ExtensionPublicationFailure {
  BrowserDelivery = "browser-delivery",
}

export enum ExtensionPublicationOutcome {
  NotRequired = "not-required",
  Published = "published",
}

/** Owns this browser host’s resources and interaction lifecycle. */
class ExtensionEventLogPublisher {
  constructor(private readonly browser: typeof globalThis) {}

  publishExtensionEventLogUpdate({
    vaultStoreId,
    eventLogRecords,
    catalogHint,
  }: PublishExtensionEventLogUpdateArgs): Result<
    ExtensionPublicationOutcome,
    ExtensionPublicationFailure
  > {
    if (!("window" in this.browser) || eventLogRecords.length === 0)
      return ok(ExtensionPublicationOutcome.NotRequired);
    const message: ExtensionLocalEventLogUpdatedMessage = {
      type: ExtensionLocalEventLogUpdatedMessageType.NookExtensionLocalEventLogUpdated,
      payload: { vaultStoreId, eventLogRecords },
    };
    switch (catalogHint.kind) {
      case "absent":
        break;
      case "sealed":
        message.payload.encryptedSearchCatalog = catalogHint.encoded;
        break;
    }
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
