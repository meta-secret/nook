import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  DecodeVisibleOtpauthCandidatesResultStatus,
  pageQrCapture,
} from '../../../../nook-web-extension/src/lib/page-qr-capture'
import { classify_authentication_authenticator_setup_batch } from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm'
import type {
  CompanionWasmRuntimeMessage,
  CompanionWasmAuthenticatorSetupResponse,
} from '../../../../nook-web-shared/src/extension/companion-wasm-runtime-messages'
import { CompanionWasmSessionMessageType } from '../../../../nook-web-shared/src/extension/companion-wasm-runtime-messages'
import { QrMediaRaster } from '../../../../nook-web-extension/src/lib/qr-media-raster'
import {
  DialogQrObservationFixture,
  QrRasterDecodeFixture,
  RasterOperationKind,
  type ResolveCandidatesRuntimeResponse,
} from './page-qr-capture-fixtures'

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
      '<section><input value="Scan this QR code with your authenticator app"/><img/></section>',
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

  test('rasterized QR media is bounded to a 512 px edge, keeping its aspect ratio', () => {
    const raster = new QrMediaRaster(globalThis)
    expect(raster.boundedSize({ width: 1024, height: 512 })).toEqual({
      width: 512,
      height: 256,
    })
    expect(raster.boundedSize({ width: 300, height: 2000 })).toEqual({
      width: 77,
      height: 512,
    })
    expect(raster.boundedSize({ width: 220, height: 220 })).toEqual({
      width: 220,
      height: 220,
    })
    expect(raster.boundedSize({ width: 0, height: 0 })).toEqual({
      width: 1,
      height: 1,
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
    // Without QR media the dialog reports only its labelled title; its
    // scan-this-QR description stays out of the manual-key copy.
    expect(fixture.payloads.at(-1)?.qrMedia).toBe('absent')
    expect(fixture.instructionCopies).toEqual(['\nUpdate authenticator app'])
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

  test('the trusted decode sends an inline SVG QR as opaque bounded pixels and keeps only Rust candidates', async () => {
    const uri =
      'otpauth://totp/Example:alice@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Example'
    const fixture = new DialogQrObservationFixture(
      DialogQrObservationFixture.authenticatorDialog(
        DialogQrObservationFixture.QR_SVG,
      ),
    )
    fixture.resolution = {
      ok: true,
      result: { candidates: [{ source: 'qr', otpauthUri: uri }] },
    }
    const raster = new QrRasterDecodeFixture()
    raster.install()
    try {
      await expect(
        pageQrCapture.resolveVisibleOtpauthCandidates(),
      ).resolves.toEqual({
        status: DecodeVisibleOtpauthCandidatesResultStatus.Ready,
        candidates: [{ source: 'qr', ordinal: 1, otpauthUri: uri }],
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
        {
          operation: RasterOperationKind.FillRect,
          fillStyle: '#ffffff',
          source: '',
        },
        {
          operation: RasterOperationKind.DrawImage,
          fillStyle: '#ffffff',
          source: decodedSource,
        },
      ])
      expect(raster.copiedSizes).toEqual(['220x220 image/png'])
      const [request] = fixture.resolveRequests
      expect(request?.origin).toBe(location.origin)
      expect(request?.payload.pictureDataUrls).toEqual([
        QrRasterDecodeFixture.PNG_DATA_URL,
      ])
    } finally {
      raster.restore()
    }
  })

  test('the trusted decode underlays canvas QR media before the pixel copy', async () => {
    const fixture = new DialogQrObservationFixture(
      DialogQrObservationFixture.authenticatorDialog(
        '<canvas width="220" height="220"></canvas>',
      ),
    )
    const raster = new QrRasterDecodeFixture()
    raster.install()
    try {
      await expect(
        pageQrCapture.resolveVisibleOtpauthCandidates(),
      ).resolves.toEqual({
        status: DecodeVisibleOtpauthCandidatesResultStatus.Empty,
        candidates: [],
      })
      expect(raster.decodedSources).toEqual([])
      expect(raster.operations.map((step) => step.operation)).toEqual([
        RasterOperationKind.FillRect,
        RasterOperationKind.DrawImage,
      ])
      expect(fixture.resolveRequests).toHaveLength(1)
    } finally {
      raster.restore()
    }
  })

  test('labels several Rust candidates by source and ordinal, and fails closed without a decoder reply', async () => {
    const fixture = new DialogQrObservationFixture(
      DialogQrObservationFixture.authenticatorDialog(''),
    )
    const first = 'otpauth://totp/A:a?secret=JBSWY3DPEHPK3PXP&issuer=A'
    const second = 'otpauth://totp/B:b?secret=KRSXG5CTMVRXEZLU&issuer=B'
    const key = 'otpauth://totp/:?secret=MFRGGZDFMZTWQ2LK&issuer=example.test'
    fixture.resolution = {
      ok: true,
      result: {
        candidates: [
          { source: 'qr', otpauthUri: first },
          { source: 'setup-key', otpauthUri: key },
          { source: 'qr', otpauthUri: second },
        ],
      },
    }
    await expect(
      pageQrCapture.resolveVisibleOtpauthCandidates(),
    ).resolves.toEqual({
      status: DecodeVisibleOtpauthCandidatesResultStatus.Ambiguous,
      candidates: [
        { source: 'qr', ordinal: 1, otpauthUri: first },
        { source: 'setup-key', ordinal: 1, otpauthUri: key },
        { source: 'qr', ordinal: 2, otpauthUri: second },
      ],
    })

    const unusableReplies: ResolveCandidatesRuntimeResponse[] = [
      { ok: false },
      { ok: true, result: { unexpected: 'reply' } },
    ]
    for (const resolution of unusableReplies) {
      fixture.resolution = resolution
      await expect(
        pageQrCapture.resolveVisibleOtpauthCandidates(),
      ).resolves.toEqual({
        status: DecodeVisibleOtpauthCandidatesResultStatus.Failed,
        candidates: [],
      })
    }
  })

  test('a setup key shown with the dialog QR is read only by the trusted decode, never by eligibility', async () => {
    const setupKey = 'JBSW Y3DP EHPK 3PXP'
    const fixture = new DialogQrObservationFixture(
      DialogQrObservationFixture.authenticatorDialog(`
        ${DialogQrObservationFixture.QR_SVG}
        <div>Can't scan it? Enter this key instead:</div>
        <code>${setupKey}</code>
        <input readonly value="KRSX G5CT MVRX EZLU" />
      `),
    )
    expect(await fixture.observation()).toBe('present')
    expect(JSON.stringify(fixture.payloads)).not.toContain('JBSW')
    expect(JSON.stringify(fixture.payloads)).not.toContain('KRSX')
    expect(fixture.resolveRequests).toEqual([])

    const raster = new QrRasterDecodeFixture()
    raster.install()
    try {
      await pageQrCapture.resolveVisibleOtpauthCandidates()
    } finally {
      raster.restore()
    }

    const texts = fixture.resolvedSetupKeyTexts
    expect(texts).toContain(setupKey)
    expect(texts).toContain('KRSX G5CT MVRX EZLU')
    expect(texts).toContain("Can't scan it? Enter this key instead:")
    expect(texts).not.toContain('Cancel')
    expect(texts).not.toContain('Enter code manually')
    // The QR's siblings come before the dialog title nested one level deeper.
    expect(texts.indexOf(setupKey)).toBeLessThan(
      texts.indexOf('Update authenticator app'),
    )
    expect(texts.length).toBeLessThanOrEqual(64)
    for (const text of texts) {
      expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(256)
    }
    // The page drops its copy of the texts once the request is sent.
    expect(
      fixture.resolveMessages.flatMap(
        (message) => message.payload.setupKeyTexts,
      ),
    ).toEqual(texts.map(() => ''))
  })

  test('cancelling clears the URI a resolved candidate carried', async () => {
    const fixture = new DialogQrObservationFixture(
      DialogQrObservationFixture.authenticatorDialog(''),
    )
    const uri = 'otpauth://totp/:?secret=JBSWY3DPEHPK3PXP&issuer=example.test'
    fixture.resolution = {
      ok: true,
      result: { candidates: [{ source: 'setup-key', otpauthUri: uri }] },
    }
    const { candidates } = await pageQrCapture.resolveVisibleOtpauthCandidates()
    for (const candidate of candidates) {
      pageQrCapture.clearOtpauthCandidate(candidate)
    }
    expect(candidates).toEqual([
      { source: 'setup-key', ordinal: 1, otpauthUri: '' },
    ])
  })
})
