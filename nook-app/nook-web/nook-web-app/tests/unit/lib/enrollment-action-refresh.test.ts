import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  renderEnrollmentRetryActions,
  requestFreshEnrollmentActions,
} from '../../../../nook-web-extension/src/content/enrollment-flow'
import { BROWSER_MESSAGE_KEYS } from '../../../../nook-web-extension/src/lib/browser-message-keys'

describe('enrollment action refresh', () => {
  afterEach(() => {
    document.body.replaceChildren()
  })

  test('clears stale actions before requesting a remounted classification', () => {
    const panel = document.createElement('section')
    const enrollmentActions = document.createElement('div')
    enrollmentActions.className = 'enrollment-actions'
    enrollmentActions.append(document.createElement('button'))
    panel.append(enrollmentActions)
    const requestWorkflowReclassification = vi.fn()
    const host = {
      panel,
      requestWorkflowReclassification,
    } as unknown as Parameters<typeof requestFreshEnrollmentActions>[0]

    requestFreshEnrollmentActions(host)

    expect(panel.childElementCount).toBe(0)
    expect(requestWorkflowReclassification).toHaveBeenCalledOnce()
  })

  test('keeps a translated failure visible while rendering retry actions', () => {
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
    const host = {
      panel,
      title,
      description,
      isBusy: () => false,
      setBusy: vi.fn(),
      translatedMessage: (key: string) =>
        key === BROWSER_MESSAGE_KEYS.WidgetAddFromPage
          ? 'Add 2FA from this page'
          : key,
    } as unknown as Parameters<typeof renderEnrollmentRetryActions>[0]

    renderEnrollmentRetryActions(host)

    expect(description.textContent).toBe('Authenticator setup failed.')
    expect(panel.querySelector('button')?.getAttribute('aria-label')).toBe(
      'Add 2FA from this page',
    )
  })
})
