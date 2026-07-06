import {
  default as initNookWasm,
  parseAppLocale as parseAppLocaleCore,
  resolveAppLocaleFromTag as resolveAppLocaleFromTagCore,
  resolveAppLocaleFromTags as resolveAppLocaleFromTagsCore,
} from './nook-wasm/nook_wasm'

await initNookWasm()

export type AppLocale = 'en' | 'ru'

export function parseAppLocale(
  value: string | undefined,
): AppLocale | undefined {
  if (value === undefined) return undefined
  return parseAppLocaleCore(value) as AppLocale | undefined
}

/** Map a BCP 47 language tag to a supported app locale, if any. */
export function resolveAppLocaleFromTag(tag: string): AppLocale | undefined {
  return resolveAppLocaleFromTagCore(tag) as AppLocale | undefined
}

/** Pick the first supported locale from the browser's preferred language list. */
export function resolveAppLocaleFromTags(tags: Iterable<string>): AppLocale {
  return resolveAppLocaleFromTagsCore(Array.from(tags)) as AppLocale
}

export function getBrowserAppLocale(): AppLocale {
  if (typeof navigator === 'undefined') return 'en'

  const tags =
    navigator.languages?.length > 0 ? navigator.languages : [navigator.language]

  return resolveAppLocaleFromTags(tags)
}
