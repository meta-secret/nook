import { describe, expect, test } from 'vitest'
import {
  buildEnrollmentLink,
  decryptEnrollmentPayload,
  encodeEnrollmentPayload,
  encryptEnrollmentPayload,
  enrollmentCodeRequiresPassword,
  normalizeEnrollmentCode,
  peekEnrollmentIssuedAt,
  type EnrollmentCodePayloadV1,
} from './enrollment-code'

const samplePayload: EnrollmentCodePayloadV1 = {
  v: 1,
  provider: { type: 'local' },
  password: 'hunter2',
  issued_at: '2026-06-23T12:00:00Z',
}

const githubPayload: EnrollmentCodePayloadV1 = {
  v: 1,
  provider: {
    type: 'github',
    pat: 'github_pat_11AAAAbbbbCCCC',
    repo: 'team-vault',
  },
  password: 'vault-pass-99',
  entry_id: 'entry-1',
  issued_at: '2026-06-23T12:00:00Z',
}

function decodeOuterJson(code: string): Record<string, unknown> {
  const normalized = code.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4)
  const binary = atob(padded)
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>
}

describe('enrollment-code links', () => {
  test('buildEnrollmentLink wraps the raw code in a hash URL', async () => {
    const code = await encryptEnrollmentPayload(samplePayload, 'hunter2')
    expect(buildEnrollmentLink(code, 'https://nook.example')).toBe(
      `https://nook.example/#enroll=${encodeURIComponent(code)}`,
    )
  })

  test('normalizeEnrollmentCode accepts raw base64url codes', async () => {
    const code = await encryptEnrollmentPayload(samplePayload, 'hunter2')
    expect(normalizeEnrollmentCode(code)).toBe(code)
  })

  test('normalizeEnrollmentCode extracts codes from hash links', async () => {
    const code = await encryptEnrollmentPayload(samplePayload, 'hunter2')
    const link = buildEnrollmentLink(code, 'https://nook.example')
    expect(normalizeEnrollmentCode(link)).toBe(code)
  })
})

describe('encrypted enrollment payloads', () => {
  test('encrypts with the vault password and round-trips', async () => {
    const code = await encryptEnrollmentPayload(samplePayload, 'hunter2')
    expect(enrollmentCodeRequiresPassword(code)).toBe(true)
    await expect(decryptEnrollmentPayload(code, 'hunter2')).resolves.toEqual(
      samplePayload,
    )
  })

  test('does not expose secrets in the outer QR envelope', async () => {
    const code = await encryptEnrollmentPayload(githubPayload, 'vault-pass-99')
    const outer = decodeOuterJson(code)
    const serialized = JSON.stringify(outer)

    expect(outer.v).toBe(2)
    expect(serialized).not.toContain('hunter2')
    expect(serialized).not.toContain('vault-pass-99')
    expect(serialized).not.toContain('github_pat_11AAAAbbbbCCCC')
    expect(peekEnrollmentIssuedAt(code)).toBe('2026-06-23T12:00:00Z')
  })

  test('rejects wrong vault passwords', async () => {
    const code = await encryptEnrollmentPayload(samplePayload, 'hunter2')
    await expect(decryptEnrollmentPayload(code, 'wrong-pass')).rejects.toThrow(
      'Vault password does not decrypt this enrollment code.',
    )
  })

  test('legacy v1 plaintext codes still decrypt without a password', async () => {
    const code = encodeEnrollmentPayload(samplePayload)
    expect(enrollmentCodeRequiresPassword(code)).toBe(false)
    await expect(decryptEnrollmentPayload(code, '')).resolves.toEqual(
      samplePayload,
    )
  })
})
