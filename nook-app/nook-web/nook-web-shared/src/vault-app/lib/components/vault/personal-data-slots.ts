import type {
  AddressView,
  DomesticAccountView,
  IdentityDocumentView,
  InternationalAccountView,
  PersonalDataView,
  PersonView,
} from "$app-wasm";
import type { NookSecretListItem } from "$lib/nook";
import type { TranslationRequest } from "$lib/vault/translation";
import { SecretType } from "$lib/nook";
import { I18N_KEYS } from "../../../../generated/i18n-keys";
import {
  documentIssuerLabelKey,
  documentKindLabelKey,
} from "../add-secret/personal-data-fields";
import {
  ClipboardNoticeKind,
  SecretRevealKind,
  type ClipboardNotice,
  type SecretReveal,
} from "../secret-vault-state";
import type { SecretFieldCopy } from "./secret-detail-copies";
import {
  NO_SLOT_COPY,
  SlotCopyKind,
  SlotSeal,
  SlotWidth,
  type SlotCopy,
} from "./secret-slot";

/** Whether a sealed slot may show Rust's masked tail instead of a plain mask. */
enum SlotMasking {
  Plain = "plain",
  MaskedTail = "masked-tail",
}

type SlotSpec<View> = {
  readonly labelKey: string;
  readonly testId: string;
  readonly width: SlotWidth;
  readonly masking: SlotMasking;
  readonly read: (view: View) => string;
};

export type PersonalDataSlotsContext = {
  readonly item: NookSecretListItem;
  readonly reveal: SecretReveal;
  readonly notice: ClipboardNotice;
  readonly translate: (request: TranslationRequest) => string;
  readonly copyField: (request: SecretFieldCopy) => Promise<void>;
};

/** One rendered field slot of a personal-data detail sheet. */
export type PersonalDataSlot = {
  readonly testId: string;
  readonly label: string;
  readonly value: string;
  readonly seal: SlotSeal;
  readonly width: SlotWidth;
  readonly copy: SlotCopy;
};

const MASK = "••••••••";

/** Defaults every slot spec spreads before naming what differs. */
const SLOT_DEFAULTS = {
  width: SlotWidth.Half,
  masking: SlotMasking.Plain,
} as const satisfies Pick<SlotSpec<never>, "width" | "masking">;

/** A slot spec paired with the revealed text it shows. */
type OpenSlotRequest = {
  readonly spec: Omit<SlotSpec<never>, "read">;
  readonly text: string;
};

type SlotCopyRequest = {
  readonly field: string;
  readonly label: string;
  readonly text: string;
};

const PERSON_SLOTS: readonly SlotSpec<PersonView>[] = [
  {
    ...SLOT_DEFAULTS,
    labelKey: I18N_KEYS.VaultFieldsFullName,
    testId: "person-full-name",
    width: SlotWidth.Full,
    read: (view) => view.fullName,
  },
  {
    ...SLOT_DEFAULTS,
    labelKey: I18N_KEYS.VaultFieldsEmail,
    testId: "person-email",
    read: (view) => view.email,
  },
  {
    ...SLOT_DEFAULTS,
    labelKey: I18N_KEYS.VaultFieldsMobilePhone,
    testId: "person-mobile-phone",
    read: (view) => view.mobilePhone,
  },
  {
    ...SLOT_DEFAULTS,
    labelKey: I18N_KEYS.VaultFieldsHomePhone,
    testId: "person-home-phone",
    read: (view) => view.homePhone,
  },
  {
    ...SLOT_DEFAULTS,
    labelKey: I18N_KEYS.VaultFieldsWorkPhone,
    testId: "person-work-phone",
    read: (view) => view.workPhone,
  },
  {
    ...SLOT_DEFAULTS,
    labelKey: I18N_KEYS.VaultFieldsBirthDate,
    testId: "person-birth-date",
    read: (view) => view.birthDate,
  },
];

const ADDRESS_SLOTS: readonly SlotSpec<AddressView>[] = [
  {
    ...SLOT_DEFAULTS,
    labelKey: I18N_KEYS.VaultFieldsAddressLine1,
    testId: "address-line1",
    width: SlotWidth.Full,
    read: (view) => view.addressLine1,
  },
  {
    ...SLOT_DEFAULTS,
    labelKey: I18N_KEYS.VaultFieldsAddressLine2,
    testId: "address-line2",
    width: SlotWidth.Full,
    read: (view) => view.addressLine2,
  },
  {
    ...SLOT_DEFAULTS,
    labelKey: I18N_KEYS.VaultFieldsCity,
    testId: "address-city",
    read: (view) => view.city,
  },
  {
    ...SLOT_DEFAULTS,
    labelKey: I18N_KEYS.VaultFieldsRegion,
    testId: "address-region",
    read: (view) => view.region,
  },
  {
    ...SLOT_DEFAULTS,
    labelKey: I18N_KEYS.VaultFieldsPostalCode,
    testId: "address-postal-code",
    read: (view) => view.postalCode,
  },
  {
    ...SLOT_DEFAULTS,
    labelKey: I18N_KEYS.VaultFieldsCountry,
    testId: "address-country",
    read: (view) => view.country,
  },
];

const INTERNATIONAL_ACCOUNT_SLOTS: readonly SlotSpec<InternationalAccountView>[] =
  [
    {
      ...SLOT_DEFAULTS,
      labelKey: I18N_KEYS.VaultFieldsIban,
      testId: "international-account-iban",
      width: SlotWidth.Full,
      read: (view) => view.iban,
    },
    {
      ...SLOT_DEFAULTS,
      labelKey: I18N_KEYS.VaultFieldsSwiftBic,
      testId: "international-account-swift-bic",
      read: (view) => view.swiftBic,
    },
    {
      ...SLOT_DEFAULTS,
      labelKey: I18N_KEYS.VaultFieldsAccountHolder,
      testId: "international-account-holder",
      read: (view) => view.accountHolder,
    },
    {
      ...SLOT_DEFAULTS,
      labelKey: I18N_KEYS.VaultFieldsBankName,
      testId: "international-account-bank-name",
      read: (view) => view.bankName,
    },
  ];

const DOMESTIC_ACCOUNT_SLOTS: readonly SlotSpec<DomesticAccountView>[] = [
  {
    ...SLOT_DEFAULTS,
    labelKey: I18N_KEYS.VaultFieldsAccountNumber,
    testId: "domestic-account-number",
    width: SlotWidth.Full,
    read: (view) => view.accountNumber,
  },
  {
    ...SLOT_DEFAULTS,
    labelKey: I18N_KEYS.VaultFieldsRoutingNumber,
    testId: "domestic-account-routing-number",
    read: (view) => view.routingNumber,
  },
  {
    ...SLOT_DEFAULTS,
    labelKey: I18N_KEYS.VaultFieldsAccountHolder,
    testId: "domestic-account-holder",
    read: (view) => view.accountHolder,
  },
  {
    ...SLOT_DEFAULTS,
    labelKey: I18N_KEYS.VaultFieldsBankName,
    testId: "domestic-account-bank-name",
    read: (view) => view.bankName,
  },
];

/**
 * Field slots for a person, address, identity document or bank account. Every
 * value stays sealed until the item is revealed; the document number shows
 * only Rust's masked tail before that. Account rows already show Rust's
 * masked summary, so the IBAN and account-number slots stay fully sealed.
 */
export class PersonalDataSlots {
  constructor(private readonly context: PersonalDataSlotsContext) {}

  get slots(): readonly PersonalDataSlot[] {
    const { reveal } = this.context;
    switch (reveal.kind) {
      case SecretRevealKind.Hidden:
        return this.sealed();
      case SecretRevealKind.Revealed:
        return this.revealed(reveal.record.personalData);
    }
  }

  /** Document slots; the issuer label follows the kind once it is known. */
  private documentSlots(
    issuerLabelKey: string,
  ): readonly SlotSpec<IdentityDocumentView>[] {
    return [
      {
        ...SLOT_DEFAULTS,
        labelKey: I18N_KEYS.VaultFieldsDocumentNumber,
        testId: "identity-document-number",
        width: SlotWidth.Full,
        masking: SlotMasking.MaskedTail,
        read: (view) => view.number,
      },
      {
        ...SLOT_DEFAULTS,
        labelKey: I18N_KEYS.VaultFieldsDocumentKind,
        testId: "identity-document-kind",
        read: (view) =>
          this.context.translate(documentKindLabelKey(view.documentKind)),
      },
      {
        ...SLOT_DEFAULTS,
        labelKey: I18N_KEYS.VaultFieldsNameAsPrinted,
        testId: "identity-document-name",
        read: (view) => view.nameAsPrinted,
      },
      {
        ...SLOT_DEFAULTS,
        labelKey: issuerLabelKey,
        testId: "identity-document-issuer",
        read: (view) => view.issuer,
      },
      {
        ...SLOT_DEFAULTS,
        labelKey: I18N_KEYS.VaultFieldsIssuingCountry,
        testId: "identity-document-country",
        read: (view) => view.issuingCountry,
      },
      {
        ...SLOT_DEFAULTS,
        labelKey: I18N_KEYS.VaultFieldsIssueDate,
        testId: "identity-document-issue-date",
        read: (view) => view.issueDate,
      },
      {
        ...SLOT_DEFAULTS,
        labelKey: I18N_KEYS.VaultFieldsExpiryDate,
        testId: "identity-document-expiry-date",
        read: (view) => view.expiryDate,
      },
    ];
  }

  private sealed(): readonly PersonalDataSlot[] {
    return this.sealedSpecs().map((spec) => ({
      testId: spec.testId,
      label: this.context.translate(spec.labelKey),
      value: this.sealedValue(spec.masking),
      seal: SlotSeal.Sealed,
      width: spec.width,
      copy: NO_SLOT_COPY,
    }));
  }

  private sealedSpecs(): readonly Omit<SlotSpec<never>, "read">[] {
    switch (this.context.item.type) {
      case SecretType.Person:
        return PERSON_SLOTS;
      case SecretType.Address:
        return ADDRESS_SLOTS;
      case SecretType.IdentityDocument:
        return this.documentSlots(I18N_KEYS.VaultFieldsDocumentIssuer);
      case SecretType.InternationalAccount:
        return INTERNATIONAL_ACCOUNT_SLOTS;
      case SecretType.DomesticAccount:
        return DOMESTIC_ACCOUNT_SLOTS;
      case SecretType.Login:
      case SecretType.ApiKey:
      case SecretType.SeedPhrase:
      case SecretType.SecureNote:
      case SecretType.Passkey:
      case SecretType.Authenticator:
      case SecretType.CreditCard:
      case SecretType.FileAttachment:
        return [];
    }
  }

  private sealedValue(masking: SlotMasking): string {
    switch (masking) {
      case SlotMasking.Plain:
        return MASK;
      case SlotMasking.MaskedTail:
        return this.context.item.summary.trim() || MASK;
    }
  }

  private revealed(view: PersonalDataView): readonly PersonalDataSlot[] {
    switch (view.kind) {
      case "person":
        return PERSON_SLOTS.map((spec) => {
          const request: OpenSlotRequest = { spec, text: spec.read(view) };
          return this.open(request);
        });
      case "address":
        return ADDRESS_SLOTS.map((spec) => {
          const request: OpenSlotRequest = { spec, text: spec.read(view) };
          return this.open(request);
        });
      case "identity-document":
        return this.documentSlots(
          documentIssuerLabelKey(view.documentKind),
        ).map((spec) => {
          const request: OpenSlotRequest = { spec, text: spec.read(view) };
          return this.open(request);
        });
      case "international-account":
        return INTERNATIONAL_ACCOUNT_SLOTS.map((spec) => {
          const request: OpenSlotRequest = { spec, text: spec.read(view) };
          return this.open(request);
        });
      case "domestic-account":
        return DOMESTIC_ACCOUNT_SLOTS.map((spec) => {
          const request: OpenSlotRequest = { spec, text: spec.read(view) };
          return this.open(request);
        });
    }
  }

  private open({ spec, text }: OpenSlotRequest): PersonalDataSlot {
    const label = this.context.translate(spec.labelKey);
    const value = text.trim();
    const copyRequest: SlotCopyRequest = {
      field: spec.testId,
      label,
      text: value,
    };
    return {
      testId: spec.testId,
      label,
      value: value || this.context.translate(I18N_KEYS.CommonNone),
      seal: SlotSeal.Open,
      width: spec.width,
      copy: this.copy(copyRequest),
    };
  }

  private copy({ field, label, text }: SlotCopyRequest): SlotCopy {
    switch (text) {
      case "":
        return NO_SLOT_COPY;
      default: {
        const { item, notice } = this.context;
        const copied =
          notice.kind === ClipboardNoticeKind.Visible &&
          notice.fieldKey === `${item.id}-${field}`;
        const copyLabel: TranslationRequest = {
          key: I18N_KEYS.VaultCopyField,
          replacements: { field: label },
        };
        return {
          kind: SlotCopyKind.Available,
          label: this.context.translate(copyLabel),
          copied,
          onCopy: () => {
            const request: SecretFieldCopy = { text, id: item.id, field };
            void this.context.copyField(request);
          },
        };
      }
    }
  }
}
