import { describe, expect, test } from 'vitest'
import { createEnrollmentQrOptions, enrollmentQrSize } from '$lib/enrollment-qr'

describe('createEnrollmentQrOptions', () => {
  test('configures a styled enrollment QR with quartile correction', () => {
    const link = 'https://nook.example/#enroll=abc123'
    const options = createEnrollmentQrOptions(link)

    expect(options.width).toBe(enrollmentQrSize)
    expect(options.height).toBe(enrollmentQrSize)
    expect(options.type).toBe('svg')
    expect(options.data).toBe(link)
    expect(options.margin).toBe(4)
    expect(options.qrOptions?.errorCorrectionLevel).toBe('Q')
    expect(options.dotsOptions?.type).toBe('dots')
    expect(options.cornersSquareOptions?.type).toBe('extra-rounded')
    expect(options.cornersDotOptions?.type).toBe('dot')
    expect(options.imageOptions?.hideBackgroundDots).toBe(true)
    expect(options.imageOptions?.imageSize).toBeLessThanOrEqual(0.13)
    expect(options.imageOptions?.margin).toBe(4)
    expect(options.image).toBe('/nook-qr-badge.png')
  })
})
