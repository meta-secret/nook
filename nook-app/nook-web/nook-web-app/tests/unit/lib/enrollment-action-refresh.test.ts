import { expect, test, vi } from 'vitest'
import {
  assignStagedEnrollmentCeremony,
  beginActiveEnrollmentCeremony,
  beginEnrollmentCeremony,
  cancelActiveEnrollmentCeremony,
  completeEnrollmentCeremony,
  enrollmentEvidenceCallbacks,
  enrollmentCeremonyActive,
} from '../../../../nook-web-extension/src/content/enrollment-flow'
import { BROWSER_MESSAGE_KEYS } from '../../../../nook-web-extension/src/lib/browser-message-keys'

type Host = Parameters<typeof beginActiveEnrollmentCeremony>[0]['host']
type Dismiss = { payload: { stageId: string } }
// prettier-ignore
const hostView = (extra = {}, panel = document.createElement('section')) =>
  ({ description: document.createElement('p'), isBusy: () => false, panel, requestWorkflowReclassification: vi.fn(), setBusy: vi.fn(), title: document.createElement('h2'), translatedMessage: (key: string) => key, ...extra }) as unknown as Host
// prettier-ignore
const sensitive = (value: string) => ({ uri: { value }, payload: { otpauthUri: value }, candidate: { sourceLabel: 'QR', otpauthUri: value } })
const stage = (host: Host, section: HTMLElement, stageId: string) => {
  // prettier-ignore
  const authorizationGeneration = beginActiveEnrollmentCeremony({ host, section, stageId, sensitiveMaterial: sensitive(`otpauth://${stageId}`) })
  assignStagedEnrollmentCeremony({
    authorizationGeneration,
    host,
    section,
    stageId,
  })
  return authorizationGeneration
}

test('failed pending cancellation keeps identity and renders Cancel-only retry', async () => {
  const section = document.createElement('section')
  const stageIds: string[] = []
  // prettier-ignore
  const host = hostView({ sendAuthenticatorEnrollmentDismissRuntimeMessage: async (message: Dismiss) => stageIds.push(message.payload.stageId) === 1 ? 'committing' : 'revoked', translatedMessage: (key: string) => key === BROWSER_MESSAGE_KEYS.WidgetEnrollFailed ? 'Authenticator setup failed.' : 'Cancel' })
  beginActiveEnrollmentCeremony({
    host,
    section,
    stageId: 'retained-stage',
    sensitiveMaterial: sensitive('otpauth://pending-secret'),
  })
  expect(await cancelActiveEnrollmentCeremony()).toBe(false)
  expect(host.description.textContent).toBe('Authenticator setup failed.')
  expect(section.querySelector('button')?.textContent).toBe('Cancel')
  expect(await cancelActiveEnrollmentCeremony()).toBe(true)
  expect(stageIds).toEqual(['retained-stage', 'retained-stage'])
})

test('mismatched stage retains the requested identity and Cancel UI', async () => {
  const section = document.createElement('section')
  const dismissedStageIds: string[] = []
  let requestedStageId = ''
  // prettier-ignore
  const host = hostView({ sendAuthenticatorEnrollmentDismissRuntimeMessage: async (message: Dismiss) => dismissedStageIds.push(message.payload.stageId) === 1 ? 'committing' : 'revoked', sendAuthenticatorEnrollmentStageRuntimeMessage: async (message: Dismiss) => { requestedStageId = message.payload.stageId; return { kind: 'delivered', response: { kind: 0, stageId: 'foreign-stage' } } } }) as Parameters<typeof beginEnrollmentCeremony>[0]['host']
  await beginEnrollmentCeremony({
    host,
    section,
    vaultStoreId: 'vault',
    otpauthUri: { value: 'otpauth://mismatch' },
    candidate: { sourceLabel: 'QR', otpauthUri: 'otpauth://mismatch' },
  })
  expect(host.description.textContent).toBe(
    BROWSER_MESSAGE_KEYS.WidgetEnrollFailed,
  )
  expect(section.querySelectorAll('button')).toHaveLength(1)
  expect(await cancelActiveEnrollmentCeremony()).toBe(true)
  expect(dismissedStageIds).toEqual([requestedStageId, requestedStageId])
  expect(requestedStageId).not.toBe('foreign-stage')
})

test('expiry keeps translated failure and local retry actions', () => {
  document.body.innerHTML = '<img data-nook-otpauth-uri="otpauth://retry" />'
  vi.spyOn(
    document.querySelector('img')!,
    'getBoundingClientRect',
  ).mockReturnValue(DOMRect.fromRect({ width: 100, height: 100 }))
  const section = document.createElement('section')
  const host = hostView({}, document.body)
  const authorizationGeneration = stage(host, section, 'expired')
  enrollmentEvidenceCallbacks({
    host,
    section,
    stageId: 'expired',
    vaultStoreId: 'vault',
    authorizationGeneration,
  }).expired()
  expect(host.description.textContent).toBe(
    BROWSER_MESSAGE_KEYS.WidgetEnrollFailed,
  )
  expect(host.panel.querySelector('button')).not.toBeNull()
})

test('stale cancellation cannot overwrite authoritative completion', async () => {
  const dismissal = Promise.withResolvers<'committing'>()
  const section = document.createElement('section')
  const host = hostView({
    sendAuthenticatorEnrollmentDismissRuntimeMessage: () => dismissal.promise,
  })
  const generation = stage(host, section, 'confirmed')
  const cancellation = cancelActiveEnrollmentCeremony()
  completeEnrollmentCeremony(generation)
  host.description.textContent = 'Saved'
  dismissal.resolve('committing')
  expect(await cancellation).toBe(false)
  expect(host.description.textContent).toBe('Saved')
  expect(enrollmentCeremonyActive()).toBe(false)
})
