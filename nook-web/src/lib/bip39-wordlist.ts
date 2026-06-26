export const BIP39_ENGLISH_URL =
  'https://raw.githubusercontent.com/bitcoin/bips/master/bip-0039/english.txt'

const SESSION_CACHE_KEY = 'nook_bip39_english_v1'

export type MnemonicLength = 12 | 24

let cachedWordlist: Set<string> | null = null
let loadPromise: Promise<Set<string>> | null = null

export function getBip39WordlistUrl(): string {
  const override = import.meta.env.VITE_BIP39_WORDLIST_URL?.trim()
  return override || BIP39_ENGLISH_URL
}

function parseWordlistBody(body: string): Set<string> {
  const words = body
    .trim()
    .split('\n')
    .map((word) => word.trim().toLowerCase())
    .filter(Boolean)

  if (words.length !== 2048) {
    throw new Error(`Invalid BIP39 wordlist length: ${words.length}`)
  }

  return new Set(words)
}

function readSessionCache(): Set<string> | null {
  if (typeof sessionStorage === 'undefined') return null
  const raw = sessionStorage.getItem(SESSION_CACHE_KEY)
  if (!raw) return null

  try {
    const words = JSON.parse(raw) as string[]
    if (!Array.isArray(words) || words.length !== 2048) return null
    return new Set(words)
  } catch {
    sessionStorage.removeItem(SESSION_CACHE_KEY)
    return null
  }
}

function writeSessionCache(words: Iterable<string>) {
  if (typeof sessionStorage === 'undefined') return
  sessionStorage.setItem(SESSION_CACHE_KEY, JSON.stringify([...words]))
}

export function clearBip39WordlistCache() {
  cachedWordlist = null
  loadPromise = null
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.removeItem(SESSION_CACHE_KEY)
  }
}

export async function loadBip39Wordlist(force = false): Promise<Set<string>> {
  if (!force && cachedWordlist) return cachedWordlist
  if (!force && loadPromise) return loadPromise

  loadPromise = (async () => {
    if (!force) {
      const sessionCached = readSessionCache()
      if (sessionCached) {
        cachedWordlist = sessionCached
        return sessionCached
      }
    }

    const response = await fetch(getBip39WordlistUrl())
    if (!response.ok) {
      throw new Error(`Failed to load BIP39 wordlist: ${response.status}`)
    }

    const wordlist = parseWordlistBody(await response.text())
    cachedWordlist = wordlist
    writeSessionCache(wordlist)
    return wordlist
  })()

  try {
    return await loadPromise
  } finally {
    loadPromise = null
  }
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
  const normalized = word.trim().toLowerCase()
  if (!normalized) return false
  return wordlist.has(normalized)
}

export function isMnemonicValid(
  text: string,
  wordlist: Set<string>,
  expectedLength: MnemonicLength,
): boolean {
  const words = parseMnemonicWords(text)
  if (words.length !== expectedLength) return false
  return words.every((word) => isKnownBip39Word(word, wordlist))
}
