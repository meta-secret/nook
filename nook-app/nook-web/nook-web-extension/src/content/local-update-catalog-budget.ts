import {
  ExtensionLocalEventLogUpdatedMessageType,
  type ExtensionLocalEventLogUpdatedMessage,
} from '../../../nook-web-shared/src/extension/lifecycle-runtime-messages'

const mebibyte = 1024 * 1024
// Chrome's JSON message limit and Rust's EncodedSearchCatalogHint::MAX_BYTES.
const maximumRuntimeMessageBytes = 64 * mebibyte
const maximumCatalogUtf8Bytes = 4 * mebibyte

const emptyLocalUpdateWithCatalog: ExtensionLocalEventLogUpdatedMessage = {
  type: ExtensionLocalEventLogUpdatedMessageType.NookExtensionLocalEventLogUpdated,
  payload: {
    vaultStoreId: '',
    eventLogRecords: [],
    encryptedSearchCatalog: '',
  },
}
const envelopeBytes = JSON.stringify(emptyLocalUpdateWithCatalog).length - 2

export type LocalUpdateCatalogMessageLengths = {
  readonly eventLogRecordsJsonCodeUnits: number
  readonly vaultStoreIdCodeUnits: number
  readonly catalogCodeUnits: number
}

export enum LocalUpdateCatalogBudgetKind {
  Fits = 'fits',
  Exceeds = 'exceeds',
}

export function localUpdateCatalogBudget({
  eventLogRecordsJsonCodeUnits,
  vaultStoreIdCodeUnits,
  catalogCodeUnits,
}: LocalUpdateCatalogMessageLengths): LocalUpdateCatalogBudgetKind {
  // The existing record snapshot is already JSON. Each of its UTF-16 code
  // units costs at most three UTF-8 bytes. Raw strings can also require
  // six-byte JSON escapes. The empty array's two bytes are excluded above.
  const messageByteUpperBound =
    envelopeBytes +
    3 * eventLogRecordsJsonCodeUnits +
    6 * (vaultStoreIdCodeUnits + catalogCodeUnits)
  // A larger code-unit count cannot meet Rust's UTF-8 limit. Rust checks the
  // exact byte count and validates the hint after transport.
  switch (true) {
    case catalogCodeUnits <= maximumCatalogUtf8Bytes &&
      messageByteUpperBound <= maximumRuntimeMessageBytes:
      return LocalUpdateCatalogBudgetKind.Fits
    case true:
    default:
      return LocalUpdateCatalogBudgetKind.Exceeds
  }
}
