import { describe, expect, test } from 'vitest'
import { buildEnrollmentLink } from '$lib/enrollment-code'
import {
  NookEnrollmentIssueInput,
  NookEnrollmentProvider,
  StorageProviderType,
  default as initNookWasm,
  decryptEnrollmentPayload,
  encryptEnrollmentPayload,
  normalizeEnrollmentCode,
  peekEnrollmentEntryId,
  peekEnrollmentEntryLabel,
  peekEnrollmentIssuedAt,
} from '$lib/nook-wasm/nook_wasm'

await initNookWasm()

function samplePayload(): NookEnrollmentIssueInput {
  return new NookEnrollmentIssueInput(
    NookEnrollmentProvider.local(),
    'entry-local',
    '2026-06-23T12:00:00Z',
  )
}

function githubPayload(): NookEnrollmentIssueInput {
  return new NookEnrollmentIssueInput(
    NookEnrollmentProvider.github('team-vault', 'github_pat_11AAAAbbbbCCCC'),
    'entry-1',
    '2026-06-23T12:00:00Z',
  )
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
    const code = encryptEnrollmentPayload(samplePayload(), 'hunter2')
    expect(buildEnrollmentLink(code, 'https://nook.example')).toBe(
      `https://nook.example/#enroll=${encodeURIComponent(code)}`,
    )
  })

  test('normalizeEnrollmentCode accepts raw base64url codes', async () => {
    const code = encryptEnrollmentPayload(samplePayload(), 'hunter2')
    expect(normalizeEnrollmentCode(code)).toBe(code)
  })

  test('normalizeEnrollmentCode extracts codes from hash links', async () => {
    const code = encryptEnrollmentPayload(samplePayload(), 'hunter2')
    const link = buildEnrollmentLink(code, 'https://nook.example')
    expect(normalizeEnrollmentCode(link)).toBe(code)
  })

  test('wasm peek helpers accept full enrollment links', async () => {
    const code = encryptEnrollmentPayload(samplePayload(), 'hunter2', 'Desk')
    const link = buildEnrollmentLink(code, 'https://nook.example')
    expect(peekEnrollmentEntryId(link)).toBe('entry-local')
    expect(peekEnrollmentEntryLabel(link)).toBe('Desk')
    expect(peekEnrollmentIssuedAt(link)).toBe('2026-06-23T12:00:00Z')
  })
})

describe('enrollment payloads', () => {
  test('encrypts provider creds and exposes entry_id without the password', async () => {
    const code = encryptEnrollmentPayload(
      githubPayload(),
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

    const decrypted = decryptEnrollmentPayload(code, 'vault-pass-99')
    expect(decrypted.entryId).toBe('entry-1')
    expect(decrypted.issuedAt).toBe('2026-06-23T12:00:00Z')
    expect(decrypted.provider.type).toBe(StorageProviderType.Github)
    expect(decrypted.provider.githubPat).toBe('github_pat_11AAAAbbbbCCCC')
    expect(decrypted.provider.githubRepo).toBe('team-vault')
  })

  test('rejects wrong vault passwords', async () => {
    const code = encryptEnrollmentPayload(samplePayload(), 'hunter2')
    expect(() => decryptEnrollmentPayload(code, 'wrong-pass')).toThrow(
      'Vault password does not decrypt this enrollment code.',
    )
  })

  test('rejects malformed codes', async () => {
    const malformed = btoa(JSON.stringify({ provider: { type: 'local' } }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    expect(() => decryptEnrollmentPayload(malformed, 'pw')).toThrow(
      'Invalid enrollment code.',
    )
    expect(peekEnrollmentEntryId(malformed)).toBeUndefined()
  })
})
