import type { Options } from "qr-code-styling";

export const enrollmentQrSize = 360;

const ink = "#090b10";
const nookQrBadgeImage = "/nook-qr-badge.png";

/** Bytes the largest QR version holds at each error-correction level. */
const QUARTILE_BYTE_CAPACITY = 1663;
const MEDIUM_BYTE_CAPACITY = 2331;

enum QrErrorCorrection {
  Low = "L",
  Medium = "M",
  Quartile = "Q",
}

type EnrollmentQrCreationOptions = {
  readonly enrollmentLink: string;
  readonly dense: boolean;
};

export class EnrollmentQrPresentation {
  constructor(private readonly request: EnrollmentQrCreationOptions) {}

  /** The badge needs quartile correction; a link too long for it keeps
   * the most correction that still fits, without the badge. */
  private get errorCorrection(): QrErrorCorrection {
    if (this.request.dense) return QrErrorCorrection.Low;
    const bytes = new TextEncoder().encode(this.request.enrollmentLink).length;
    if (bytes <= QUARTILE_BYTE_CAPACITY) return QrErrorCorrection.Quartile;
    return bytes <= MEDIUM_BYTE_CAPACITY
      ? QrErrorCorrection.Medium
      : QrErrorCorrection.Low;
  }

  get options(): Partial<Options> {
    const { enrollmentLink } = this.request;
    const errorCorrectionLevel = this.errorCorrection;
    const badge = errorCorrectionLevel === QrErrorCorrection.Quartile;
    return {
      width: enrollmentQrSize,
      height: enrollmentQrSize,
      type: "svg",
      shape: "square",
      data: enrollmentLink,
      margin: 4,
      qrOptions: {
        typeNumber: 0,
        mode: "Byte",
        errorCorrectionLevel,
      },
      ...(badge ? { image: nookQrBadgeImage } : {}),
      imageOptions: {
        hideBackgroundDots: true,
        imageSize: badge ? 0.13 : 0,
        margin: 4,
        saveAsBlob: false,
      },
      dotsOptions: {
        color: ink,
        type: "dots",
      },
      cornersSquareOptions: {
        color: ink,
        type: "extra-rounded",
      },
      cornersDotOptions: {
        color: ink,
        type: "dot",
      },
      backgroundOptions: {
        color: "#ffffff",
        round: 0.08,
      },
    } satisfies Partial<Options>;
  }
}
