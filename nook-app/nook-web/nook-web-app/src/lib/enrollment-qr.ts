import type { Options } from 'qr-code-styling'

export const enrollmentQrSize = 360

const ink = '#090b10'
const nookQrBadgeImage = '/nook-qr-badge.png'

export function createEnrollmentQrOptions(enrollmentLink: string) {
  return {
    width: enrollmentQrSize,
    height: enrollmentQrSize,
    type: 'svg',
    shape: 'square',
    data: enrollmentLink,
    margin: 4,
    qrOptions: {
      typeNumber: 0,
      mode: 'Byte',
      errorCorrectionLevel: 'Q',
    },
    image: nookQrBadgeImage,
    imageOptions: {
      hideBackgroundDots: true,
      imageSize: 0.13,
      margin: 4,
      saveAsBlob: false,
    },
    dotsOptions: {
      color: ink,
      type: 'dots',
    },
    cornersSquareOptions: {
      color: ink,
      type: 'extra-rounded',
    },
    cornersDotOptions: {
      color: ink,
      type: 'dot',
    },
    backgroundOptions: {
      color: '#ffffff',
      round: 0.08,
    },
  } satisfies Partial<Options>
}
