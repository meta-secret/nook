import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { pageQrCapture } from '../../../../nook-web-extension/src/lib/page-qr-capture'
import {
  classify_authentication_authenticator_setup_batch,
  type AuthenticationAuthenticatorSetupBatch,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm'
import type {
  CompanionWasmRuntimeMessage,
  CompanionWasmAuthenticatorSetupResponse,
} from '../../../../nook-web-shared/src/extension/companion-wasm-runtime-messages'
import { CompanionWasmSessionMessageType } from '../../../../nook-web-shared/src/extension/companion-wasm-runtime-messages'

const rejectedSetupMetadataResults = [
  'absent',
  {},
  { authenticatorSetupObservation: 'unsupported' },
]
type SetupMetadataRuntimeResponse =
  | {
      readonly ok: true
      readonly result:
        | CompanionWasmAuthenticatorSetupResponse
        | (typeof rejectedSetupMetadataResults)[number]
    }
  | { readonly ok: false }

beforeEach(() => {
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage(
        message: Extract<
          CompanionWasmRuntimeMessage,
          {
            type: CompanionWasmSessionMessageType.AuthenticationAuthenticatorSetupObservation
          }
        >,
        callback: (response: SetupMetadataRuntimeResponse) => void,
      ) {
        expect(message.type).toBe(
          CompanionWasmSessionMessageType.AuthenticationAuthenticatorSetupObservation,
        )
        callback({
          ok: true,
          result: {
            authenticatorSetupObservation:
              classify_authentication_authenticator_setup_batch(
                message.payload,
              ),
          },
        })
      },
    },
  })
})

afterEach(() => {
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

class PageQrObservationFixture {
  constructor(markup: string) {
    document.body.innerHTML = markup
    for (const element of document.querySelectorAll('img,canvas,h1,h2,p')) {
      Object.defineProperty(element, 'getBoundingClientRect', {
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
  }

  get observation() {
    return pageQrCapture.authenticationAuthenticatorSetupObservation()
  }

  async prepare(): Promise<void> {
    await pageQrCapture.prepareAuthenticationAuthenticatorSetupObservation()
  }
}

type SetupMetadataRuntimeRequest = Extract<
  CompanionWasmRuntimeMessage,
  {
    type: CompanionWasmSessionMessageType.AuthenticationAuthenticatorSetupObservation
  }
>

class DeferredSetupObservationFixture {
  private readonly requests: Array<{
    readonly message: SetupMetadataRuntimeRequest
    readonly callback: (response: SetupMetadataRuntimeResponse) => void
  }> = []

  install(): void {
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage: (
          message: SetupMetadataRuntimeRequest,
          callback: (response: SetupMetadataRuntimeResponse) => void,
        ): void => {
          const request: (typeof this.requests)[number] = { message, callback }
          this.requests.push(request)
        },
      },
    })
  }

  deliver(index: number): void {
    const request = this.requests[index]
    if (!request) throw new Error('Setup metadata request is missing.')
    request.callback({
      ok: true,
      result: {
        authenticatorSetupObservation:
          classify_authentication_authenticator_setup_batch(
            request.message.payload,
          ),
      },
    })
  }
}

/** A portaled modal like the reported "Update authenticator app" dialog. */
class DialogQrObservationFixture {
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

  constructor(markup: string) {
    document.body.innerHTML = markup
    for (const element of document.querySelectorAll(
      'img,canvas,svg,h1,h2,p,div,span',
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
          message: SetupMetadataRuntimeRequest,
          callback: (response: SetupMetadataRuntimeResponse) => void,
        ): void => {
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
        },
      },
    })
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

type RasterOperation = {
  readonly operation: 'fillRect' | 'drawImage'
  readonly fillStyle: string
  readonly source: string
}

/** Stands in for Chromium's image decode, 2D canvas, and BarcodeDetector. */
class QrRasterDecodeFixture {
  readonly operations: RasterOperation[] = []
  readonly decodedSources: string[] = []
  readonly bitmapSources: string[] = []
  readonly detectedSources: string[] = []
  readonly closedBitmaps: string[] = []
  private readonly originalDecode = Object.getOwnPropertyDescriptor(
    HTMLImageElement.prototype,
    'decode',
  )
  private readonly originalGetContext = Object.getOwnPropertyDescriptor(
    HTMLCanvasElement.prototype,
    'getContext',
  )

  constructor(private readonly decodedValue: string) {}

  install(): void {
    const { operations, decodedSources, bitmapSources, detectedSources } = this
    const { closedBitmaps, decodedValue } = this
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
              operation: 'fillRect',
              fillStyle: context.fillStyle,
              source: '',
            })
          },
          drawImage(source: HTMLImageElement) {
            operations.push({
              operation: 'drawImage',
              fillStyle: context.fillStyle,
              source: source.src,
            })
          },
        }
        return context
      },
    })
    vi.stubGlobal('createImageBitmap', (source: HTMLCanvasElement) => {
      bitmapSources.push(source.tagName.toLowerCase())
      return Promise.resolve({
        label: 'opaque-canvas',
        close: () => closedBitmaps.push('opaque-canvas'),
      })
    })
    vi.stubGlobal(
      'BarcodeDetector',
      class {
        detect(source: { readonly label: string }) {
          detectedSources.push(source.label)
          return Promise.resolve([
            { rawValue: decodedValue, format: 'qr_code' },
          ])
        }
      },
    )
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
  }
}

describe('page QR otpauth capture', () => {
  test('keeps each scan snapshot when overlapping responses finish in reverse order', async () => {
    const runtime = new DeferredSetupObservationFixture()
    runtime.install()
    new PageQrObservationFixture(
      '<section><p>Scan this QR code with your authenticator app</p><img/></section>',
    )
    const firstPreparation =
      pageQrCapture.prepareAuthenticationAuthenticatorSetupObservation()
    new PageQrObservationFixture('<form><p>Sign in</p></form>')
    const secondPreparation =
      pageQrCapture.prepareAuthenticationAuthenticatorSetupObservation()
    runtime.deliver(1)
    const second = await secondPreparation
    runtime.deliver(0)
    const first = await firstPreparation

    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(second)).toBe(true)
    expect(first.observation).toBe('present')
    expect(second.observation).toBe('absent')
    expect(
      pageQrCapture.authenticationAuthenticatorSetupSnapshotIsCurrent(first),
    ).toBe(false)
    expect(
      pageQrCapture.authenticationAuthenticatorSetupSnapshotIsCurrent(second),
    ).toBe(true)
    expect(() =>
      pageQrCapture.authenticationAuthenticatorSetupObservation(),
    ).toThrow('stale')
  })

  test('rejects a snapshot whose DOM metadata changes while its response is pending', async () => {
    const runtime = new DeferredSetupObservationFixture()
    runtime.install()
    new PageQrObservationFixture('<section><p>Sign in</p><img/></section>')
    const preparation =
      pageQrCapture.prepareAuthenticationAuthenticatorSetupObservation()
    const paragraph = document.querySelector('p')
    if (!paragraph) throw new Error('Fixture instruction is missing.')
    paragraph.textContent = 'Scan this QR code with your authenticator app'
    runtime.deliver(0)
    const snapshot = await preparation
    expect(
      pageQrCapture.authenticationAuthenticatorSetupSnapshotIsCurrent(snapshot),
    ).toBe(false)
    expect(() =>
      pageQrCapture.authenticationAuthenticatorSetupObservation(),
    ).toThrow('stale')
  })

  test('nearby visible setup instructions admit generic media', async () => {
    const fixture = new PageQrObservationFixture(
      '<section><h1>Authenticator setup</h1><p>Scan this QR code with your authenticator app</p><img alt="Code"/></section>',
    )
    await fixture.prepare()
    expect(fixture.observation).toBe('present')
  })

  test('hidden, remote, and secret-bearing paragraphs do not supply instructions', async () => {
    for (const markup of [
      '<section><p hidden>Scan this QR code with your authenticator app</p><img/></section>',
      '<section><p>Scan this QR code with your authenticator app</p></section><section><img/></section>',
      '<section><div role="group"><p>Scan this QR code with your authenticator app</p></div><img/></section>',
      '<section><p>Scan this QR code with your authenticator app <code>JBSWY3DPEHPK3PXP</code></p><img/></section>',
      '<section><p data-nook-backup-codes>Scan this QR code with your authenticator app</p><img/></section>',
      '<section><input value="Scan this QR code with your authenticator app"/><img data-nook-otpauth-uri="otpauth://totp/Example?secret=JBSWY3DPEHPK3PXP"/></section>',
      '<section><p>Scan this QR code to download our app</p><img alt="Authenticator QR code"/></section>',
    ]) {
      const fixture = new PageQrObservationFixture(markup)
      await fixture.prepare()
      expect(fixture.observation).toBe('absent')
    }
  })

  test('instruction copy stays within the generated UTF-8 byte bound', async () => {
    const fixture = new PageQrObservationFixture(
      `<section><p>${'é'.repeat(300)}</p><img/></section>`,
    )
    await fixture.prepare()
    expect(fixture.observation).toBe('absent')
  })

  test('omits secret-bearing paragraphs before reading their text', async () => {
    const fixture = new PageQrObservationFixture(
      '<section><p>Scan this QR code with your authenticator app <code>setup key</code></p><img/></section>',
    )
    for (const paragraph of document.querySelectorAll('p')) {
      Object.defineProperty(paragraph, 'innerText', {
        get: () => {
          throw new Error('Secret-bearing text must not be observed')
        },
      })
    }
    await fixture.prepare()
    expect(fixture.observation).toBe('absent')
  })

  test('square landing artwork does not suggest authenticator enrollment', async () => {
    document.body.innerHTML = `<main><h1>Skykoi</h1><p>Discover your next adventure</p><img alt="Featured artwork"/><button>Sign in</button></main>`
    const image = document.querySelector('img')
    switch (image instanceof HTMLImageElement) {
      case true:
        Object.defineProperty(image, 'getBoundingClientRect', {
          value: () => ({
            width: 220,
            height: 220,
            top: 0,
            left: 0,
            bottom: 220,
            right: 220,
          }),
        })
        break
      case false:
        throw new Error('Expected landing artwork')
    }
    await pageQrCapture.prepareAuthenticationAuthenticatorSetupObservation()
    expect(pageQrCapture.authenticationAuthenticatorSetupObservation()).toBe(
      'absent',
    )
    expect(document.querySelector('button')?.textContent).toBe('Sign in')
  })

  test('rejects stale setup metadata until a fresh runtime projection is prepared', async () => {
    const fixture = new PageQrObservationFixture(
      '<section><p>Scan this QR code with your authenticator app</p><img/></section>',
    )
    await fixture.prepare()
    expect(fixture.observation).toBe('present')
    document.body.replaceChildren()
    expect(() => fixture.observation).toThrow('stale')
    await fixture.prepare()
    expect(fixture.observation).toBe('absent')
  })

  test('runtime rejection clears the previous prepared projection', async () => {
    const fixture = new PageQrObservationFixture(
      '<section><p>Scan this QR code with your authenticator app</p><img/></section>',
    )
    await fixture.prepare()
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage(
          _message: CompanionWasmRuntimeMessage,
          callback: (response: SetupMetadataRuntimeResponse) => void,
        ) {
          callback({ ok: false })
        },
      },
    })
    await expect(fixture.prepare()).rejects.toThrow('unavailable')
    expect(() => fixture.observation).toThrow('not prepared')
  })

  test('requires the typed setup observation field in a delivered runtime envelope', async () => {
    const fixture = new PageQrObservationFixture('<section><img/></section>')
    for (const result of rejectedSetupMetadataResults) {
      vi.stubGlobal('chrome', {
        runtime: {
          sendMessage(
            _message: CompanionWasmRuntimeMessage,
            callback: (response: SetupMetadataRuntimeResponse) => void,
          ) {
            callback({ ok: true, result })
          },
        },
      })
      await expect(fixture.prepare()).rejects.toThrow('response rejected')
      expect(() => fixture.observation).toThrow('not prepared')
    }
  })

  test('prefers visible data-nook-otpauth-uri without BarcodeDetector', async () => {
    const uri =
      'otpauth://totp/Nook:alice-2fa@nook.test?secret=JBSWY3DPEHPK3PXP&issuer=Nook'
    document.body.innerHTML = `
      <img
        data-nook-otpauth-uri="${uri}"
        width="220"
        height="220"
        alt="Authenticator QR code"
        style="width: 220px; height: 220px"
      />
    `
    const image = document.querySelector('img')
    if (image) {
      Object.defineProperty(image, 'getBoundingClientRect', {
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

    await expect(
      pageQrCapture.decodeVisibleOtpauthCandidates(),
    ).resolves.toEqual({
      status: 'ready',
      candidates: [{ sourceLabel: 'QR 1', otpauthUri: uri }],
    })
  })

  test('reports unsupported when no marked URI and BarcodeDetector is missing', async () => {
    document.body.innerHTML = `
      <img
        width="220"
        height="220"
        alt="Authenticator QR code"
        style="width: 220px; height: 220px"
      />
    `
    const image = document.querySelector('img')
    if (image) {
      Object.defineProperty(image, 'getBoundingClientRect', {
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

    await expect(
      pageQrCapture.decodeVisibleOtpauthCandidates(),
    ).resolves.toEqual({
      status: 'unsupported',
      candidates: [],
    })
  })
})

describe('authenticator setup dialogs', () => {
  test('an inline SVG QR in a portaled setup dialog offers enrollment from its title and body', async () => {
    const fixture = new DialogQrObservationFixture(
      DialogQrObservationFixture.authenticatorDialog(
        DialogQrObservationFixture.QR_SVG,
      ),
    )
    expect(await fixture.observation()).toBe('present')
    expect(fixture.instructionCopies).toHaveLength(1)
    const [copy] = fixture.instructionCopies
    expect(copy).toMatch(
      /^\nUpdate authenticator app\nScan this QR code to set up your account using your preferred authenticator app\. Popular choices include Google Authenticator, Microsoft Authenticator, and Authy\./,
    )
    expect(copy).not.toMatch(/Cancel|Continue|Account settings|Manage/)
    expect(new TextEncoder().encode(copy).length).toBeLessThanOrEqual(512)
  })

  test('a canvas QR inside a dialog form still reads the dialog header and span copy', async () => {
    const fixture = new DialogQrObservationFixture(`
      <div role="dialog" aria-modal="true" aria-labelledby="setup-title">
        <header><h2 id="setup-title">Set up two-factor authentication</h2></header>
        <form>
          <span>Scan this QR code with your authenticator app.</span>
          <canvas width="220" height="220"></canvas>
          <button type="submit">Continue</button>
        </form>
      </div>
    `)
    expect(await fixture.observation()).toBe('present')
    expect(fixture.instructionCopies).toEqual([
      '\nSet up two-factor authentication\nScan this QR code with your authenticator app.',
    ])
  })

  test('dialog copy keeps setup keys, controls, and hidden text out of the observation', async () => {
    const fixture = new DialogQrObservationFixture(`
      <div role="dialog" aria-labelledby="key-title">
        <h2 id="key-title">Update authenticator app</h2>
        <div>Scan this QR code with your authenticator app.</div>
        ${DialogQrObservationFixture.QR_SVG}
        <div>Setup key: <code>JBSWY3DPEHPK3PXP</code></div>
        <span data-setup-key>KRSXG5CTMVRXEZLU</span>
        <span hidden>Hidden helper copy</span>
      </div>
    `)
    expect(await fixture.observation()).toBe('present')
    expect(fixture.instructionCopies).toEqual([
      '\nUpdate authenticator app\nScan this QR code with your authenticator app.',
    ])
  })

  test('plain-text setup keys shown after the dialog QR stay out of the instruction copy', async () => {
    const setupKey = 'JBSW Y3DP EHPK 3PXP KRSX G5CT MVRX EZLU'
    const fixture = new DialogQrObservationFixture(
      DialogQrObservationFixture.authenticatorDialog(`
        ${DialogQrObservationFixture.QR_SVG}
        <div>Can't scan it? Enter this key instead:</div>
        <div>${setupKey}</div>
        <div>Key: <strong>${setupKey}</strong></div>
        <span>${setupKey}</span>
      `),
    )
    expect(await fixture.observation()).toBe('present')
    const payload = fixture.payloads.at(-1)
    expect(payload?.qrMedia).toBe('present')
    expect(fixture.instructionCopies).toHaveLength(1)
    const [copy] = fixture.instructionCopies
    expect(copy).toMatch(
      /^\nUpdate authenticator app\nScan this QR code to set up your account using your preferred authenticator app\./,
    )
    expect(copy).not.toContain('JBSW')
    expect(copy).not.toContain('KRSX')
    expect(copy).not.toContain("Can't scan it")
  })

  test('small icons skip computed style during setup media collection', async () => {
    const fixture = new DialogQrObservationFixture(
      DialogQrObservationFixture.authenticatorDialog(
        '<svg id="copy-icon" viewBox="0 0 24 24"><path d="M4 4h16v16H4z"/></svg>',
      ),
    )
    const icon = document.querySelector('#copy-icon')
    if (!icon) throw new Error('Expected icon fixture')
    Object.defineProperty(icon, 'getBoundingClientRect', {
      value: () => ({
        width: 24,
        height: 24,
        top: 0,
        left: 0,
        bottom: 24,
        right: 24,
      }),
    })
    const computedStyle = vi.spyOn(window, 'getComputedStyle')
    expect(await fixture.observation()).toBe('absent')
    expect(
      computedStyle.mock.calls.filter(([element]) => element === icon),
    ).toEqual([])
    computedStyle.mockRestore()
  })

  test('a marked inline SVG QR decodes without BarcodeDetector', async () => {
    const uri =
      'otpauth://totp/Example:carol@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Example'
    new DialogQrObservationFixture(
      DialogQrObservationFixture.authenticatorDialog(
        `<svg viewBox="0 0 29 29" data-nook-otpauth-uri="${uri}"><path d="M0 0h7v7H0z"/></svg>`,
      ),
    )
    await expect(
      pageQrCapture.decodeVisibleOtpauthCandidates(),
    ).resolves.toEqual({
      status: 'ready',
      candidates: [{ sourceLabel: 'QR 1', otpauthUri: uri }],
    })
  })

  test('sign-in, app-download, and payment QR dialogs do not suggest enrollment', async () => {
    for (const [title, body] of [
      [
        'Sign in with your phone',
        'Scan this QR code with the Nook Authenticator app to sign in.',
      ],
      ['Get the app', 'Scan this QR code to download our authenticator app.'],
      ['Checkout', 'Scan this QR code with your authenticator app to pay.'],
    ]) {
      const fixture = new DialogQrObservationFixture(`
        <div role="dialog" aria-modal="true" aria-labelledby="t" aria-describedby="d">
          <div id="t">${title}</div>
          <div id="d">${body}</div>
          ${DialogQrObservationFixture.QR_SVG}
        </div>
      `)
      expect(await fixture.observation()).toBe('absent')
    }
  })

  test('decorative and small icon SVGs inside a setup dialog are not QR candidates', async () => {
    const fixture = new DialogQrObservationFixture(
      DialogQrObservationFixture.authenticatorDialog(
        '<svg id="copy-icon" viewBox="0 0 24 24"><path d="M4 4h16v16H4z"/></svg>',
      ),
    )
    const icon = document.querySelector('#copy-icon')
    if (!icon) throw new Error('Expected icon fixture')
    Object.defineProperty(icon, 'getBoundingClientRect', {
      value: () => ({
        width: 24,
        height: 24,
        top: 0,
        left: 0,
        bottom: 24,
        right: 24,
      }),
    })
    expect(await fixture.observation()).toBe('absent')
    expect(fixture.instructionCopies).toEqual([])
  })

  test('copy changes inside the dialog request a setup rescan; unrelated page text does not', () => {
    new DialogQrObservationFixture(
      DialogQrObservationFixture.authenticatorDialog(
        DialogQrObservationFixture.QR_SVG,
      ),
    )
    const observer = new MutationObserver(() => {})
    const observerOptions: MutationObserverInit = {
      childList: true,
      characterData: true,
      subtree: true,
    }
    observer.observe(document.body, observerOptions)
    const title = document.querySelector('#mfa-title')
    const description = document.querySelector('#mfa-description')
    const unrelated = document.querySelector('main p')
    if (!title || !description || !unrelated)
      throw new Error('Expected dialog mutation fixture')
    title.textContent = 'Set up authenticator app'
    const descriptionText = description.firstChild
    if (!(descriptionText instanceof Text))
      throw new Error('Expected description text')
    descriptionText.data = 'Scan this QR code with your authenticator app. '
    const dialogRecords = observer.takeRecords()
    expect(dialogRecords.length).toBeGreaterThan(0)
    for (const record of dialogRecords) {
      expect(
        pageQrCapture.authenticationAuthenticatorSetupMutationRequiresScan(
          record,
        ),
      ).toBe(true)
    }
    unrelated.textContent = 'Recent sign-in activity'
    const unrelatedRecords = observer.takeRecords()
    expect(unrelatedRecords.length).toBeGreaterThan(0)
    for (const record of unrelatedRecords) {
      expect(
        pageQrCapture.authenticationAuthenticatorSetupMutationRequiresScan(
          record,
        ),
      ).toBe(false)
    }
    observer.disconnect()
  })

  test('the trusted decode rasterizes an inline SVG QR onto an opaque canvas for BarcodeDetector', async () => {
    const uri =
      'otpauth://totp/Example:alice@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Example'
    new DialogQrObservationFixture(
      DialogQrObservationFixture.authenticatorDialog(
        DialogQrObservationFixture.QR_SVG,
      ),
    )
    const raster = new QrRasterDecodeFixture(uri)
    raster.install()
    try {
      await expect(
        pageQrCapture.decodeVisibleOtpauthCandidates(),
      ).resolves.toEqual({
        status: 'ready',
        candidates: [{ sourceLabel: 'QR 1', otpauthUri: uri }],
      })
      expect(raster.decodedSources).toHaveLength(1)
      const [decodedSource] = raster.decodedSources
      if (!decodedSource) throw new Error('Expected a decoded SVG image')
      const prefix = 'data:image/svg+xml;charset=utf-8,'
      expect(decodedSource.startsWith(prefix)).toBe(true)
      const markup = decodeURIComponent(decodedSource.slice(prefix.length))
      expect(markup).toMatch(/^<svg/)
      expect(markup).toContain('width="220"')
      expect(markup).toContain('height="220"')
      expect(markup).toContain('M0 0h7v7H0z')
      expect(raster.operations).toEqual([
        { operation: 'fillRect', fillStyle: '#ffffff', source: '' },
        { operation: 'drawImage', fillStyle: '#ffffff', source: decodedSource },
      ])
      expect(raster.bitmapSources).toEqual(['canvas'])
      expect(raster.detectedSources).toEqual(['opaque-canvas'])
      expect(raster.closedBitmaps).toEqual(['opaque-canvas'])
    } finally {
      raster.restore()
    }
  })

  test('the trusted decode underlays canvas QR media before BarcodeDetector', async () => {
    const uri = 'otpauth://totp/Example:bob@example.com?secret=JBSWY3DPEHPK3PXP'
    new DialogQrObservationFixture(
      DialogQrObservationFixture.authenticatorDialog(
        '<canvas width="220" height="220"></canvas>',
      ),
    )
    const raster = new QrRasterDecodeFixture(uri)
    raster.install()
    try {
      await expect(
        pageQrCapture.decodeVisibleOtpauthCandidates(),
      ).resolves.toEqual({
        status: 'ready',
        candidates: [{ sourceLabel: 'QR 1', otpauthUri: uri }],
      })
      expect(raster.decodedSources).toEqual([])
      expect(raster.operations.map((step) => step.operation)).toEqual([
        'fillRect',
        'drawImage',
      ])
      expect(raster.detectedSources).toEqual(['opaque-canvas'])
    } finally {
      raster.restore()
    }
  })
})
