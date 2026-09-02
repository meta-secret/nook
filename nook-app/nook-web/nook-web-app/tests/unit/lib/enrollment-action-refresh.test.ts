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

const hostView = (panel = document.createElement('section')) => ({
  description: document.createElement('p'),
  isBusy: () => false,
  panel,
  requestWorkflowReclassification: vi.fn(),
  setBusy: vi.fn(),
  title: document.createElement('h2'),
  translatedMessage: (key: string) => key,
})
const sensitive = (value: string) => {
  const uri = { value }
  return {
    uri,
    payload: { otpauthUri: value },
    candidate: { sourceLabel: 'QR', otpauthUri: value },
  }
}
function stageCeremony(
  host: Parameters<typeof beginActiveEnrollmentCeremony>[0]['host'],
  section: HTMLElement,
  stageId: string,
) {
  const authorizationGeneration = beginActiveEnrollmentCeremony({
    host,
    section,
    stageId,
    sensitiveMaterial: sensitive(`otpauth://${stageId}`),
  })
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
  let attempt = 0
  const host = {
    ...hostView(),
    sendAuthenticatorEnrollmentDismissRuntimeMessage: async (message: {
      payload: { stageId: string }
    }) => {
      stageIds.push(message.payload.stageId)
      attempt += 1
      return attempt === 1 ? 'committing' : 'revoked'
    },
    translatedMessage: (key: string) =>
      key === BROWSER_MESSAGE_KEYS.WidgetEnrollFailed
        ? 'Authenticator setup failed.'
        : 'Cancel',
  } as unknown as Parameters<typeof beginActiveEnrollmentCeremony>[0]['host']
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
  let dismissals = 0
  const host = {
    ...hostView(),
    sendAuthenticatorEnrollmentDismissRuntimeMessage: async () =>
      ++dismissals === 1 ? 'committing' : 'revoked',
    sendAuthenticatorEnrollmentStageRuntimeMessage: async () => ({
      kind: 'delivered',
      response: { kind: 0, stageId: 'foreign-stage' },
    }),
  } as unknown as Parameters<typeof beginEnrollmentCeremony>[0]['host']
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
})

test('expiry keeps translated failure and local retry actions', () => {
  document.body.innerHTML = '<img data-nook-otpauth-uri="otpauth://retry" />'
  vi.spyOn(
    document.querySelector('img')!,
    'getBoundingClientRect',
  ).mockReturnValue(DOMRect.fromRect({ width: 100, height: 100 }))
  const section = document.createElement('section')
  const host = hostView(document.body) as unknown as Parameters<
    typeof beginActiveEnrollmentCeremony
  >[0]['host']
  const generation = stageCeremony(host, section, 'expired')
  enrollmentEvidenceCallbacks({
    host,
    section,
    stageId: 'expired',
    vaultStoreId: 'vault',
    authorizationGeneration: generation,
  }).expired()
  expect(host.description.textContent).toBe(
    BROWSER_MESSAGE_KEYS.WidgetEnrollFailed,
  )
  expect(host.panel.querySelector('button')).not.toBeNull()
})

test('stale cancellation cannot overwrite authoritative completion', async () => {
  const dismissal = Promise.withResolvers<'committing'>()
  const section = document.createElement('section')
  const host = {
    ...hostView(),
    sendAuthenticatorEnrollmentDismissRuntimeMessage: () => dismissal.promise,
  } as unknown as Parameters<typeof beginActiveEnrollmentCeremony>[0]['host']
  const generation = stageCeremony(host, section, 'confirmed')
  const cancellation = cancelActiveEnrollmentCeremony()
  completeEnrollmentCeremony(generation)
  host.description.textContent = 'Saved'
  dismissal.resolve('committing')
  expect(await cancellation).toBe(false)
  expect(host.description.textContent).toBe('Saved')
  expect(enrollmentCeremonyActive()).toBe(false)
})
