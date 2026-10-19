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
  AuthenticatorEnrollmentSourcesRequestDecoder,
  PNG_DATA_URL_PREFIX,
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

type QrPictureReader = Pick<QrCodeReader, 'readImage'>

/** What the resolver needs from the offscreen document; tests supply their own. */
export type AuthenticatorEnrollmentCandidateResolution = {
  readonly reader: () => QrPictureReader
  readonly ensureWasm: () => ReturnType<typeof initNookWasm>
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

type PictureTextsRequest = {
  readonly reader: QrPictureReader
  readonly pngDataUrl: string
}

const PNG_MEDIA_TYPE = 'image/png'

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
    // Decoded QR texts and the copied setup-key texts are cleared however the
    // request ends, including when the vault WASM cannot start.
    const qrPayloads: string[] = []
    const setupKeyTexts: string[] = []
    const clearTexts = Effect.sync(() => {
      qrPayloads.fill('')
      setupKeyTexts.fill('')
    })
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
          setupKeyTexts.push(...request.payload.setupKeyTexts)
          for (const pngDataUrl of request.payload.pictureDataUrls) {
            const pictureRequest: PictureTextsRequest = { reader, pngDataUrl }
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
              setupKeyTexts,
              pageOrigin: request.origin,
            }
          return yield* Effect.try(() =>
            resolve_authenticator_enrollment_candidates(candidateRequest),
          ).pipe(
            Effect.mapError(() =>
              this.failure(SessionOperationFailureKind.Failed),
            ),
          )
        }.bind(this),
      ).pipe(Effect.ensuring(clearTexts), Effect.match(this.resultOutcome)),
    )
  }

  private pictureTexts({
    reader,
    pngDataUrl,
  }: PictureTextsRequest): Effect.Effect<QrCodeTexts, SessionOperationFailure> {
    // The request decoder admitted only bounded PNG data URLs; malformed
    // base64 rejects the request rather than skipping a picture.
    const blobOptions: BlobPropertyBag = { type: PNG_MEDIA_TYPE }
    const picture = Effect.try(() => {
      const bytes = Uint8Array.from(
        atob(pngDataUrl.slice(PNG_DATA_URL_PREFIX.length)),
        (character) => character.charCodeAt(0),
      )
      return new Blob([bytes], blobOptions)
    }).pipe(
      Effect.mapError(() =>
        this.failure(SessionOperationFailureKind.InvalidRequest),
      ),
    )
    const read = (image: Blob) =>
      reader.readImage(image).pipe(Effect.catch(this.unreadablePictureSkip))
    return picture.pipe(Effect.andThen(read))
  }

  /** A picture ZXing cannot read is skipped; a reader that cannot load fails. */
  private readonly unreadablePictureSkip = (
    failure: QrCodeReadFailure,
  ): Effect.Effect<QrCodeTexts, SessionOperationFailure> => {
    switch (failure.kind) {
      case QrCodeReadFailureKind.PictureUnreadable: {
        const unreadable: QrCodeTexts = []
        return Effect.succeed(unreadable)
      }
      case QrCodeReadFailureKind.ReaderUnavailable:
        return Effect.fail(this.failure(SessionOperationFailureKind.Failed))
    }
  }

  private failure(kind: SessionOperationFailureKind): SessionOperationFailure {
    return new SessionOperationFailure(kind)
  }
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
}

export const authenticatorEnrollmentCandidateResolver =
  new AuthenticatorEnrollmentCandidateResolver(offscreenResolution)
