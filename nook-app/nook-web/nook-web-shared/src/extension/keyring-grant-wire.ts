import type { ExtensionEventLogRecord } from "./lifecycle-runtime-messages";

export enum ExtensionKeyringGrantKind {
  /** The web app added the extension to this keyring, as an app with its
   * own key: the keyring's log and its other vaults come along. */
  Added = "added",
  /** One more vault of a keyring the extension already belongs to; there
   * is nothing to join. */
  Member = "member",
}

/** One more vault of the keyring, with its event records. */
export type ExtensionKeyringVault = {
  readonly storeId: string;
  readonly eventLogRecords: ExtensionEventLogRecord[];
};

/** Structural browser wire value carried beside a pairing approval; the
 * approval admission in `runtime-messages` decodes it. A web app always
 * sends `Added`, so the extension joins and opens the keyring's vaults with
 * no sync provider. */
export type ExtensionKeyringGrant =
  | {
      readonly kind: ExtensionKeyringGrantKind.Added;
      readonly identityId: string;
      readonly identityLabel: string;
      /** The keyring's control log, each event's stored text. */
      readonly identityEvents: string[];
      /** The keyring's vaults other than the approved one that this
       * browser holds; the rest arrive through its sync providers. */
      readonly vaults: ExtensionKeyringVault[];
    }
  | { readonly kind: ExtensionKeyringGrantKind.Member };
