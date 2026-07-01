import { describe, expect, test } from 'vitest'
import {
  buildEnrollmentLink,
  decryptEnrollmentPayload,
  encryptEnrollmentPayload,
  normalizeEnrollmentCode,
  peekEnrollmentEntryId,
  peekEnrollmentEntryLabel,
  peekEnrollmentIssuedAt,
  type EnrollmentIssueInput,
} from '$lib/enrollment-code'

const samplePayload: EnrollmentIssueInput = {
  provider: { type: 'local' },
  entry_id: 'entry-local',
  issued_at: '2026-06-23T12:00:00Z',
}

const githubPayload: EnrollmentIssueInput = {
  provider: {
    type: 'github',
    pat: 'github_pat_11AAAAbbbbCCCC',
    repo: 'team-vault',
  },
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

describe('enrollment payloads', () => {
  test('encrypts provider creds and exposes entry_id without the password', async () => {
    const code = await encryptEnrollmentPayload(
      githubPayload,
      'vault-pass-99',
      'Work laptop',
    )
    expect(peekEnrollmentEntryId(code)).toBe('entry-1')
    expect(peekEnrollmentEntryLabel(code)).toBe('Work laptop')
    expect(peekEnrollmentIssuedAt(code)).toBe('2026-06-23T12:00:00Z')

    const outer = decodeOuterJson(code)
    const serialized = JSON.stringify(outer)
    expect(serialized).not.toContain('vault-pass-99')
    expect(serialized).not.toContain('github_pat_11AAAAbbbbCCCC')
    expect(outer.entry_id).toBe('entry-1')
    expect(outer.ct).toBeTruthy()

    const decrypted = await decryptEnrollmentPayload(code, 'vault-pass-99')
    expect(decrypted).toEqual({
      provider: githubPayload.provider,
      entry_id: 'entry-1',
      issued_at: '2026-06-23T12:00:00Z',
    })
  })

  test('rejects wrong vault passwords', async () => {
    const code = await encryptEnrollmentPayload(samplePayload, 'hunter2')
    await expect(decryptEnrollmentPayload(code, 'wrong-pass')).rejects.toThrow(
      'Vault password does not decrypt this enrollment code.',
    )
  })

  test('rejects malformed codes', async () => {
    const malformed = btoa(JSON.stringify({ provider: { type: 'local' } }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    await expect(decryptEnrollmentPayload(malformed, 'pw')).rejects.toThrow(
      'Invalid enrollment code.',
    )
    expect(peekEnrollmentEntryId(malformed)).toBeNull()
  })
})
