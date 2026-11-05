import { beforeAll, describe, expect, test } from 'vitest'
import { default as initNookWasm } from '$app-wasm'
import { RecoveryWordSuggestions } from '$lib/vault/recovery-words'

beforeAll(async () => {
  await initNookWasm()
})

describe('recovery word suggestions follow the field as Rust reads it', () => {
  test('the word being typed follows the last space or hyphen', () => {
    expect(RecoveryWordSuggestions.of('abandon zoo')).toEqual([
      'zoo',
      'zoological',
      'zoologist',
      'zoology',
      'zoom',
    ])
    // A hyphen separates words as a space does.
    expect(RecoveryWordSuggestions.of('abandon-zoolog')).toEqual([
      'zoological',
      'zoologist',
      'zoology',
    ])
    expect(RecoveryWordSuggestions.of('Abando')).toEqual([
      'abandon',
      'abandoned',
      'abandoning',
      'abandonment',
    ])
  })

  test('nothing is suggested before a word is begun', () => {
    expect(RecoveryWordSuggestions.of('')).toEqual([])
    expect(RecoveryWordSuggestions.of('abandon ')).toEqual([])
    expect(RecoveryWordSuggestions.of('abandon-')).toEqual([])
  })

  test('completing keeps the words before and readies the next one', () => {
    expect(
      RecoveryWordSuggestions.complete({
        typed: 'abandon-zool',
        word: 'zoology',
      }),
    ).toBe('abandon-zoology ')
    expect(
      RecoveryWordSuggestions.complete({ typed: 'abando', word: 'abandon' }),
    ).toBe('abandon ')
  })

  test('a word not on the list is not completed', () => {
    expect(() =>
      RecoveryWordSuggestions.complete({
        typed: 'abandon zo',
        word: 'zoologyy',
      }),
    ).toThrow()
  })
})
