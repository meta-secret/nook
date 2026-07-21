import { describe, expect, test } from 'bun:test'
import { generateTotpCode, verifyTotpCode } from '../e2e/mock-auth/totp'

describe('mock auth TOTP', () => {
  test('verifies codes for the fixture seed across the current window', () => {
    const secret = 'JBSWY3DPEHPK3PXP'
    const now = Date.parse('2026-07-21T00:00:00.000Z')
    const code = generateTotpCode(secret, now)
    expect(code).toMatch(/^\d{6}$/)
    expect(verifyTotpCode(secret, code, now)).toBe(true)
    expect(verifyTotpCode(secret, '000000', now)).toBe(false)
  })
})
