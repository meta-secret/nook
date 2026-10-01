import { afterEach, describe, expect, test } from 'vitest'
import { pageQrCapture } from '../../../../nook-web-extension/src/lib/page-qr-capture'

afterEach(() => {
  document.body.replaceChildren()
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
}

describe('page QR otpauth capture', () => {
  test('nearby visible setup instructions admit generic media', () => {
    const fixture = new PageQrObservationFixture(
      '<section><h1>Authenticator setup</h1><p>Scan this QR code with your authenticator app</p><img alt="Code"/></section>',
    )
    expect(fixture.observation).toBe('present')
  })

  test('hidden, remote, and secret-bearing paragraphs do not supply instructions', () => {
    for (const markup of [
      '<section><p hidden>Scan this QR code with your authenticator app</p><img/></section>',
      '<section><p>Scan this QR code with your authenticator app</p></section><section><img/></section>',
      '<section><div role="group"><p>Scan this QR code with your authenticator app</p></div><img/></section>',
      '<section><p>Scan this QR code with your authenticator app <code>JBSWY3DPEHPK3PXP</code></p><img/></section>',
      '<section><p data-nook-backup-codes>Scan this QR code with your authenticator app</p><img/></section>',
      '<section><input value="Scan this QR code with your authenticator app"/><img data-nook-otpauth-uri="otpauth://totp/Example?secret=JBSWY3DPEHPK3PXP"/></section>',
      '<section><p>Scan this QR code to download our app</p><img alt="Authenticator QR code"/></section>',
    ]) {
      expect(new PageQrObservationFixture(markup).observation).toBe('absent')
    }
  })

  test('instruction copy stays within the generated UTF-8 byte bound', () => {
    const fixture = new PageQrObservationFixture(
      `<section><p>${'é'.repeat(300)}</p><img/></section>`,
    )
    expect(fixture.observation).toBe('absent')
  })

  test('omits secret-bearing paragraphs before reading their text', () => {
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
    expect(fixture.observation).toBe('absent')
  })

  test('square landing artwork does not suggest authenticator enrollment', () => {
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
    expect(pageQrCapture.authenticationAuthenticatorSetupObservation()).toBe(
      'absent',
    )
    expect(document.querySelector('button')?.textContent).toBe('Sign in')
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
