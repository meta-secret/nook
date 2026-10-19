import { Schema } from "effect";
import type { NookAuthenticatorEnrollmentCandidates } from "../vault-app/lib/nook-wasm/nook_wasm";

/** One Rust-accepted candidate: its source and canonical otpauth URI. */
export type AuthenticatorEnrollmentCandidate =
  NookAuthenticatorEnrollmentCandidates["candidates"][number];

/**
 * Bounds for the pictures and texts a content script sends after the trusted
 * **Add 2FA from this page** click. Rust enforces its own candidate bounds;
 * these keep the runtime message itself small and fail closed when exceeded.
 */
export enum AuthenticatorEnrollmentSourceBound {
  /** Visible QR media rasterized per click. */
  MaxPictures = 8,
  /** Longer picture edge after downscaling, in pixels. */
  MaxPictureEdgePx = 512,
  /** Setup-key text candidates per click; Rust accepts at most 16. */
  MaxSetupKeyTexts = 16,
  /** UTF-8 bytes per setup-key text candidate; Rust accepts at most 256. */
  MaxSetupKeyTextBytes = 256,
  /** Resolved candidates: 32 QR payloads plus 16 setup keys at most. */
  MaxCandidates = 48,
}

const RGBA_BYTES_PER_PIXEL = 4;
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;
const BASE64_CHUNK_BYTES = 0x8000;

/** One rasterized QR picture: row-major RGBA bytes as standard base64. */
export type AuthenticatorEnrollmentPicture = {
  readonly width: number;
  readonly height: number;
  readonly rgbaBase64: string;
};

/** Everything a trusted click captured from the setup scope; decoded only offscreen. */
export type AuthenticatorEnrollmentSources = {
  readonly pictures: readonly AuthenticatorEnrollmentPicture[];
  readonly setupKeyTexts: readonly string[];
};

/** Raw RGBA bytes of one picture at its transported size. */
export type AuthenticatorEnrollmentPixels = {
  readonly data: Uint8ClampedArray<ArrayBuffer>;
  readonly width: number;
  readonly height: number;
};

class RgbaBase64Length {
  constructor(private readonly picture: AuthenticatorEnrollmentPicture) {}

  /** A base64 string of exactly width × height × 4 bytes. */
  matches(): boolean {
    const { width, height, rgbaBase64 } = this.picture;
    const bytes = width * height * RGBA_BYTES_PER_PIXEL;
    return rgbaBase64.length === Math.ceil(bytes / 3) * 4;
  }
}

class Utf8TextBound {
  private static readonly encoder = new TextEncoder();

  constructor(private readonly text: string) {}

  fits(): boolean {
    return (
      Utf8TextBound.encoder.encode(this.text).length <=
      AuthenticatorEnrollmentSourceBound.MaxSetupKeyTextBytes
    );
  }
}

const pictureEdgeRange: Parameters<typeof Schema.isBetween>[0] = {
  minimum: 1,
  maximum: AuthenticatorEnrollmentSourceBound.MaxPictureEdgePx,
};
const pictureEdgeSchema = Schema.Number.pipe(
  Schema.check(Schema.isInt(), Schema.isBetween(pictureEdgeRange)),
);
const maxRgbaBase64Length =
  Math.ceil(
    (AuthenticatorEnrollmentSourceBound.MaxPictureEdgePx *
      AuthenticatorEnrollmentSourceBound.MaxPictureEdgePx *
      RGBA_BYTES_PER_PIXEL) /
      3,
  ) * 4;
const rgbaBase64Schema = Schema.String.pipe(
  Schema.check(
    Schema.isMaxLength(maxRgbaBase64Length),
    Schema.isPattern(BASE64_PATTERN),
  ),
);
const pictureFields: {
  readonly width: typeof pictureEdgeSchema;
  readonly height: typeof pictureEdgeSchema;
  readonly rgbaBase64: typeof rgbaBase64Schema;
} = {
  width: pictureEdgeSchema,
  height: pictureEdgeSchema,
  rgbaBase64: rgbaBase64Schema,
};
const pictureSchema = Schema.Struct(pictureFields).pipe(
  Schema.check(
    Schema.makeFilter((picture: AuthenticatorEnrollmentPicture) =>
      new RgbaBase64Length(picture).matches(),
    ),
  ),
);
const setupKeyTextSchema = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter((text: string) => new Utf8TextBound(text).fits()),
  ),
);
const sourcesFields: {
  readonly pictures: Schema.$Array<typeof pictureSchema>;
  readonly setupKeyTexts: Schema.$Array<typeof setupKeyTextSchema>;
} = {
  pictures: Schema.Array(pictureSchema).pipe(
    Schema.check(
      Schema.isMaxLength(AuthenticatorEnrollmentSourceBound.MaxPictures),
    ),
  ),
  setupKeyTexts: Schema.Array(setupKeyTextSchema).pipe(
    Schema.check(
      Schema.isMaxLength(AuthenticatorEnrollmentSourceBound.MaxSetupKeyTexts),
    ),
  ),
};
const sourcesSchema = Schema.Struct(sourcesFields);
const sourcesMessageFields: {
  readonly origin: typeof Schema.String;
  readonly payload: typeof sourcesSchema;
} = {
  origin: Schema.String,
  payload: sourcesSchema,
};

/** The service-worker-admitted request: its origin is the authorized page origin. */
export type AuthenticatorEnrollmentSourcesRequest = {
  readonly origin: string;
  readonly payload: AuthenticatorEnrollmentSources;
};

export const AuthenticatorEnrollmentSourcesRequestDecoder: Schema.Codec<AuthenticatorEnrollmentSourcesRequest> =
  Schema.Struct(sourcesMessageFields);

const candidateSourceSchema = Schema.Literals(["qr", "setup-key"]);
const otpauthTotpUriSchema = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter((value: string) => value.startsWith("otpauth://totp/")),
  ),
);
const candidateFields: {
  readonly source: typeof candidateSourceSchema;
  readonly otpauthUri: typeof otpauthTotpUriSchema;
} = {
  source: candidateSourceSchema,
  otpauthUri: otpauthTotpUriSchema,
};
const candidateSchema: Schema.Codec<AuthenticatorEnrollmentCandidate> =
  Schema.Struct(candidateFields);
const candidatesFields: {
  readonly candidates: Schema.mutable<Schema.$Array<typeof candidateSchema>>;
} = {
  candidates: Schema.mutable(Schema.Array(candidateSchema)).pipe(
    Schema.check(
      Schema.isMaxLength(AuthenticatorEnrollmentSourceBound.MaxCandidates),
    ),
  ),
};

/** Rust's accepted otpauth candidates, as the content script receives them. */
export const AuthenticatorEnrollmentCandidatesDecoder: Schema.Codec<NookAuthenticatorEnrollmentCandidates> =
  Schema.Struct(candidatesFields);

/** Moves raster bytes through JSON runtime messaging as standard base64. */
export class AuthenticatorEnrollmentPictureCodec {
  encode(
    pixels: AuthenticatorEnrollmentPixels,
  ): AuthenticatorEnrollmentPicture {
    let binary = "";
    for (
      let offset = 0;
      offset < pixels.data.length;
      offset += BASE64_CHUNK_BYTES
    ) {
      binary += String.fromCharCode(
        ...pixels.data.subarray(offset, offset + BASE64_CHUNK_BYTES),
      );
    }
    const picture: AuthenticatorEnrollmentPicture = {
      width: pixels.width,
      height: pixels.height,
      rgbaBase64: btoa(binary),
    };
    return picture;
  }

  /** Expects a picture the request decoder already bounded. */
  decode(
    picture: AuthenticatorEnrollmentPicture,
  ): AuthenticatorEnrollmentPixels {
    const binary = atob(picture.rgbaBase64);
    const data = new Uint8ClampedArray(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      data[index] = binary.charCodeAt(index);
    }
    const pixels: AuthenticatorEnrollmentPixels = {
      data,
      width: picture.width,
      height: picture.height,
    };
    return pixels;
  }
}
