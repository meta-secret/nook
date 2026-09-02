import { expect, test, vi } from 'vitest'
import { renderEnrollmentRetryActions } from '../../../../nook-web-extension/src/content/enrollment-flow'
import { BROWSER_MESSAGE_KEYS } from '../../../../nook-web-extension/src/lib/browser-message-keys'

test('keeps a translated failure visible while rendering retry actions', () => {
  try {
    const panel = document.createElement('section')
    const title = document.createElement('h2')
    const description = document.createElement('p')
    description.textContent = 'Authenticator setup failed.'
    document.body.innerHTML = `
      <img alt="Authenticator QR code"
        data-nook-otpauth-uri="otpauth://totp/Example?secret=example" />
    `
    const qr = document.querySelector('img')
    if (!qr) throw new Error('Expected the QR fixture.')
    vi.spyOn(qr, 'getBoundingClientRect').mockReturnValue(
      DOMRect.fromRect({ width: 200, height: 200 }),
    )
    renderEnrollmentRetryActions({
      panel,
      title,
      description,
      isBusy: () => false,
      setBusy: vi.fn(),
      translatedMessage: (key: string) =>
        key === BROWSER_MESSAGE_KEYS.WidgetAddFromPage
          ? 'Add 2FA from this page'
          : key,
    } as unknown as Parameters<typeof renderEnrollmentRetryActions>[0])

    expect(description.textContent).toBe('Authenticator setup failed.')
    expect(panel.querySelector('button')?.getAttribute('aria-label')).toBe(
      'Add 2FA from this page',
    )
  } finally {
    document.body.replaceChildren()
  }
})
