import { PasswordStrengthLevel } from "$app-wasm";

export enum StrengthTone {
  Weak = "weak",
  Fair = "fair",
  Strong = "strong",
}

const SEGMENT_COUNT = 10;

/** Segments and tone for a strength level estimated by nook-core. */
export class StrengthMeterView {
  constructor(readonly level: PasswordStrengthLevel) {}

  get tone(): StrengthTone {
    switch (this.level) {
      case PasswordStrengthLevel.Weak:
        return StrengthTone.Weak;
      case PasswordStrengthLevel.Fair:
        return StrengthTone.Fair;
      case PasswordStrengthLevel.Strong:
        return StrengthTone.Strong;
    }
  }

  get segments(): readonly boolean[] {
    const lit =
      this.tone === StrengthTone.Weak
        ? 3
        : this.tone === StrengthTone.Fair
          ? 6
          : SEGMENT_COUNT;
    return [...Array(SEGMENT_COUNT).keys()].map((index) => index < lit);
  }
}
