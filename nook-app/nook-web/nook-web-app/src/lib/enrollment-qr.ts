import type { Options } from 'qr-code-styling'

export const enrollmentQrSize = 360

const ink = '#090b10'
const badgeSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" rx="28" fill="#fff"/><circle cx="40" cy="34" r="12" fill="${ink}"/><path d="M20 76c0-18 9-28 22-28s22 10 22 28H20Z" fill="${ink}"/><circle cx="66" cy="58" r="9" fill="none" stroke="${ink}" stroke-width="7"/><path d="m72 64 13 13m-4-4 6-6m-1 11 6-6" fill="none" stroke="${ink}" stroke-width="7" stroke-linecap="round"/></svg>`

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
    image: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(badgeSvg)}`,
    imageOptions: {
      hideBackgroundDots: true,
      imageSize: 0.18,
      margin: 6,
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
