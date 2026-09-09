import { err, ok, type Result } from 'neverthrow'
import {
  ExtensionLocalEventLogUpdatedMessageType,
  type ExtensionEventLogRecord,
  type ExtensionLocalEventLogUpdatedMessage,
} from './lifecycle-runtime-messages'

/** Publish encrypted event-log records for the extension's isolated content
 * bridge. No private key or decrypted vault value crosses the page boundary. */

type PublishExtensionEventLogUpdateArgs = {
  readonly vaultStoreId: string
  readonly eventLogRecords: ExtensionEventLogRecord[]
}

export enum ExtensionPublicationFailure {
  BrowserDelivery = 'browser-delivery',
}

/** Owns this browser host’s resources and interaction lifecycle. */
class ExtensionEventLogPublisher {
  constructor(private readonly browser: typeof globalThis) {}

  publishExtensionEventLogUpdate({
    vaultStoreId,
    eventLogRecords,
  }: PublishExtensionEventLogUpdateArgs): Result<void, ExtensionPublicationFailure> {
    if (!('window' in this.browser) || eventLogRecords.length === 0)
      return ok(undefined)
    const message: ExtensionLocalEventLogUpdatedMessage = {
      type: ExtensionLocalEventLogUpdatedMessageType.NookExtensionLocalEventLogUpdated,
      payload: { vaultStoreId, eventLogRecords },
    }
    try {
      this.browser.window.postMessage(message, this.browser.window.location.origin)
      return ok(undefined)
    } catch {
      return err(ExtensionPublicationFailure.BrowserDelivery)
    }
  }
}

export const extensionEventLogPublisher = new ExtensionEventLogPublisher(globalThis)
