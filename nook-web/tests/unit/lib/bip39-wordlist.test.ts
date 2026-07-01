import { afterEach, describe, expect, test } from 'vitest'
import {
  clearBip39WordlistCache,
  isMnemonicValid,
  joinMnemonicWords,
  loadBip39Wordlist,
  parseMnemonicWords,
  suggestBip39Words,
} from '$lib/bip39-wordlist'

afterEach(() => {
  clearBip39WordlistCache()
})

describe('bip39-wordlist', () => {
  test('loads and caches the bundled official English wordlist from wasm', async () => {
    const first = await loadBip39Wordlist()
    const second = await loadBip39Wordlist()

    expect(first.size).toBe(2048)
    expect([...first].slice(0, 4)).toEqual([
      'abandon',
      'ability',
      'able',
      'about',
    ])
    expect(second).toBe(first)
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
    const wordlist = await loadBip39Wordlist()
    const mnemonic =
      'abandon ability able about above absent absorb abstract absurd abuse access accident'

    expect(isMnemonicValid(mnemonic, wordlist, 12)).toBe(true)
    expect(isMnemonicValid(`${mnemonic} zoo`, wordlist, 24)).toBe(false)
    expect(isMnemonicValid('not-in-list', wordlist, 12)).toBe(false)
  })

  test('suggests prefix matches from the wordlist', async () => {
    const wordlist = await loadBip39Wordlist()
    expect(suggestBip39Words('ab', wordlist, 4)).toEqual([
      'abandon',
      'ability',
      'able',
      'about',
    ])
    expect(suggestBip39Words('zoo', wordlist)).toEqual(['zoo'])
    expect(suggestBip39Words('missing', wordlist)).toEqual([])
  })
})
