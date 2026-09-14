import { expect, mock, test } from 'bun:test'
import { companionWasmReady } from '../../nook-web-shared/src/extension/companion-ready'
import { BROWSER_MESSAGE_KEYS } from '../src/lib/browser-message-keys'
import type { EnrollmentFlowHost } from '../src/content/enrollment-flow'
import {
  RuntimeMessageDeliveryKind,
  type AuthenticatorEnrollmentConfirmResponse,
  type AuthenticatorEnrollmentStageResponse,
} from '../src/content/autofill/runtime-message-adapter'
import type { BrowserMessageKey } from '../src/lib/browser-message-keys'

function installTestDocument(): void {
  Object.assign(globalThis, {
    document: {
      createElement: () => ({
        disabled: false,
        hidden: false,
        isConnected: true,
        remove: mock(() => {}),
        replaceChildren: mock(() => {}),
        append: mock(() => {}),
        textContent: '',
      }),
      querySelectorAll: () => [],
    },
    location: { origin: 'https://example.test' },
  })
}
installTestDocument()

await companionWasmReady
const { authenticatorEnrollmentInteraction } =
  await import('../src/content/enrollment-flow')
const delivered = <Response>(response: Response) => ({
  kind: RuntimeMessageDeliveryKind.Delivered,
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
  const host: EnrollmentFlowHost = {
    panel: document.createElement('div'),
    title: document.createElement('h2'),
    description: document.createElement('p'),
    step: document.createElement('p'),
    continueButton: document.createElement('button'),
    openVaultButton: document.createElement('button'),
    setBusy: mock(() => {}),
    isBusy: () => false,
    translatedMessage: (key: BrowserMessageKey) => key,
    sendAuthenticatorEnrollmentStageRuntimeMessage: mock(async () => {
      order.push('stage')
      const response: AuthenticatorEnrollmentStageResponse = {
        kind: 0,
        stageId: 'stage-1',
      }
      return delivered(response)
    }),
    sendAuthenticatorEnrollmentConfirmRuntimeMessage: mock(async () => {
      order.push('confirm')
      const response: AuthenticatorEnrollmentConfirmResponse =
        confirmKind === 0
          ? { kind: 0, secretId: 'secret-1' }
          : { kind: 1, reason: 'authenticator-enroll-failed' }
      return delivered(response)
    }),
    sendAuthenticatorCodeRuntimeMessage: code,
    sendAuthenticationOutcomeRuntimeMessage: outcome,
    sendDecodedRuntimeMessage: async () => {
      throw new Error('decoded runtime message must not run')
    },
    sendAuthenticatorBackupAttachRuntimeMessage: async () => {
      throw new Error('backup attach must not run')
    },
    sendAuthenticatorOptionsRuntimeMessage: async () => {
      throw new Error('authenticator options must not run')
    },
    sendAuthenticatorPreviewRuntimeMessage: async () => {
      throw new Error('authenticator preview must not run')
    },
    sendRuntimeMessageWithoutResponse: () => {},
    translatedMessageWithSubstitution: ({ key, substitution }) =>
      `${key}:${substitution}`,
  }
  return { code, host, order, outcome }
}

test('explicit authenticator confirmation saves immediately after staging', async () => {
  const { code, host, order, outcome } = enrollmentHost(0)
  const section = document.createElement('section')
  const uri = { value: 'otpauth://totp/Nook:test?secret=secret' }
  const candidate = { sourceLabel: 'Nook', otpauthUri: uri.value }

  const enrollment = authenticatorEnrollmentInteraction.beginEnrollmentCeremony(
    {
      host,
      section,
      vaultStoreId: 'vault-1',
      otpauthUri: uri,
      candidate,
    },
  )
  expect(authenticatorEnrollmentInteraction.enrollmentScanBlocked()).toBe(true)
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
  expect(section.replaceChildren).toHaveBeenCalledTimes(1)
  expect(authenticatorEnrollmentInteraction.enrollmentCeremonyActive()).toBe(
    true,
  )
  expect(authenticatorEnrollmentInteraction.enrollmentScanBlocked()).toBe(false)
  expect(authenticatorEnrollmentInteraction.enrollmentCeremonyActive()).toBe(
    false,
  )
})

test('immediate authenticator save reports confirmation failure truthfully', async () => {
  const { code, host, order, outcome } = enrollmentHost(1)
  const section = document.createElement('section')
  const uri = { value: 'otpauth://totp/Nook:test?secret=secret' }
  const candidate = { sourceLabel: 'Nook', otpauthUri: uri.value }

  await authenticatorEnrollmentInteraction.beginEnrollmentCeremony({
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
  expect(authenticatorEnrollmentInteraction.enrollmentCeremonyActive()).toBe(
    false,
  )
})
