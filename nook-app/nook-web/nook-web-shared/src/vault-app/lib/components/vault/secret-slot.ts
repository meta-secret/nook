/** How a field slot shows its value: plain text, a sealed secret, or a revealed one. */
export enum SlotSeal {
  Plain = "plain",
  Sealed = "sealed",
  Open = "open",
}

/** Slots sit two to a row on wide detail sheets; long values take the full row. */
export enum SlotWidth {
  Half = "half",
  Full = "full",
}

export enum SlotCopyKind {
  Unavailable = "unavailable",
  Available = "available",
}

export type SlotCopy =
  | { readonly kind: SlotCopyKind.Unavailable }
  | {
      readonly kind: SlotCopyKind.Available;
      readonly label: string;
      readonly copied: boolean;
      readonly onCopy: () => void;
    };

export const NO_SLOT_COPY: SlotCopy = { kind: SlotCopyKind.Unavailable };

/** The seal for a secret field given whether its item is revealed. */
export class SecretSlotSeal {
  constructor(private readonly revealed: boolean) {}

  get seal(): SlotSeal {
    return this.revealed ? SlotSeal.Open : SlotSeal.Sealed;
  }
}
