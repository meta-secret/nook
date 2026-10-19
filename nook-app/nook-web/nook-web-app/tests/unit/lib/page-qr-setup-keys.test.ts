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

  static markup(): string {
    return `
      <main aria-hidden="true"><h1>Account settings</h1><p>Manage your security</p></main>
      <div role="dialog" aria-modal="true" aria-labelledby="key-title">
        <h2 id="key-title">Update authenticator app</h2>
        <p>Enter this setup key in your authenticator app.</p>
        <div>${ManualKeyDialogFixture.SETUP_KEY}</div>
        <span>Time-based</span>
        <div><button type="button">Cancel</button><button type="button">Continue</button></div>
      </div>
    `
  }
}

describe('manual setup-key views without a QR', () => {
  test('pre-consent copy reads only headings and paragraphs, so the key never enters it', async () => {
    const fixture = new DialogQrObservationFixture(
      ManualKeyDialogFixture.markup(),
    )
    // The integrated classifier treats setup-key instructions as Present
    // without media; scan-QR instructions still need a visible QR.
    expect(await fixture.observation()).toBe('present')
    const payload = fixture.payloads.at(-1)
    expect(payload?.qrMedia).toBe('absent')
    expect(fixture.instructionCopies).toEqual([
      '\nUpdate authenticator app\nEnter this setup key in your authenticator app.',
    ])
    expect(JSON.stringify(fixture.payloads)).not.toContain('JBSW')
    expect(JSON.stringify(fixture.payloads)).not.toContain('Time-based')
    expect(fixture.resolveRequests).toEqual([])
  })

  test('the trusted decode extracts the key from the same dialog scope and sends no pictures', async () => {
    const fixture = new DialogQrObservationFixture(
      ManualKeyDialogFixture.markup(),
    )
    await fixture.observation()

    await pageQrCapture.resolveVisibleOtpauthCandidates()

    const [request] = fixture.resolveRequests
    expect(request?.payload.pictures).toEqual([])
    expect(request?.payload.setupKeyTexts).toContain(
      ManualKeyDialogFixture.SETUP_KEY,
    )
    expect(request?.payload.setupKeyTexts).not.toContain('Account settings')
    expect(request?.payload.setupKeyTexts).not.toContain('Cancel')
  })

  test('a page without any setup scope copy sends no instruction copies', async () => {
    const fixture = new DialogQrObservationFixture(
      `<div>${ManualKeyDialogFixture.SETUP_KEY}</div><p>Enter this setup key in your authenticator app.</p>`,
    )
    expect(await fixture.observation()).toBe('absent')
    expect(fixture.payloads.at(-1)).toEqual({
      visibleInstructionCopies: [],
      qrMedia: 'absent',
    })
  })

  test('copy changes inside a manual-key dialog request a setup rescan', () => {
    new DialogQrObservationFixture(ManualKeyDialogFixture.markup())
    const observer = new MutationObserver(() => {})
    const observerOptions: MutationObserverInit = {
      childList: true,
      characterData: true,
      subtree: true,
    }
    observer.observe(document.body, observerOptions)
    const heading = document.querySelector('#key-title')
    if (!heading) throw new Error('Expected manual-key heading')
    heading.textContent = 'Set up authenticator app'
    const records = observer.takeRecords()
    expect(records.length).toBeGreaterThan(0)
    expect(
      records.some((record) =>
        pageQrCapture.authenticationAuthenticatorSetupMutationRequiresScan(
          record,
        ),
      ),
    ).toBe(true)
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
