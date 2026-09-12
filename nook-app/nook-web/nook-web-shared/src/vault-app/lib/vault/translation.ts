export type TranslationRequest =
  | string
  | {
      readonly key: string;
      readonly replacements: Readonly<Record<string, string>>;
    };

export class TranslationMessage {
  constructor(private readonly value: TranslationRequest) {}
  translationKey(): string {
    const request = this.value;
    return typeof request === "string" ? request : request.key;
  }

  translationReplacements(): Readonly<Record<string, string>> {
    const request = this.value;
    return typeof request === "string" ? {} : request.replacements;
  }
}
