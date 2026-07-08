import { describe, expect, test } from 'vitest'
import { createEnrollmentQrOptions, enrollmentQrSize } from '$lib/enrollment-qr'

describe('createEnrollmentQrOptions', () => {
  test('configures a styled high-correction enrollment QR', () => {
    const link = 'https://nook.example/#enroll=abc123'
    const options = createEnrollmentQrOptions(link)

    expect(options.width).toBe(enrollmentQrSize)
    expect(options.height).toBe(enrollmentQrSize)
    expect(options.type).toBe('svg')
    expect(options.data).toBe(link)
    expect(options.qrOptions?.errorCorrectionLevel).toBe('H')
    expect(options.dotsOptions?.type).toBe('dots')
    expect(options.cornersSquareOptions?.type).toBe('extra-rounded')
    expect(options.cornersDotOptions?.type).toBe('dot')
    expect(options.imageOptions?.hideBackgroundDots).toBe(true)
    expect(options.imageOptions?.imageSize).toBeLessThanOrEqual(0.3)
    expect(options.image).toMatch(/^data:image\/svg\+xml;charset=utf-8,/)
  })
})
