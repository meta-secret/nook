import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  clearBip39WordlistCache,
  isMnemonicValid,
  joinMnemonicWords,
  loadBip39Wordlist,
  parseMnemonicWords,
  suggestBip39Words,
} from './bip39-wordlist'

const SAMPLE_WORDS = Array.from({ length: 2048 }, (_, index) => `word${index}`)

afterEach(() => {
  clearBip39WordlistCache()
  vi.unstubAllGlobals()
})

describe('bip39-wordlist', () => {
  test('loads and caches the official wordlist from fetch', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () => SAMPLE_WORDS.join('\n'),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const first = await loadBip39Wordlist()
    const second = await loadBip39Wordlist()

    expect(first.size).toBe(2048)
    expect(second).toBe(first)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('normalizes mnemonic words', () => {
    expect(parseMnemonicWords('  Abandon   ability\nable ')).toEqual([
      'abandon',
      'ability',
      'able',
    ])
    expect(joinMnemonicWords(['abandon', 'ability', 'able'])).toBe(
      'abandon ability able',
    )
  })

  test('validates mnemonic length and membership', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        text: async () => SAMPLE_WORDS.join('\n'),
      })),
    )

    const wordlist = await loadBip39Wordlist()
    const mnemonic = Array.from(
      { length: 12 },
      (_, index) => `word${index}`,
    ).join(' ')

    expect(isMnemonicValid(mnemonic, wordlist, 12)).toBe(true)
    expect(isMnemonicValid(`${mnemonic} word9999`, wordlist, 24)).toBe(false)
    expect(isMnemonicValid('not-in-list', wordlist, 12)).toBe(false)
  })

  test('suggests prefix matches from the wordlist', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        text: async () => SAMPLE_WORDS.join('\n'),
      })),
    )

    const wordlist = await loadBip39Wordlist()
    expect(suggestBip39Words('word1', wordlist, 4)).toEqual([
      'word1',
      'word10',
      'word100',
      'word1000',
    ])
    expect(suggestBip39Words('word999', wordlist)).toEqual(['word999'])
    expect(suggestBip39Words('missing', wordlist)).toEqual([])
  })
})
