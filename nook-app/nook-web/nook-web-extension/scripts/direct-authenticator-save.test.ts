import { afterAll, expect, mock, test } from 'bun:test'
import { BROWSER_MESSAGE_KEYS } from '../src/lib/browser-message-keys'
import type { EnrollmentFlowHost } from '../src/content/enrollment-flow'

mock.module(
  '../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js',
  () => ({
    AuthenticationWorkflowAction: { EnrollAuthenticator: 0 },
    AuthenticatorEnrollmentConfirmResponseKind: {
      Completed: 0,
      Rejected: 1,
    },
    AuthenticatorEnrollmentStageResponseKind: { Staged: 0, Rejected: 1 },
    AuthenticatorPreviewResponseKind: { Ready: 0, Unavailable: 1, Rejected: 2 },
  }),
)
mock.module('../src/lib/backup-code-candidates', () => ({
  authenticationRecoveryEvidence: () => ['', false],
  authenticationRecoveryCopy: () => '',
  clearBackupCodeCandidates: (codes: string[]) => codes.fill(''),
  extractDocumentBackupCodeCandidates: () => [],
  pageHasDocumentBackupCodeHint: () => false,
  recoveryCopyHasBackupCodeHint: () => false,
}))
mock.module('../src/lib/page-qr-capture', () => ({
  clearOtpauthCandidate: (candidate: {
    sourceLabel: string
    otpauthUri: string
  }) => {
    candidate.sourceLabel = ''
    candidate.otpauthUri = ''
  },
  decodeVisibleOtpauthCandidates: async () => ({
    status: 'empty',
    candidates: [],
  }),
  pageHasQrEnrollmentHint: () => false,
}))
mock.module('../src/content/autofill/login-passkey-actions', () => ({
  RuntimeMessageDeliveryKind: {
    Delivered: 'delivered',
    Unavailable: 'unavailable',
  },
}))
mock.module('../src/content/enrollment-backup-flow', () => ({
  startBackupEnrollment: () => {},
}))
mock.module('../src/content/autofill/backup-code-workflow-action', () => ({
  startRevalidatedEnrollmentAction: async () => {},
}))

Object.assign(globalThis, {
  document: { querySelectorAll: () => [] },
  location: { origin: 'https://example.test' },
})

const enrollmentFlow = await import('../src/content/enrollment-flow')
afterAll(() => mock.restore())
const delivered = <Response>(response: Response) => ({
  kind: 'delivered' as const,
  response,
})

function enrollmentHost(confirmKind: number) {
  const order: string[] = []
  const code = mock(async () => {
    throw new Error('code polling must not run')
  })
  const outcome = mock(async () => {
    throw new Error('website outcome polling must not run')
  })
  const host = {
    description: { textContent: '' },
    setBusy: mock(() => {}),
    translatedMessage: (key: string) => key,
    sendAuthenticatorEnrollmentStageRuntimeMessage: mock(async () => {
      order.push('stage')
      return delivered({ kind: 0, stageId: 'stage-1' })
    }),
    sendAuthenticatorEnrollmentConfirmRuntimeMessage: mock(async () => {
      order.push('confirm')
      return confirmKind === 0
        ? delivered({ kind: 0 })
        : delivered({ kind: 1, reason: 'authenticator-enroll-failed' })
    }),
    sendAuthenticatorCodeRuntimeMessage: code,
    sendAuthenticationOutcomeRuntimeMessage: outcome,
  } as unknown as EnrollmentFlowHost
  return { code, host, order, outcome }
}

test('explicit authenticator confirmation saves immediately after staging', async () => {
  const { code, host, order, outcome } = enrollmentHost(0)
  const section = { replaceChildren: mock(() => {}) } as unknown as HTMLElement
  const uri = { value: 'otpauth://totp/Nook:test?secret=secret' }
  const candidate = { sourceLabel: 'Nook', otpauthUri: uri.value }

  const enrollment = enrollmentFlow.beginEnrollmentCeremony({
    host,
    section,
    vaultStoreId: 'vault-1',
    otpauthUri: uri,
    candidate,
  })
  expect(enrollmentFlow.enrollmentScanBlocked()).toBe(true)
  await enrollment

  expect(order).toEqual(['stage', 'confirm'])
  expect(
    host.sendAuthenticatorEnrollmentStageRuntimeMessage,
  ).toHaveBeenCalledWith({
    type: 'nook:website-authenticator-enroll-stage',
    payload: {
      origin: 'https://example.test',
      vaultStoreId: 'vault-1',
      otpauthUri: 'otpauth://totp/Nook:test?secret=secret',
    },
  })
  expect(
    host.sendAuthenticatorEnrollmentConfirmRuntimeMessage,
  ).toHaveBeenCalledWith({
    type: 'nook:website-authenticator-enroll-confirm',
    payload: {
      origin: 'https://example.test',
      vaultStoreId: 'vault-1',
      stageId: 'stage-1',
    },
  })
  expect(uri.value).toBe('')
  expect(candidate).toEqual({ sourceLabel: '', otpauthUri: '' })
  expect(code).not.toHaveBeenCalled()
  expect(outcome).not.toHaveBeenCalled()
  expect(host.description.textContent).toBe(
    BROWSER_MESSAGE_KEYS.WidgetEnrollSaved,
  )
  expect(section.replaceChildren).toHaveBeenCalledOnce()
  expect(enrollmentFlow.enrollmentCeremonyActive()).toBe(true)
  expect(enrollmentFlow.enrollmentScanBlocked()).toBe(false)
  expect(enrollmentFlow.enrollmentCeremonyActive()).toBe(false)
})

test('immediate authenticator save reports confirmation failure truthfully', async () => {
  const { code, host, order, outcome } = enrollmentHost(1)
  const section = { replaceChildren: mock(() => {}) } as unknown as HTMLElement
  const uri = { value: 'otpauth://totp/Nook:test?secret=secret' }
  const candidate = { sourceLabel: 'Nook', otpauthUri: uri.value }

  await enrollmentFlow.beginEnrollmentCeremony({
    host,
    section,
    vaultStoreId: 'vault-1',
    otpauthUri: uri,
    candidate,
  })

  expect(order).toEqual(['stage', 'confirm'])
  expect(uri.value).toBe('')
  expect(candidate).toEqual({ sourceLabel: '', otpauthUri: '' })
  expect(code).not.toHaveBeenCalled()
  expect(outcome).not.toHaveBeenCalled()
  expect(host.description.textContent).toBe(
    BROWSER_MESSAGE_KEYS.WidgetEnrollFailed,
  )
  expect(enrollmentFlow.enrollmentCeremonyActive()).toBe(false)
})
