export type TranslationRequest =
  | string
  | {
      readonly key: string;
      readonly replacements?: Readonly<Record<string, string>>;
    };

export function translationKey(request: TranslationRequest): string {
  return typeof request === "string" ? request : request.key;
}

export function translationReplacements(
  request: TranslationRequest,
): Readonly<Record<string, string>> {
  return typeof request === "string" ? {} : (request.replacements ?? {});
}
