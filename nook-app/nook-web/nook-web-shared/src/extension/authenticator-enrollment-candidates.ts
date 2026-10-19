import { Schema } from "effect";
import type {
  NookAuthenticatorEnrollmentCandidate,
  NookAuthenticatorEnrollmentCandidates,
  NookReviewedAuthenticatorLabelsVerdict,
} from "../vault-app/lib/nook-wasm/nook_wasm";

/**
 * Bounds for what a content script sends after the trusted **Add 2FA from
 * this page** click. The offscreen document checks them once, at the message
 * boundary; Rust owns every bound on the candidates it accepts.
 */
export enum AuthenticatorEnrollmentSourceBound {
  /** Visible QR media rasterized per click. */
  MaxPictures = 8,
  /** Longer picture edge after downscaling, in pixels. */
  MaxPictureEdgePx = 512,
  /**
   * Characters in one PNG data URL: a 512 × 512 picture is at most 1 MiB of
   * pixels, and PNG plus base64 stay under this even for incompressible media.
   */
  MaxPictureDataUrlLength = 1_500_000,
  /** Setup-key text candidates per click, nearest to the setup instructions first. */
  MaxSetupKeyTexts = 64,
  /** UTF-8 bytes per setup-key text candidate. */
  MaxSetupKeyTextBytes = 256,
}

/** The data URL prefix `HTMLCanvasElement.toDataURL("image/png")` writes. */
export const PNG_DATA_URL_PREFIX = "data:image/png;base64,";

/** Everything a trusted click captured from its setup scope; decoded only offscreen. */
export type AuthenticatorEnrollmentSources = {
  /** Each visible QR drawn on an opaque canvas, as a PNG data URL. */
  readonly pictureDataUrls: readonly string[];
  readonly setupKeyTexts: readonly string[];
};

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

const pictureDataUrlSchema = Schema.String.pipe(
  Schema.check(
    Schema.isMaxLength(
      AuthenticatorEnrollmentSourceBound.MaxPictureDataUrlLength,
    ),
    Schema.makeFilter((value: string) => value.startsWith(PNG_DATA_URL_PREFIX)),
  ),
);
const setupKeyTextSchema = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter((text: string) => new Utf8TextBound(text).fits()),
  ),
);
const sourcesFields: {
  readonly pictureDataUrls: Schema.$Array<typeof pictureDataUrlSchema>;
  readonly setupKeyTexts: Schema.$Array<typeof setupKeyTextSchema>;
} = {
  pictureDataUrls: Schema.Array(pictureDataUrlSchema).pipe(
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
const candidateFields: {
  readonly source: typeof candidateSourceSchema;
  readonly otpauthUri: typeof Schema.String;
} = {
  source: candidateSourceSchema,
  otpauthUri: Schema.String,
};
const candidateSchema: Schema.Codec<NookAuthenticatorEnrollmentCandidate> =
  Schema.Struct(candidateFields);
const candidatesFields: {
  readonly candidates: Schema.mutable<Schema.$Array<typeof candidateSchema>>;
} = {
  candidates: Schema.mutable(Schema.Array(candidateSchema)),
};

/** Reads the runtime reply's shape; Rust already decided every candidate. */
export const AuthenticatorEnrollmentCandidatesDecoder: Schema.Codec<NookAuthenticatorEnrollmentCandidates> =
  Schema.Struct(candidatesFields);

/** Rust's verdict on reviewed labels: only a valid pair may be staged. */
export type ReviewedAuthenticatorLabelsVerdictResponse = {
  readonly verdict: NookReviewedAuthenticatorLabelsVerdict;
};

const labelsVerdictSchema = Schema.Literals(["valid", "invalid"]);
const labelsVerdictFields: {
  readonly verdict: typeof labelsVerdictSchema;
} = {
  verdict: labelsVerdictSchema,
};

/** Reads the runtime reply's shape; Rust already decided the verdict. */
export const ReviewedAuthenticatorLabelsVerdictDecoder: Schema.Codec<ReviewedAuthenticatorLabelsVerdictResponse> =
  Schema.Struct(labelsVerdictFields);
