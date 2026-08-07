import { describe, expect, test } from 'bun:test'
import { absent, err, isOk, ok, present } from '../src/result.ts'

describe('result helpers', () => {
  test('discriminates ok and err', () => {
    expect(isOk(ok(1))).toBe(true)
    expect(isOk(err('nope'))).toBe(false)
  })

  test('maybe present and absent', () => {
    expect(present('x').kind).toBe('present')
    expect(absent().kind).toBe('absent')
  })
})
