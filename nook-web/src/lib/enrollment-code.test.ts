import { describe, expect, test } from 'vitest'
import {
  buildEnrollmentLink,
  decodeEnrollmentPayload,
  encodeEnrollmentPayload,
  normalizeEnrollmentCode,
  type EnrollmentCodePayloadV1,
} from './enrollment-code'

const samplePayload: EnrollmentCodePayloadV1 = {
  v: 1,
  provider: { type: 'local' },
  password: 'hunter2',
  issued_at: '2026-06-23T12:00:00Z',
}

describe('enrollment-code links', () => {
  test('buildEnrollmentLink wraps the raw code in a hash URL', () => {
    const code = encodeEnrollmentPayload(samplePayload)
    expect(buildEnrollmentLink(code, 'https://nook.example')).toBe(
      `https://nook.example/#enroll=${encodeURIComponent(code)}`,
    )
  })

  test('normalizeEnrollmentCode accepts raw base64url codes', () => {
    const code = encodeEnrollmentPayload(samplePayload)
    expect(normalizeEnrollmentCode(code)).toBe(code)
  })

  test('normalizeEnrollmentCode extracts codes from hash links', () => {
    const code = encodeEnrollmentPayload(samplePayload)
    const link = buildEnrollmentLink(code, 'https://nook.example')
    expect(normalizeEnrollmentCode(link)).toBe(code)
  })

  test('decodeEnrollmentPayload accepts pasted enrollment links', () => {
    const code = encodeEnrollmentPayload(samplePayload)
    const link = buildEnrollmentLink(code, 'https://nook.example')
    expect(decodeEnrollmentPayload(link)).toEqual(samplePayload)
  })
})
