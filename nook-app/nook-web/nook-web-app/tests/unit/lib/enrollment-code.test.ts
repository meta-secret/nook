import { describe, expect, test } from 'vitest'
import { enrollmentBrowser } from '$lib/enrollment/code'
import {
  default as initNookWasm,
  decrypt_enrollment_payload,
  normalize_enrollment_code,
  peek_enrollment_entry_id,
  VaultApplication,
} from '$app-wasm'

await initNookWasm()

// Codes are sealed inside WASM when an identity issues an invite; the
// round trip is covered by the nook-auth2 enrollment tests. A raw base64url
// value is enough to exercise the link helpers.
const RAW_CODE = 'eyJlbnRyeV9pZCI6ImVudHJ5LTEifQ'

describe('enrollment-code links', () => {
  test('isolated applications generate links at their own root', () => {
    expect(
      enrollmentBrowser.enrollmentAppRootUrl({
        siteRoot: 'https://simple.nokey.sh',
        appKind: VaultApplication.Simple,
      }),
    ).toBe('https://simple.nokey.sh/')
    expect(
      enrollmentBrowser.enrollmentAppRootUrl({
        siteRoot: 'https://sentinel.nokey.sh/',
        appKind: VaultApplication.Sentinel,
      }),
    ).toBe('https://sentinel.nokey.sh/')
  })

  test('the unified development application keeps its /app route', () => {
    expect(
      enrollmentBrowser.enrollmentAppRootUrl({
        siteRoot: 'https://nokey.sh',
        appKind: VaultApplication.UnifiedDevelopment,
      }),
    ).toBe('https://nokey.sh/app/')
  })

  test('buildEnrollmentLink wraps the raw code in a hash URL', () => {
    expect(
      enrollmentBrowser.buildEnrollmentLink({
        code: RAW_CODE,
        baseUrl: 'https://nook.example',
      }),
    ).toBe(`https://nook.example/#enroll=${encodeURIComponent(RAW_CODE)}`)
  })

  test('normalize_enrollment_code accepts raw base64url codes', () => {
    expect(normalize_enrollment_code(RAW_CODE)).toBe(RAW_CODE)
  })

  test('normalize_enrollment_code extracts codes from hash links', () => {
    const link = enrollmentBrowser.buildEnrollmentLink({
      code: RAW_CODE,
      baseUrl: 'https://nook.example',
    })
    expect(normalize_enrollment_code(link)).toBe(RAW_CODE)
  })
})

describe('enrollment payloads', () => {
  test('rejects malformed codes', () => {
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
