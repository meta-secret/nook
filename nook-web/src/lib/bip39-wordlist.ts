import {
  default as initNookWasm,
  getBip39EnglishWordlist,
  inferBip39MnemonicLength as inferBip39MnemonicLengthCore,
  isBip39WordSequenceValid,
  isKnownBip39Word as isKnownBip39WordCore,
  joinBip39Words as joinBip39WordsCore,
  parseBip39Words as parseBip39WordsCore,
  suggestBip39Words as suggestBip39WordsCore,
} from './nook-wasm/nook_wasm'

await initNookWasm()

export type MnemonicLength = 12 | 24

let cachedWordlist: Set<string> | undefined = undefined

export function clearBip39WordlistCache() {
  cachedWordlist = undefined
}

export async function loadBip39Wordlist(force = false): Promise<Set<string>> {
  if (!force && cachedWordlist) return cachedWordlist
  cachedWordlist = new Set(getBip39EnglishWordlist())
  return cachedWordlist
}

export function parseMnemonicWords(text: string): string[] {
  return parseBip39WordsCore(text)
}

export function joinMnemonicWords(words: string[]): string {
  return joinBip39WordsCore(words)
}

export function inferMnemonicLength(text: string): MnemonicLength | undefined {
  const inferred = inferBip39MnemonicLengthCore(text)
  return inferred === 12 || inferred === 24 ? inferred : undefined
}

export function isKnownBip39Word(word: string, wordlist: Set<string>): boolean {
  void wordlist
  return isKnownBip39WordCore(word)
}

export function suggestBip39Words(
  prefix: string,
  wordlist: Set<string>,
  limit = 8,
): string[] {
  void wordlist
  return suggestBip39WordsCore(prefix, limit)
}

export function isMnemonicValid(
  text: string,
  wordlist: Set<string>,
  expectedLength: MnemonicLength,
): boolean {
  void wordlist
  return isBip39WordSequenceValid(text, expectedLength)
}
