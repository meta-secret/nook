import { afterEach, describe, expect, test } from 'vitest'
import { decodeVisibleOtpauthCandidates } from '../../../../nook-web-extension/src/lib/page-qr-capture'

afterEach(() => {
  document.body.replaceChildren()
})

describe('page QR otpauth capture', () => {
  test('prefers visible data-nook-otpauth-uri without BarcodeDetector', async () => {
    const uri =
      'otpauth://totp/Nook:alice-2fa@nook.test?secret=JBSWY3DPEHPK3PXP&issuer=Nook'
    document.body.innerHTML = `
      <img
        data-nook-otpauth-uri="${uri}"
        width="220"
        height="220"
        alt="Authenticator QR code"
        style="width: 220px; height: 220px"
      />
    `
    const image = document.querySelector('img')
    if (image) {
      Object.defineProperty(image, 'getBoundingClientRect', {
        value: () => ({
          width: 220,
          height: 220,
          top: 0,
          left: 0,
          bottom: 220,
          right: 220,
        }),
      })
    }

    await expect(decodeVisibleOtpauthCandidates()).resolves.toEqual({
      status: 'ready',
      candidates: [{ sourceLabel: 'QR 1', otpauthUri: uri }],
    })
  })

  test('reports unsupported when no marked URI and BarcodeDetector is missing', async () => {
    document.body.innerHTML = `
      <img
        width="220"
        height="220"
        alt="Authenticator QR code"
        style="width: 220px; height: 220px"
      />
    `
    const image = document.querySelector('img')
    if (image) {
      Object.defineProperty(image, 'getBoundingClientRect', {
        value: () => ({
          width: 220,
          height: 220,
          top: 0,
          left: 0,
          bottom: 220,
          right: 220,
        }),
      })
    }

    await expect(decodeVisibleOtpauthCandidates()).resolves.toEqual({
      status: 'unsupported',
      candidates: [],
    })
  })
})
