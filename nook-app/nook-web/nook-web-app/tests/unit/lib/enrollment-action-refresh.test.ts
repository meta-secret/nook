import { expect, test, vi } from 'vitest'
import {
  beginActiveEnrollmentCeremony,
  cancelActiveEnrollmentCeremony,
} from '../../../../nook-web-extension/src/content/enrollment-flow'
import { BROWSER_MESSAGE_KEYS } from '../../../../nook-web-extension/src/lib/browser-message-keys'

test('failed pending cancellation keeps identity and renders Cancel-only retry', async () => {
  const section = document.createElement('section')
  const description = document.createElement('p')
  const stageIds: string[] = []
  let attempt = 0
  const host = {
    description,
    isBusy: () => false,
    panel: document.createElement('section'),
    requestWorkflowReclassification: vi.fn(),
    sendAuthenticatorEnrollmentDismissRuntimeMessage: async (message: {
      payload: { stageId: string }
    }) => {
      stageIds.push(message.payload.stageId)
      attempt += 1
      return attempt === 1 ? 'committing' : 'revoked'
    },
    setBusy: vi.fn(),
    translatedMessage: (key: string) =>
      key === BROWSER_MESSAGE_KEYS.WidgetEnrollFailed
        ? 'Authenticator setup failed.'
        : 'Cancel',
  } as unknown as Parameters<typeof beginActiveEnrollmentCeremony>[0]['host']
  const uri = { value: 'otpauth://pending-secret' }
  beginActiveEnrollmentCeremony({
    host,
    section,
    stageId: 'retained-stage',
    sensitiveMaterial: {
      uri,
      payload: { otpauthUri: uri.value },
      candidate: { sourceLabel: 'QR', otpauthUri: uri.value },
    },
  })
  expect(await cancelActiveEnrollmentCeremony()).toBe(false)
  expect(description.textContent).toBe('Authenticator setup failed.')
  expect(section.querySelectorAll('button')).toHaveLength(1)
  expect(section.querySelector('button')?.textContent).toBe('Cancel')
  expect(await cancelActiveEnrollmentCeremony()).toBe(true)
  expect(stageIds).toEqual(['retained-stage', 'retained-stage'])
})
