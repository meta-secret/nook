import { afterEach, describe, expect, test, vi } from 'vitest'
import { pageQrCapture } from '../../../../nook-web-extension/src/lib/page-qr-capture'
import { DialogQrObservationFixture } from './page-qr-capture-fixtures'

afterEach(() => {
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

/** A manual-key view that replaced the QR, as after "Enter code manually". */
class ManualKeyDialogFixture {
  static readonly SETUP_KEY = 'JBSW Y3DP EHPK 3PXP'

  static markup(body = ''): string {
    return `
      <main aria-hidden="true"><h1>Account settings</h1><p>Manage your security</p></main>
      <div role="dialog" aria-modal="true" aria-labelledby="key-title" aria-describedby="key-description">
        <h2 id="key-title">Update authenticator app</h2>
        <h3>Enter your setup key in your authenticator app</h3>
        <div id="key-description">Your key is ${ManualKeyDialogFixture.SETUP_KEY}</div>
        <p>Key: <strong>${ManualKeyDialogFixture.SETUP_KEY}</strong></p>
        <div>${ManualKeyDialogFixture.SETUP_KEY}</div>
        <span>Time-based</span>
        ${body}
        <div><button type="button">Cancel</button><button type="button">Continue</button></div>
      </div>
    `
  }
}

describe('manual setup-key views without a QR', () => {
  test('a heading-instructed dialog stays eligible while its key never enters pre-consent copy', async () => {
    const fixture = new DialogQrObservationFixture(
      ManualKeyDialogFixture.markup(),
    )
    // The integrated classifier treats setup-key instructions as Present
    // without media; scan-QR instructions still need a visible QR.
    expect(await fixture.observation()).toBe('present')
    expect(fixture.payloads.at(-1)?.qrMedia).toBe('absent')
    expect(fixture.instructionCopies).toEqual([
      '\nUpdate authenticator app\nEnter your setup key in your authenticator app',
    ])
    const sent = JSON.stringify(fixture.payloads)
    expect(sent).not.toContain('JBSW')
    expect(sent).not.toContain('Your key is')
    expect(sent).not.toContain('Time-based')
    expect(fixture.resolveRequests).toEqual([])
  })

  test('headings holding emphasized or code-like markup are skipped', async () => {
    for (const markup of ['strong', 'b', 'code', 'kbd', 'samp', 'mark']) {
      const fixture = new DialogQrObservationFixture(`
        <div role="dialog" aria-modal="true" aria-labelledby="t">
          <h2 id="t">Enter your setup key: <${markup}>${ManualKeyDialogFixture.SETUP_KEY}</${markup}></h2>
          <h3>Use your authenticator app</h3>
        </div>
      `)
      await fixture.observation()
      expect(JSON.stringify(fixture.payloads), markup).not.toContain('JBSW')
      expect(fixture.instructionCopies, markup).toEqual([
        '\nUse your authenticator app',
      ])
    }
  })

  test('sections, forms, and articles without a QR are not read for setup copy', async () => {
    for (const scope of ['section', 'form', 'article']) {
      const fixture = new DialogQrObservationFixture(
        `<${scope}><h2>Enter your setup key in your authenticator app</h2><div>${ManualKeyDialogFixture.SETUP_KEY}</div></${scope}>`,
      )
      expect(await fixture.observation(), scope).toBe('absent')
      expect(fixture.payloads.at(-1), scope).toEqual({
        visibleInstructionCopies: [],
        qrMedia: 'absent',
      })
    }
  })

  test('the trusted decode reads the nearest dialog, nearest the instructions first, and sends no pictures', async () => {
    // Earlier prose deep in the dialog must not crowd the key out of the bound.
    const filler = `<div><div><div>${Array.from(
      { length: 80 },
      (_, index) => `<p>Step ${index} of the setup guide.</p>`,
    ).join('')}</div></div></div>`
    const fixture = new DialogQrObservationFixture(
      ManualKeyDialogFixture.markup(filler),
    )
    await fixture.observation()

    await pageQrCapture.resolveVisibleOtpauthCandidates()

    const [request] = fixture.resolveRequests
    expect(request?.payload.pictureDataUrls).toEqual([])
    const texts = request?.payload.setupKeyTexts
    expect(texts).toContain(ManualKeyDialogFixture.SETUP_KEY)
    expect(texts?.length).toBe(64)
    expect(texts).not.toContain('Account settings')
    expect(texts).not.toContain('Cancel')
  })

  test('copy changes inside a manual-key dialog request a setup rescan; page prose does not', () => {
    new DialogQrObservationFixture(ManualKeyDialogFixture.markup())
    const observer = new MutationObserver(() => {})
    const observerOptions: MutationObserverInit = {
      childList: true,
      characterData: true,
      subtree: true,
    }
    observer.observe(document.body, observerOptions)
    const heading = document.querySelector('#key-title')
    const pageProse = document.querySelector('main p')
    if (!heading || !pageProse) throw new Error('Expected manual-key fixture')
    heading.textContent = 'Set up authenticator app'
    const dialogRecords = observer.takeRecords()
    expect(dialogRecords.length).toBeGreaterThan(0)
    expect(
      dialogRecords.some((record) =>
        pageQrCapture.authenticationAuthenticatorSetupMutationRequiresScan(
          record,
        ),
      ),
    ).toBe(true)
    pageProse.textContent = 'Recent sign-in activity'
    for (const record of observer.takeRecords()) {
      expect(
        pageQrCapture.authenticationAuthenticatorSetupMutationRequiresScan(
          record,
        ),
      ).toBe(false)
    }
    observer.disconnect()
  })
})

describe('extension QR decoding', () => {
  test('no extension source references BarcodeDetector or the otpauth marker', async () => {
    const { readdir, readFile } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const sourceRoot = join(process.cwd(), '../nook-web-extension/src')
    const entries = await readdir(sourceRoot, {
      recursive: true,
      withFileTypes: true,
    })
    const sources = entries.filter(
      (entry) => entry.isFile() && /\.(ts|svelte)$/.test(entry.name),
    )
    expect(sources.length).toBeGreaterThan(0)
    for (const entry of sources) {
      const source = await readFile(join(entry.parentPath, entry.name), 'utf8')
      expect(source, entry.name).not.toContain('BarcodeDetector')
      expect(source, entry.name).not.toContain('data-nook-otpauth-uri')
    }
  })
})
