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

/** Owns this browser host’s resources and interaction lifecycle. */
class ExtensionEventLogPublisher {
  constructor(private readonly browser: typeof globalThis) {}

  publishExtensionEventLogUpdate({
    vaultStoreId,
    eventLogRecords,
  }: PublishExtensionEventLogUpdateArgs): void {
    if (!("window" in this.browser) || eventLogRecords.length === 0) return;
    const message: ExtensionLocalEventLogUpdatedMessage = {
      type: ExtensionLocalEventLogUpdatedMessageType.NookExtensionLocalEventLogUpdated,
      payload: { vaultStoreId, eventLogRecords },
    };
    this.browser.window.postMessage(
      message,
      this.browser.window.location.origin,
    );
  }
}

export const extensionEventLogPublisher = new ExtensionEventLogPublisher(
  globalThis,
);
