import { describe, expect, test } from 'vitest'
import { buildEnrollmentLink, enrollmentAppRootUrl } from '$lib/enrollment/code'
import {
  NookEnrollmentIssueInput,
  NookEnrollmentEntryLabelState,
  NookEnrollmentProvider,
  default as initNookWasm,
  decrypt_enrollment_payload,
  encrypt_labeled_enrollment_payload,
  encrypt_unlabeled_enrollment_payload,
  normalize_enrollment_code,
  peek_enrollment_entry_id,
  peek_enrollment_entry_label,
  peek_enrollment_issued_at,
  VaultApplication,
} from '$app-wasm'

await initNookWasm()

function samplePayload(): NookEnrollmentIssueInput {
  return NookEnrollmentIssueInput.named(
    NookEnrollmentProvider.local(),
    'Local vault',
    'entry-local',
    '2026-06-23T12:00:00Z',
  )
}

function githubPayload(): NookEnrollmentIssueInput {
  return NookEnrollmentIssueInput.named(
    NookEnrollmentProvider.github('team-vault', 'github_pat_11AAAAbbbbCCCC'),
    'Team vault',
    'entry-1',
    '2026-06-23T12:00:00Z',
  )
}

function enrollmentEntryLabel(code: string): string {
  const label = peek_enrollment_entry_label(code)
  try {
    expect(label.state).toBe(NookEnrollmentEntryLabelState.Labeled)
    return label.value
  } finally {
    label.free()
  }
}

function decodeOuterJson(code: string): Record<string, unknown> {
  const normalized = code.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4)
  const binary = atob(padded)
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>
}

describe('enrollment-code links', () => {
  test('isolated applications generate links at their own root', () => {
    expect(
      enrollmentAppRootUrl({
        siteRoot: 'https://simple.nokey.sh',
        appKind: VaultApplication.Simple,
      }),
    ).toBe('https://simple.nokey.sh/')
    expect(
      enrollmentAppRootUrl({
        siteRoot: 'https://sentinel.nokey.sh/',
        appKind: VaultApplication.Sentinel,
      }),
    ).toBe('https://sentinel.nokey.sh/')
  })

  test('the unified development application keeps its /app route', () => {
    expect(
      enrollmentAppRootUrl({
        siteRoot: 'https://nokey.sh',
        appKind: VaultApplication.UnifiedDevelopment,
      }),
    ).toBe('https://nokey.sh/app/')
  })

  test('buildEnrollmentLink wraps the raw code in a hash URL', async () => {
    const code = encrypt_unlabeled_enrollment_payload(
      samplePayload(),
      'hunter2',
    )
    expect(
      buildEnrollmentLink({
        code: code,
        baseUrl: 'https://nook.example',
      }),
    ).toBe(`https://nook.example/#enroll=${encodeURIComponent(code)}`)
  })

  test('normalize_enrollment_code accepts raw base64url codes', async () => {
    const code = encrypt_unlabeled_enrollment_payload(
      samplePayload(),
      'hunter2',
    )
    expect(normalize_enrollment_code(code)).toBe(code)
  })

  test('normalize_enrollment_code extracts codes from hash links', async () => {
    const code = encrypt_unlabeled_enrollment_payload(
      samplePayload(),
      'hunter2',
    )
    const link = buildEnrollmentLink({
      code: code,
      baseUrl: 'https://nook.example',
    })
    expect(normalize_enrollment_code(link)).toBe(code)
  })

  test('wasm peek helpers accept full enrollment links', async () => {
    const code = encrypt_labeled_enrollment_payload(
      samplePayload(),
      'hunter2',
      'Desk',
    )
    const link = buildEnrollmentLink({
      code: code,
      baseUrl: 'https://nook.example',
    })
    expect(peek_enrollment_entry_id(link)).toBe('entry-local')
    expect(enrollmentEntryLabel(link)).toBe('Desk')
    expect(peek_enrollment_issued_at(link)).toBe('2026-06-23T12:00:00Z')
  })
})

describe('enrollment payloads', () => {
  test('encrypts provider creds and exposes entry_id without the password', async () => {
    const code = encrypt_labeled_enrollment_payload(
      githubPayload(),
      'vault-pass-99',
      'Work laptop',
    )
    expect(peek_enrollment_entry_id(code)).toBe('entry-1')
    expect(enrollmentEntryLabel(code)).toBe('Work laptop')
    expect(peek_enrollment_issued_at(code)).toBe('2026-06-23T12:00:00Z')

    const outer = decodeOuterJson(code)
    const serialized = JSON.stringify(outer)
    expect(serialized).not.toContain('vault-pass-99')
    expect(serialized).not.toContain('github_pat_11AAAAbbbbCCCC')
    expect(serialized).not.toContain('Team vault')
    expect(outer.entry_id).toBe('entry-1')
    expect(outer.ct).toBeTruthy()

    const decrypted = decrypt_enrollment_payload(code, 'vault-pass-99')
    expect(decrypted.entryId).toBe('entry-1')
    expect(decrypted.vaultName).toBe('Team vault')
    expect(decrypted.issuedAt).toBe('2026-06-23T12:00:00Z')
    expect(decrypted.provider.type).toBe('github')
    expect(decrypted.provider.githubPat).toBe('github_pat_11AAAAbbbbCCCC')
    expect(decrypted.provider.githubRepo).toBe('team-vault')
  })

  test('rejects wrong vault passwords', async () => {
    const code = encrypt_unlabeled_enrollment_payload(
      samplePayload(),
      'hunter2',
    )
    expect(() => decrypt_enrollment_payload(code, 'wrong-pass')).toThrow(
      'Vault password does not decrypt this enrollment code.',
    )
  })

  test('rejects malformed codes', async () => {
    const malformed = btoa(JSON.stringify({ provider: { type: 'local' } }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    expect(() => decrypt_enrollment_payload(malformed, 'pw')).toThrow(
      'Invalid enrollment code.',
    )
    expect(() => peek_enrollment_entry_id(malformed)).toThrow()
  })
})
