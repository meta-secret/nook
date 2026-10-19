import { Effect } from 'effect'
import { describe, expect, test, vi } from 'vitest'
import initNookWasm, {
  preview_otpauth_uri,
} from '../../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import {
  QrCodeReader,
  QrCodeReadFailure,
  QrCodeReadFailureKind,
} from '../../../../nook-web-shared/src/vault-app/lib/qr/qr-code-reader'
import {
  AuthenticatorEnrollmentSourceBound,
  PNG_DATA_URL_PREFIX,
} from '../../../../nook-web-shared/src/extension/authenticator-enrollment-candidates'
import { CompanionWasmSessionMessageType } from '../../../../nook-web-shared/src/extension/companion-wasm-runtime-messages'
import {
  AuthenticatorEnrollmentCandidateResolver,
  type AuthenticatorEnrollmentCandidatesMessage,
} from '../../../../nook-web-extension/src/offscreen/authenticator-enrollment-candidates'
import { SessionOperationFailureKind } from '../../../../nook-web-extension/src/lib/session-operation-queue'
import { OTPAUTH_QR_TEXT } from '../../fixtures/otpauth-qr-modules'

const PAGE_ORIGIN = 'https://www.demo.example.test'
const SETUP_KEY = 'JBSW Y3DP EHPK 3PXP'
/** A QR payload that is not an authenticator setup; Rust must drop it. */
const NON_OTPAUTH_QR_TEXT = 'https://example.test/download-the-app'
/** A transported picture; the stubbed reader stands in for ZXing's decode. */
const PICTURE = `${PNG_DATA_URL_PREFIX}iVBORw0KGgo=`

type ReadImage = QrCodeReader['readImage']

class CandidateFixture {
  static message(
    payload: AuthenticatorEnrollmentCandidatesMessage['payload'],
    origin = PAGE_ORIGIN,
  ): AuthenticatorEnrollmentCandidatesMessage {
    const runtimeMessage: AuthenticatorEnrollmentCandidatesMessage & {
      readonly origin: string
    } = {
      type: CompanionWasmSessionMessageType.ResolveAuthenticatorEnrollmentCandidates,
      payload,
      origin,
    }
    return runtimeMessage
  }

  /** The generated Rust export behind a reader that decoded these QR texts. */
  static resolver(
    readImage: ReadImage,
  ): AuthenticatorEnrollmentCandidateResolver {
    return new AuthenticatorEnrollmentCandidateResolver({
      reader: () => ({ readImage }),
      ensureWasm: () => initNookWasm(),
    })
  }

  static decoding(texts: readonly string[]): ReadImage {
    return vi.fn<ReadImage>(() => Effect.succeed(texts))
  }
}

describe('offscreen authenticator enrollment candidates', () => {
  test('hands every decoded QR text to Rust and keeps only the otpauth candidate it accepts', async () => {
    const readImage = CandidateFixture.decoding([
      NON_OTPAUTH_QR_TEXT,
      OTPAUTH_QR_TEXT,
    ])
    const result = await CandidateFixture.resolver(readImage).resolve(
      CandidateFixture.message({
        pictureDataUrls: [PICTURE],
        setupKeyTexts: [],
      }),
    )

    const { candidates } = result._unsafeUnwrap()
    expect(candidates.map((candidate) => candidate.source)).toEqual(['qr'])
    expect(JSON.stringify(candidates)).not.toContain(NON_OTPAUTH_QR_TEXT)
    const [blob] = vi.mocked(readImage).mock.calls.map(([image]) => image)
    expect(blob?.type).toBe('image/png')
    const preview = preview_otpauth_uri(
      candidates.map((candidate) => candidate.otpauthUri).join(''),
    )
    try {
      expect(preview.issuer).toBe('Demo Service')
      expect(preview.account).toBe('demo.user@example.test')
    } finally {
      preview.free()
    }
  })

  test('turns a visible setup key into a page-derived SHA-1 candidate', async () => {
    const result = await CandidateFixture.resolver(
      CandidateFixture.decoding([]),
    ).resolve(
      CandidateFixture.message({
        pictureDataUrls: [],
        setupKeyTexts: [
          'Enter this setup key in your authenticator app',
          SETUP_KEY,
        ],
      }),
    )

    const { candidates } = result._unsafeUnwrap()
    expect(candidates.map((candidate) => candidate.source)).toEqual([
      'setup-key',
    ])
    const preview = preview_otpauth_uri(
      candidates.map((candidate) => candidate.otpauthUri).join(''),
    )
    try {
      expect(preview.issuer).toBe('demo.example.test')
      expect(preview.account).toBe('')
      expect(preview.algorithm).toBe('SHA1')
      expect(preview.digits).toBe(6)
      expect(preview.period).toBe(30)
    } finally {
      preview.free()
    }
  })

  test('collapses a setup key into the QR that carries the same secret', async () => {
    const result = await CandidateFixture.resolver(
      CandidateFixture.decoding([OTPAUTH_QR_TEXT]),
    ).resolve(
      CandidateFixture.message({
        pictureDataUrls: [PICTURE],
        setupKeyTexts: [SETUP_KEY],
      }),
    )

    expect(
      result._unsafeUnwrap().candidates.map((candidate) => candidate.source),
    ).toEqual(['qr'])
  })

  test('skips an unreadable picture but fails closed when the reader cannot load', async () => {
    const readImage = vi
      .fn<ReadImage>()
      .mockReturnValueOnce(
        Effect.fail(
          QrCodeReadFailure.of(QrCodeReadFailureKind.PictureUnreadable),
        ),
      )
      .mockReturnValueOnce(Effect.succeed([OTPAUTH_QR_TEXT]))
    const twoPictures = CandidateFixture.message({
      pictureDataUrls: [PICTURE, PICTURE],
      setupKeyTexts: [],
    })

    const skipped =
      await CandidateFixture.resolver(readImage).resolve(twoPictures)
    expect(
      skipped._unsafeUnwrap().candidates.map((candidate) => candidate.source),
    ).toEqual(['qr'])

    const unavailable = await CandidateFixture.resolver(() =>
      Effect.fail(
        QrCodeReadFailure.of(QrCodeReadFailureKind.ReaderUnavailable),
      ),
    ).resolve(twoPictures)
    expect(unavailable._unsafeUnwrapErr().kind).toBe(
      SessionOperationFailureKind.Failed,
    )
  })

  test('maps a Rust rejection to the generic failure without its text', async () => {
    // Rust bounds each decoded QR payload at 2048 bytes and fails closed.
    const oversized = `otpauth://totp/A:b?secret=${'A'.repeat(2049)}`
    const result = await CandidateFixture.resolver(
      CandidateFixture.decoding([oversized]),
    ).resolve(
      CandidateFixture.message({
        pictureDataUrls: [PICTURE],
        setupKeyTexts: [],
      }),
    )

    const failure = result._unsafeUnwrapErr()
    expect(failure.kind).toBe(SessionOperationFailureKind.Failed)
    expect(failure.message).toBe(SessionOperationFailureKind.Failed)
  })

  test.each([
    {
      name: 'too many pictures',
      payload: {
        pictureDataUrls: Array.from(
          { length: AuthenticatorEnrollmentSourceBound.MaxPictures + 1 },
          () => PICTURE,
        ),
        setupKeyTexts: [],
      },
    },
    {
      name: 'a picture that is not a PNG data URL',
      payload: {
        pictureDataUrls: ['data:image/svg+xml;base64,PHN2Zy8+'],
        setupKeyTexts: [],
      },
    },
    {
      name: 'a picture over the data URL bound',
      payload: {
        pictureDataUrls: [
          PICTURE.padEnd(
            AuthenticatorEnrollmentSourceBound.MaxPictureDataUrlLength + 1,
            'A',
          ),
        ],
        setupKeyTexts: [],
      },
    },
    {
      name: 'a picture with malformed base64',
      payload: {
        pictureDataUrls: [`${PNG_DATA_URL_PREFIX}not base64!`],
        setupKeyTexts: [],
      },
    },
    {
      name: 'too many setup-key texts',
      payload: {
        pictureDataUrls: [],
        setupKeyTexts: Array.from(
          { length: AuthenticatorEnrollmentSourceBound.MaxSetupKeyTexts + 1 },
          (_, index) => `${SETUP_KEY} ${index}`,
        ),
      },
    },
    {
      name: 'a setup-key text over 256 UTF-8 bytes',
      payload: { pictureDataUrls: [], setupKeyTexts: ['ж'.repeat(129)] },
    },
  ])('rejects $name before resolving anything', async ({ payload }) => {
    const readImage = CandidateFixture.decoding([OTPAUTH_QR_TEXT])

    const result = await CandidateFixture.resolver(readImage).resolve(
      CandidateFixture.message(payload),
    )

    expect(result._unsafeUnwrapErr().kind).toBe(
      SessionOperationFailureKind.InvalidRequest,
    )
    expect(readImage).not.toHaveBeenCalled()
  })
})
