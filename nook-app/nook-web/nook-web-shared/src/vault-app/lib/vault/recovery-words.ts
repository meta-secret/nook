import {
  complete_recovery_word,
  recovery_word_typing,
  type NookRecoveryWordsCheck,
  type RecoveryStrength,
} from "$app-wasm";
import type { VaultState } from "$lib/vault.svelte";
import { I18N_KEYS } from "../../../generated/i18n-keys";

/** Typed recovery words Rust refused, as it reported them. */
export type RecoveryWordsRefusal = Exclude<
  NookRecoveryWordsCheck,
  { readonly state: "accepted" }
>;

export enum RecoveryWordsOutcomeKind {
  Accepted = "accepted",
  Refused = "refused",
}

/** What Rust did with typed recovery words. */
export type RecoveryWordsOutcome =
  | { readonly kind: RecoveryWordsOutcomeKind.Accepted }
  | {
      readonly kind: RecoveryWordsOutcomeKind.Refused;
      readonly refusal: RecoveryWordsRefusal;
    };

/** Split Rust's check into accepted words and a refusal to show. */
export function recoveryWordsOutcome(
  check: NookRecoveryWordsCheck,
): RecoveryWordsOutcome {
  switch (check.state) {
    case "accepted":
      return { kind: RecoveryWordsOutcomeKind.Accepted };
    case "empty":
    case "unknownWords":
    case "wrongWordCount":
    case "wrongWords":
      return { kind: RecoveryWordsOutcomeKind.Refused, refusal: check };
  }
}

export enum RecoveryWordsSlipKind {
  Clear = "clear",
  Refused = "refused",
}

/** What the words field shows under it: nothing, or Rust's refusal. */
export type RecoveryWordsSlip =
  | { readonly kind: RecoveryWordsSlipKind.Clear }
  | {
      readonly kind: RecoveryWordsSlipKind.Refused;
      readonly refusal: RecoveryWordsRefusal;
    };

/** Why the words are typed: to confirm new ones, or to recover. */
export enum RecoveryWordsPurpose {
  Confirm = "confirm",
  Recover = "recover",
}

/** Named values required by `RecoveryWordsText.slip`. */
export type RecoveryWordsSlipText = {
  readonly slip: RecoveryWordsSlip;
  readonly purpose: RecoveryWordsPurpose;
};

/** The words a recovery passphrase screen says. */
export class RecoveryWordsText {
  constructor(private readonly vault: VaultState) {}

  /** What the field says under it; a refusal names the words it refused,
   * counted from one. */
  slip({ slip, purpose }: RecoveryWordsSlipText): string {
    switch (slip.kind) {
      case RecoveryWordsSlipKind.Clear:
        return "";
      case RecoveryWordsSlipKind.Refused:
        return this.refusal(slip.refusal, purpose);
    }
  }

  private refusal(
    ...[refusal, purpose]: readonly [RecoveryWordsRefusal, RecoveryWordsPurpose]
  ): string {
    const vault = this.vault;
    switch (refusal.state) {
      case "empty":
        return vault.t(I18N_KEYS.RecoveryPassphraseCheckEmpty);
      case "unknownWords": {
        const request: Parameters<typeof vault.t>[0] = {
          key: I18N_KEYS.RecoveryPassphraseCheckUnknown,
          replacements: {
            positions: refusal.positions
              .map((position) => String(position + 1))
              .join(", "),
          },
        };
        return vault.t(request);
      }
      case "wrongWordCount": {
        const request: Parameters<typeof vault.t>[0] = {
          key: I18N_KEYS.RecoveryPassphraseCheckCount,
          replacements: {
            expected: String(refusal.expected),
            typed: String(refusal.typed),
          },
        };
        return vault.t(request);
      }
      case "wrongWords":
        switch (purpose) {
          case RecoveryWordsPurpose.Confirm:
            return vault.t(I18N_KEYS.RecoveryPassphraseCheckNotShown);
          case RecoveryWordsPurpose.Recover:
            return vault.t(I18N_KEYS.RecoveryPassphraseCheckWrong);
        }
    }
  }

  /** A strength's name. */
  strength(strength: RecoveryStrength): string {
    switch (strength) {
      case "standard":
        return this.vault.t(I18N_KEYS.RecoveryPassphraseStrengthStandard);
      case "high":
        return this.vault.t(I18N_KEYS.RecoveryPassphraseStrengthHigh);
    }
  }

  /** How many words a strength has. */
  strengthDetail(strength: RecoveryStrength): string {
    switch (strength) {
      case "standard":
        return this.vault.t(I18N_KEYS.RecoveryPassphraseStrengthStandardDetail);
      case "high":
        return this.vault.t(I18N_KEYS.RecoveryPassphraseStrengthHighDetail);
    }
  }
}

/** Every strength, the default first. */
export const RECOVERY_STRENGTHS: readonly RecoveryStrength[] = [
  "standard",
  "high",
];

/** Named values required by `RecoveryWordSuggestions.complete`. */
export type RecoveryWordCompletion = {
  readonly typed: string;
  readonly word: string;
};

/** List words for the word being typed. Rust reads the field: the word
 * being typed follows the last space or hyphen. */
export class RecoveryWordSuggestions {
  private static readonly limit = 6;

  /** The list words that start with the word being typed; none before
   * one is begun. */
  static of(typed: string): readonly string[] {
    return recovery_word_typing(typed, RecoveryWordSuggestions.limit)
      .suggestions;
  }

  /** The typed words with the one being typed replaced by `word`, ready
   * for the next. */
  static complete({ typed, word }: RecoveryWordCompletion): string {
    return complete_recovery_word(typed, word);
  }
}
