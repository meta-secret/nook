import {
  default as initNookWasm,
  getBip39EnglishWordlist,
  isBip39WordSequenceValid,
  isKnownBip39Word as isKnownBip39WordCore,
  suggestBip39Words as suggestBip39WordsCore,
} from './nook-wasm/nook_wasm'

await initNookWasm()

export type MnemonicLength = 12 | 24

let cachedWordlist: Set<string> | null = null

export function clearBip39WordlistCache() {
  cachedWordlist = null
}

export async function loadBip39Wordlist(force = false): Promise<Set<string>> {
  if (!force && cachedWordlist) return cachedWordlist
  cachedWordlist = new Set(getBip39EnglishWordlist())
  return cachedWordlist
}

export function parseMnemonicWords(text: string): string[] {
  return text.trim().toLowerCase().split(/\s+/).filter(Boolean)
}

export function joinMnemonicWords(words: string[]): string {
  return words
    .map((word) => word.trim().toLowerCase())
    .filter(Boolean)
    .join(' ')
}

export function inferMnemonicLength(text: string): MnemonicLength | null {
  const count = parseMnemonicWords(text).length
  if (count === 12) return 12
  if (count === 24) return 24
  return null
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
