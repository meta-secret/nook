import type { ExtensionEventLogRecord } from "./lifecycle-runtime-messages";

/** One vault of the keyring, with its event records. */
export type ExtensionKeyringVault = {
  readonly storeId: string;
  readonly eventLogRecords: ExtensionEventLogRecord[];
};
