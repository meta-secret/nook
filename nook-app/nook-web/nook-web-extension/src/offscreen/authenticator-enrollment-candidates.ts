import { Effect, Schema } from 'effect'
import { err, ok, type Result } from 'neverthrow'
import type initNookWasm from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import {
  resolve_authenticator_enrollment_candidates,
  type NookAuthenticatorEnrollmentCandidateRequest,
  type NookAuthenticatorEnrollmentCandidates,
} from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import {
  QrCodeReader,
  QrCodeReadFailure,
  QrCodeReadFailureKind,
  type QrCodeTexts,
} from '../../../nook-web-shared/src/vault-app/lib/qr/qr-code-reader'
import { QrCodeReaderWasm } from '../../../nook-web-shared/src/vault-app/lib/qr/qr-code-reader-wasm'
import {
  AuthenticatorEnrollmentPictureCodec,
  AuthenticatorEnrollmentSourcesRequestDecoder,
  type AuthenticatorEnrollmentPicture,
} from '../../../nook-web-shared/src/extension/authenticator-enrollment-candidates'
import type {
  CompanionWasmSessionMessage,
  CompanionWasmSessionMessageType,
} from '../../../nook-web-shared/src/extension/companion-wasm-runtime-messages'
import {
  SessionOperationFailure,
  SessionOperationFailureKind,
} from '../lib/session-operation-queue'
import { vaultWasmStartup } from './vault-wasm-startup'

export type AuthenticatorEnrollmentCandidatesMessage = Extract<
  CompanionWasmSessionMessage,
  {
    readonly type: CompanionWasmSessionMessageType.ResolveAuthenticatorEnrollmentCandidates
  }
>

type QrPictureReader = Pick<QrCodeReader, 'readPixels'>

/** What the resolver needs from the offscreen document; tests supply their own. */
export type AuthenticatorEnrollmentCandidateResolution = {
  readonly reader: () => QrPictureReader
  readonly ensureWasm: () => ReturnType<typeof initNookWasm>
  readonly resolveCandidates: typeof resolve_authenticator_enrollment_candidates
}

type CandidateResolutionResult = Result<
  NookAuthenticatorEnrollmentCandidates,
  SessionOperationFailure
>

type CandidateResolutionOutcome = {
  readonly onFailure: (
    failure: SessionOperationFailure,
  ) => CandidateResolutionResult
  readonly onSuccess: (
    candidates: NookAuthenticatorEnrollmentCandidates,
  ) => CandidateResolutionResult
}

/**
 * Decodes the pictures a trusted click captured with the bundled ZXing reader,
 * then lets Rust accept otpauth candidates from them and the setup-key texts.
 *
 * Every decoded QR text reaches Rust, which drops non-otpauth payloads; only
 * the candidates Rust returns leave this document. Decoded texts are never
 * logged. A picture ZXing cannot read is skipped, as a page may show other
 * media; a reader that cannot load fails the whole request.
 */
export class AuthenticatorEnrollmentCandidateResolver {
  private readonly pictures = new AuthenticatorEnrollmentPictureCodec()
  private readonly resultOutcome: CandidateResolutionOutcome = {
    onFailure: (failure) => err(failure),
    onSuccess: (candidates) => ok(candidates),
  }

  constructor(
    private readonly resolution: AuthenticatorEnrollmentCandidateResolution,
  ) {}

  resolve(
    message: AuthenticatorEnrollmentCandidatesMessage,
  ): Promise<CandidateResolutionResult> {
    return Effect.runPromise(
      Effect.gen(
        function* resolveCandidates(
          this: AuthenticatorEnrollmentCandidateResolver,
        ) {
          const request = yield* Schema.decodeUnknownEffect(
            AuthenticatorEnrollmentSourcesRequestDecoder,
          )(message).pipe(
            Effect.mapError(() =>
              this.failure(SessionOperationFailureKind.InvalidRequest),
            ),
          )
          const reader = this.resolution.reader()
          const qrPayloads: string[] = []
          for (const picture of request.payload.pictures) {
            const pictureRequest: PictureTextsRequest = { reader, picture }
            const texts = yield* this.pictureTexts(pictureRequest)
            qrPayloads.push(...texts)
          }
          yield* Effect.tryPromise(() => this.resolution.ensureWasm()).pipe(
            Effect.mapError(() =>
              this.failure(SessionOperationFailureKind.Failed),
            ),
          )
          const candidateRequest: NookAuthenticatorEnrollmentCandidateRequest =
            {
              qrPayloads,
              setupKeyTexts: [...request.payload.setupKeyTexts],
              pageOrigin: request.origin,
            }
          return yield* Effect.try(() =>
            this.resolution.resolveCandidates(candidateRequest),
          ).pipe(
            Effect.mapError(() =>
              this.failure(SessionOperationFailureKind.Failed),
            ),
            Effect.ensuring(
              Effect.sync(() => {
                qrPayloads.fill('')
                candidateRequest.setupKeyTexts.fill('')
              }),
            ),
          )
        }.bind(this),
      ).pipe(Effect.match(this.resultOutcome)),
    )
  }

  private pictureTexts({
    reader,
    picture,
  }: PictureTextsRequest): Effect.Effect<QrCodeTexts, SessionOperationFailure> {
    return reader.readPixels(this.pictures.decode(picture)).pipe(
      Effect.catch((failure: QrCodeReadFailure) => {
        switch (failure.kind) {
          case QrCodeReadFailureKind.PictureUnreadable: {
            const unreadable: QrCodeTexts = []
            return Effect.succeed(unreadable)
          }
          case QrCodeReadFailureKind.ReaderUnavailable:
            return Effect.fail(this.failure(SessionOperationFailureKind.Failed))
        }
      }),
    )
  }

  private failure(kind: SessionOperationFailureKind): SessionOperationFailure {
    return new SessionOperationFailure(kind)
  }
}

type PictureTextsRequest = {
  readonly reader: QrPictureReader
  readonly picture: AuthenticatorEnrollmentPicture
}

enum OffscreenQrReaderKind {
  Unopened = 'unopened',
  Open = 'open',
}

type OffscreenQrReader =
  | { readonly kind: OffscreenQrReaderKind.Unopened }
  | { readonly kind: OffscreenQrReaderKind.Open; readonly reader: QrCodeReader }

/** The offscreen document's one ZXing reader, served from the extension package. */
class OffscreenQrReaderOwner {
  private state: OffscreenQrReader = { kind: OffscreenQrReaderKind.Unopened }

  reader(): QrCodeReader {
    switch (this.state.kind) {
      case OffscreenQrReaderKind.Open:
        return this.state.reader
      case OffscreenQrReaderKind.Unopened:
        break
    }
    // The extension build copies zxing_reader.wasm beside session.html.
    const wasm = new QrCodeReaderWasm(
      chrome.runtime.getURL('offscreen/zxing_reader.wasm'),
    )
    const reader = new QrCodeReader(wasm)
    this.state = { kind: OffscreenQrReaderKind.Open, reader }
    return reader
  }
}

const offscreenQrReader = new OffscreenQrReaderOwner()

const offscreenResolution: AuthenticatorEnrollmentCandidateResolution = {
  reader: () => offscreenQrReader.reader(),
  ensureWasm: () => vaultWasmStartup.ensure(),
  resolveCandidates: resolve_authenticator_enrollment_candidates,
}

export const authenticatorEnrollmentCandidateResolver =
  new AuthenticatorEnrollmentCandidateResolver(offscreenResolution)
