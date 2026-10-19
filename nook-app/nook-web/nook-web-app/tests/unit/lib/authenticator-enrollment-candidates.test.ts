import { Effect } from 'effect'
import { describe, expect, test, vi } from 'vitest'
import initNookWasm, {
  preview_otpauth_uri,
  resolve_authenticator_enrollment_candidates,
  type NookAuthenticatorEnrollmentCandidateRequest,
} from '../../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import {
  QrCodeReader,
  QrCodeReadFailure,
  QrCodeReadFailureKind,
} from '../../../../nook-web-shared/src/vault-app/lib/qr/qr-code-reader'
import { QrCodeReaderWasm } from '../../../../nook-web-shared/src/vault-app/lib/qr/qr-code-reader-wasm'
import {
  AuthenticatorEnrollmentPictureCodec,
  AuthenticatorEnrollmentSourceBound,
  type AuthenticatorEnrollmentPicture,
} from '../../../../nook-web-shared/src/extension/authenticator-enrollment-candidates'
import { CompanionWasmSessionMessageType } from '../../../../nook-web-shared/src/extension/companion-wasm-runtime-messages'
import {
  AuthenticatorEnrollmentCandidateResolver,
  type AuthenticatorEnrollmentCandidateResolution,
  type AuthenticatorEnrollmentCandidatesMessage,
} from '../../../../nook-web-extension/src/offscreen/authenticator-enrollment-candidates'
import { SessionOperationFailureKind } from '../../../../nook-web-extension/src/lib/session-operation-queue'
import {
  NON_OTPAUTH_QR_MODULES,
  NON_OTPAUTH_QR_TEXT,
  OTPAUTH_QR_MODULES,
  type QrModuleRows,
} from '../../fixtures/otpauth-qr-modules'
import { QrModuleRaster } from '../../fixtures/qr-module-raster'

const PAGE_ORIGIN = 'https://www.demo.example.test'
const SETUP_KEY = 'JBSW Y3DP EHPK 3PXP'

const pictureCodec = new AuthenticatorEnrollmentPictureCodec()

class CandidateFixture {
  static picture(modules: QrModuleRows): AuthenticatorEnrollmentPicture {
    const raster = new QrModuleRaster({ modules, modulePx: 4 })
    return pictureCodec.encode(raster.pixels())
  }

  static message(
    payload: AuthenticatorEnrollmentCandidatesMessage['payload'],
  ): AuthenticatorEnrollmentCandidatesMessage {
    const runtimeMessage: AuthenticatorEnrollmentCandidatesMessage & {
      readonly origin: string
    } = {
      type: CompanionWasmSessionMessageType.ResolveAuthenticatorEnrollmentCandidates,
      payload,
      origin: PAGE_ORIGIN,
    }
    return runtimeMessage
  }

  /** The production pieces: the bundled ZXing reader and the generated Rust export. */
  static realResolver(): AuthenticatorEnrollmentCandidateResolver {
    const reader = new QrCodeReader(new QrCodeReaderWasm('zxing_reader.wasm'))
    return new AuthenticatorEnrollmentCandidateResolver({
      reader: () => reader,
      ensureWasm: () => initNookWasm(),
      resolveCandidates: resolve_authenticator_enrollment_candidates,
    })
  }
}

describe('offscreen authenticator enrollment candidates', () => {
  test('decodes a real otpauth QR with ZXing and keeps only what Rust accepts', async () => {
    const result = await CandidateFixture.realResolver().resolve(
      CandidateFixture.message({
        pictures: [
          CandidateFixture.picture(NON_OTPAUTH_QR_MODULES),
          CandidateFixture.picture(OTPAUTH_QR_MODULES),
        ],
        setupKeyTexts: [],
      }),
    )

    const { candidates } = result._unsafeUnwrap()
    expect(candidates.map((candidate) => candidate.source)).toEqual(['qr'])
    expect(JSON.stringify(candidates)).not.toContain(NON_OTPAUTH_QR_TEXT)
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
    const result = await CandidateFixture.realResolver().resolve(
      CandidateFixture.message({
        pictures: [],
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
    const result = await CandidateFixture.realResolver().resolve(
      CandidateFixture.message({
        pictures: [CandidateFixture.picture(OTPAUTH_QR_MODULES)],
        setupKeyTexts: [SETUP_KEY],
      }),
    )

    expect(
      result._unsafeUnwrap().candidates.map((candidate) => candidate.source),
    ).toEqual(['qr'])
  })

  test('hands every decoded QR text to Rust and returns only its candidates, then clears the request', async () => {
    const requests: NookAuthenticatorEnrollmentCandidateRequest[] = []
    const accepted = {
      candidates: [
        {
          source: 'qr' as const,
          otpauthUri: 'otpauth://totp/Accepted:person?secret=JBSWY3DPEHPK3PXP',
        },
      ],
    }
    const resolution: AuthenticatorEnrollmentCandidateResolution = {
      reader: () => ({
        readPixels: () => Effect.succeed([NON_OTPAUTH_QR_TEXT]),
      }),
      ensureWasm: () => initNookWasm(),
      resolveCandidates: (request) => {
        requests.push(request)
        expect(request).toEqual({
          qrPayloads: [NON_OTPAUTH_QR_TEXT],
          setupKeyTexts: [SETUP_KEY],
          pageOrigin: PAGE_ORIGIN,
        })
        return accepted
      },
    }

    const result = await new AuthenticatorEnrollmentCandidateResolver(
      resolution,
    ).resolve(
      CandidateFixture.message({
        pictures: [CandidateFixture.picture(OTPAUTH_QR_MODULES)],
        setupKeyTexts: [SETUP_KEY],
      }),
    )

    expect(result._unsafeUnwrap()).toBe(accepted)
    expect(requests[0]?.qrPayloads).toEqual([''])
    expect(requests[0]?.setupKeyTexts).toEqual([''])
  })

  test('skips an unreadable picture but fails closed when the reader cannot load', async () => {
    const readPixels = vi
      .fn<QrCodeReader['readPixels']>()
      .mockReturnValueOnce(
        Effect.fail(
          QrCodeReadFailure.of(QrCodeReadFailureKind.PictureUnreadable),
        ),
      )
      .mockReturnValueOnce(Effect.succeed(['otpauth://totp/A:b?secret=X']))
    const resolveCandidates = vi.fn(() => ({ candidates: [] }))
    const skipping = new AuthenticatorEnrollmentCandidateResolver({
      reader: () => ({ readPixels }),
      ensureWasm: () => initNookWasm(),
      resolveCandidates,
    })
    const twoPictures = CandidateFixture.message({
      pictures: [
        CandidateFixture.picture(OTPAUTH_QR_MODULES),
        CandidateFixture.picture(OTPAUTH_QR_MODULES),
      ],
      setupKeyTexts: [],
    })

    expect((await skipping.resolve(twoPictures)).isOk()).toBe(true)
    expect(resolveCandidates).toHaveBeenCalledOnce()

    const unavailable = new AuthenticatorEnrollmentCandidateResolver({
      reader: () => ({
        readPixels: () =>
          Effect.fail(
            QrCodeReadFailure.of(QrCodeReadFailureKind.ReaderUnavailable),
          ),
      }),
      ensureWasm: () => initNookWasm(),
      resolveCandidates,
    })
    const failed = await unavailable.resolve(twoPictures)
    expect(failed._unsafeUnwrapErr().kind).toBe(
      SessionOperationFailureKind.Failed,
    )
    expect(resolveCandidates).toHaveBeenCalledOnce()
  })

  test('maps a Rust rejection to the generic failure without its text', async () => {
    const resolver = new AuthenticatorEnrollmentCandidateResolver({
      reader: () => ({ readPixels: () => Effect.succeed([]) }),
      ensureWasm: () => initNookWasm(),
      resolveCandidates: () => {
        throw new Error('setup key text exceeds 256 bytes')
      },
    })

    const result = await resolver.resolve(
      CandidateFixture.message({ pictures: [], setupKeyTexts: [SETUP_KEY] }),
    )

    expect(result._unsafeUnwrapErr().kind).toBe(
      SessionOperationFailureKind.Failed,
    )
  })

  test.each([
    {
      name: 'too many pictures',
      payload: {
        pictures: Array.from(
          { length: AuthenticatorEnrollmentSourceBound.MaxPictures + 1 },
          () => CandidateFixture.picture(NON_OTPAUTH_QR_MODULES),
        ),
        setupKeyTexts: [],
      },
    },
    {
      name: 'a picture larger than the edge bound',
      payload: {
        pictures: [{ width: 513, height: 1, rgbaBase64: 'AAAA' }],
        setupKeyTexts: [],
      },
    },
    {
      name: 'base64 that does not hold width × height × 4 bytes',
      payload: {
        pictures: [{ width: 2, height: 2, rgbaBase64: 'AAAA' }],
        setupKeyTexts: [],
      },
    },
    {
      name: 'too many setup-key texts',
      payload: {
        pictures: [],
        setupKeyTexts: Array.from(
          { length: AuthenticatorEnrollmentSourceBound.MaxSetupKeyTexts + 1 },
          (_, index) => `${SETUP_KEY} ${index}`,
        ),
      },
    },
    {
      name: 'a setup-key text over 256 UTF-8 bytes',
      payload: { pictures: [], setupKeyTexts: ['ж'.repeat(129)] },
    },
  ])('rejects $name before decoding anything', async ({ payload }) => {
    const readPixels = vi.fn<QrCodeReader['readPixels']>()
    const resolveCandidates = vi.fn(() => ({ candidates: [] }))
    const resolver = new AuthenticatorEnrollmentCandidateResolver({
      reader: () => ({ readPixels }),
      ensureWasm: () => initNookWasm(),
      resolveCandidates,
    })

    const result = await resolver.resolve(CandidateFixture.message(payload))

    expect(result._unsafeUnwrapErr().kind).toBe(
      SessionOperationFailureKind.InvalidRequest,
    )
    expect(readPixels).not.toHaveBeenCalled()
    expect(resolveCandidates).not.toHaveBeenCalled()
  })
})
