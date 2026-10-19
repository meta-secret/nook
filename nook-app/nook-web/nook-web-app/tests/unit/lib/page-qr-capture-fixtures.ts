import { vi } from 'vitest'
import {
  classify_authentication_authenticator_setup_batch,
  type AuthenticationAuthenticatorSetupBatch,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm'
import {
  CompanionWasmSessionMessageType,
  type CompanionWasmAuthenticatorSetupResponse,
  type CompanionWasmRuntimeMessage,
} from '../../../../nook-web-shared/src/extension/companion-wasm-runtime-messages'
import type { NookAuthenticatorEnrollmentCandidates } from '../../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import { pageQrCapture } from '../../../../nook-web-extension/src/lib/page-qr-capture'

type SetupObservationRuntimeRequest = Extract<
  CompanionWasmRuntimeMessage,
  {
    type: CompanionWasmSessionMessageType.AuthenticationAuthenticatorSetupObservation
  }
>

type SetupObservationRuntimeResponse = {
  readonly ok: true
  readonly result: CompanionWasmAuthenticatorSetupResponse
}

type ResolveCandidatesRuntimeRequest = Extract<
  CompanionWasmRuntimeMessage,
  {
    type: CompanionWasmSessionMessageType.ResolveAuthenticatorEnrollmentCandidates
  }
>

export type ResolveCandidatesRuntimeResponse =
  | {
      readonly ok: true
      readonly result: NookAuthenticatorEnrollmentCandidates
    }
  // A delivered reply in the wrong shape, which the page must reject.
  | { readonly ok: true; readonly result: { readonly unexpected: string } }
  | { readonly ok: false }

/** A portaled modal like the reported "Update authenticator app" dialog. */
export class DialogQrObservationFixture {
  static readonly QR_SVG =
    '<svg viewBox="0 0 29 29" role="img"><path fill="#000000" d="M0 0h7v7H0zM22 0h7v7h-7zM0 22h7v7H0z"/></svg>'

  static authenticatorDialog(media: string): string {
    return `
      <main aria-hidden="true"><h1>Account settings</h1><p>Manage your security</p></main>
      <div role="dialog" aria-modal="true" aria-labelledby="mfa-title" aria-describedby="mfa-description">
        <div>
          <div id="mfa-title">Update authenticator app</div>
          <button aria-label="Close"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6 6l12 12"/></svg></button>
        </div>
        <div id="mfa-description">Scan this QR code to set up your account using your preferred authenticator app. Popular choices include <a href="https://support.google.com/accounts/answer/1066447">Google Authenticator</a>, <a href="https://www.microsoft.com/security/mobile-authenticator-app">Microsoft Authenticator</a>, and <a href="https://authy.com">Authy</a>.</div>
        ${media}
        <a href="#manual-setup">Enter code manually</a>
        <div><button type="button">Cancel</button><button type="button">Continue</button></div>
      </div>
    `
  }

  readonly payloads: AuthenticationAuthenticatorSetupBatch[] = []
  /** Every candidate request the page sent; only the trusted decode sends one. */
  readonly resolveRequests: ResolveCandidatesRuntimeRequest[] = []
  /** The same requests as sent, to observe what the page clears afterwards. */
  readonly resolveMessages: ResolveCandidatesRuntimeRequest[] = []
  /** What the stubbed offscreen decoder answers, Rust's accepted candidates. */
  resolution: ResolveCandidatesRuntimeResponse = {
    ok: true,
    result: { candidates: [] },
  }

  constructor(markup: string) {
    document.body.innerHTML = markup
    for (const element of document.querySelectorAll(
      'img,canvas,svg,h1,h2,h3,h4,h5,h6,p,div,span,strong,b,mark,code,kbd,samp,input',
    )) {
      Object.defineProperty(element, 'getBoundingClientRect', {
        configurable: true,
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
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage: (
          message:
            SetupObservationRuntimeRequest | ResolveCandidatesRuntimeRequest,
          callback: (
            response:
              | SetupObservationRuntimeResponse
              | ResolveCandidatesRuntimeResponse,
          ) => void,
        ): void => {
          switch (message.type) {
            case CompanionWasmSessionMessageType.ResolveAuthenticatorEnrollmentCandidates:
              this.resolveRequests.push(structuredClone(message))
              this.resolveMessages.push(message)
              callback(this.resolution)
              return
            case CompanionWasmSessionMessageType.AuthenticationAuthenticatorSetupObservation:
              this.payloads.push(message.payload)
              callback({
                ok: true,
                result: {
                  authenticatorSetupObservation:
                    classify_authentication_authenticator_setup_batch(
                      message.payload,
                    ),
                },
              })
          }
        },
      },
    })
  }

  /** Every setup-key text candidate sent across all trusted decodes. */
  get resolvedSetupKeyTexts(): readonly string[] {
    return this.resolveRequests.flatMap(
      (request) => request.payload.setupKeyTexts,
    )
  }

  async observation() {
    const snapshot =
      await pageQrCapture.prepareAuthenticationAuthenticatorSetupObservation()
    return snapshot.observation
  }

  get instructionCopies(): readonly string[] {
    const payload = this.payloads.at(-1)
    if (!payload) throw new Error('Setup metadata was not sent.')
    return payload.visibleInstructionCopies
  }
}

export enum RasterOperationKind {
  FillRect = 'fillRect',
  DrawImage = 'drawImage',
}

type RasterOperation = {
  readonly operation: RasterOperationKind
  readonly fillStyle: string
  readonly source: string
}

/** Stands in for Chromium's image decode, 2D canvas, and PNG encoding. */
export class QrRasterDecodeFixture {
  readonly operations: RasterOperation[] = []
  readonly decodedSources: string[] = []
  /** Each opaque canvas encoded for transport: its size and image type. */
  readonly copiedSizes: string[] = []
  private readonly originalDecode = Object.getOwnPropertyDescriptor(
    HTMLImageElement.prototype,
    'decode',
  )
  private readonly originalGetContext = Object.getOwnPropertyDescriptor(
    HTMLCanvasElement.prototype,
    'getContext',
  )
  private readonly originalToDataUrl = Object.getOwnPropertyDescriptor(
    HTMLCanvasElement.prototype,
    'toDataURL',
  )
  /** What the stubbed canvas encodes every opaque picture as. */
  static readonly PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgo='

  install(): void {
    const { operations, decodedSources, copiedSizes } = this
    Object.defineProperty(HTMLImageElement.prototype, 'decode', {
      configurable: true,
      value(this: HTMLImageElement): Promise<void> {
        decodedSources.push(this.src)
        return Promise.resolve()
      },
    })
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value() {
        const context = {
          fillStyle: '',
          fillRect() {
            operations.push({
              operation: RasterOperationKind.FillRect,
              fillStyle: context.fillStyle,
              source: '',
            })
          },
          drawImage(source: HTMLImageElement) {
            operations.push({
              operation: RasterOperationKind.DrawImage,
              fillStyle: context.fillStyle,
              source: source.src,
            })
          },
        }
        return context
      },
    })
    Object.defineProperty(HTMLCanvasElement.prototype, 'toDataURL', {
      configurable: true,
      value(this: HTMLCanvasElement, type: string): string {
        copiedSizes.push(`${this.width}x${this.height} ${type}`)
        return QrRasterDecodeFixture.PNG_DATA_URL
      },
    })
  }

  restore(): void {
    if (this.originalDecode) {
      Object.defineProperty(
        HTMLImageElement.prototype,
        'decode',
        this.originalDecode,
      )
    } else {
      Reflect.deleteProperty(HTMLImageElement.prototype, 'decode')
    }
    if (this.originalGetContext) {
      Object.defineProperty(
        HTMLCanvasElement.prototype,
        'getContext',
        this.originalGetContext,
      )
    } else {
      Reflect.deleteProperty(HTMLCanvasElement.prototype, 'getContext')
    }
    if (this.originalToDataUrl) {
      Object.defineProperty(
        HTMLCanvasElement.prototype,
        'toDataURL',
        this.originalToDataUrl,
      )
    } else {
      Reflect.deleteProperty(HTMLCanvasElement.prototype, 'toDataURL')
    }
  }
}
