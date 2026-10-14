import { I18N_KEYS } from "../../../../generated/i18n-keys";
import {
  ClipboardNoticeKind,
  type ClipboardNotice,
} from "../secret-vault-state";
import { NO_SLOT_COPY, SlotCopyKind, type SlotCopy } from "./secret-slot";

/** Copyable plain fields of a secret; values are the clipboard field keys. */
export enum CopyField {
  Website = "website",
  Username = "username",
  Expires = "expires",
  AccountName = "name",
  Cardholder = "cardholder",
  CardNumber = "card-number",
  Expiration = "expiration",
  Cvv = "cvv",
  CurrentCode = "current-code",
}

const COPY_LABEL_KEYS: Readonly<Record<CopyField, string>> = {
  [CopyField.Website]: I18N_KEYS.VaultCopyWebsiteUrl,
  [CopyField.Username]: I18N_KEYS.VaultCopyUsername,
  [CopyField.Expires]: I18N_KEYS.VaultCopyExpirationDate,
  [CopyField.AccountName]: I18N_KEYS.VaultCopyAccountName,
  [CopyField.Cardholder]: I18N_KEYS.VaultCopyCardholderName,
  [CopyField.CardNumber]: I18N_KEYS.VaultCopyCardNumber,
  [CopyField.Expiration]: I18N_KEYS.VaultCopyExpiration,
  [CopyField.Cvv]: I18N_KEYS.VaultCopyCvv,
  [CopyField.CurrentCode]: I18N_KEYS.VaultCopyCurrentCode,
};

export type SecretFieldCopy = {
  readonly text: string;
  readonly id: string;
  readonly field: string;
};

export type DetailCopyContext = {
  readonly itemId: string;
  readonly texts: Readonly<Record<CopyField, string>>;
  readonly backupCodes: readonly string[];
  readonly notice: ClipboardNotice;
  readonly translate: (key: string) => string;
  readonly copyField: (request: SecretFieldCopy) => Promise<void>;
  readonly copySecret: (id: string) => Promise<void>;
};

/** Copy actions for the slots of one secret detail sheet. */
export class DetailCopies {
  constructor(private readonly context: DetailCopyContext) {}

  private copied(field: string): boolean {
    const { notice, itemId } = this.context;
    return (
      notice.kind === ClipboardNoticeKind.Visible &&
      notice.fieldKey === `${itemId}-${field}`
    );
  }

  field(field: CopyField): SlotCopy {
    const text = this.context.texts[field];
    if (!text) return NO_SLOT_COPY;
    return {
      kind: SlotCopyKind.Available,
      label: this.context.translate(COPY_LABEL_KEYS[field]),
      copied: this.copied(field),
      onCopy: () => {
        const request: SecretFieldCopy = {
          text,
          id: this.context.itemId,
          field,
        };
        void this.context.copyField(request);
      },
    };
  }

  backup(index: number): SlotCopy {
    const text = this.context.backupCodes[index];
    if (!text) return NO_SLOT_COPY;
    const field = `backup-${index}`;
    return {
      kind: SlotCopyKind.Available,
      label: this.context.translate(I18N_KEYS.VaultCopyBackupCode),
      copied: this.copied(field),
      onCopy: () => {
        const request: SecretFieldCopy = {
          text,
          id: this.context.itemId,
          field,
        };
        void this.context.copyField(request);
      },
    };
  }

  /** Copy the item's primary credential, decrypting it just for the copy. */
  secret(labelKey: string): SlotCopy {
    return {
      kind: SlotCopyKind.Available,
      label: this.context.translate(labelKey),
      copied: this.copied("secret"),
      onCopy: () => void this.context.copySecret(this.context.itemId),
    };
  }
}
