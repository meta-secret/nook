import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  AuthenticationWorkflowAction,
  AuthenticatorCodeResponseKind,
  GeneratedPasswordResponseKind,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

const actionMocks = vi.hoisted(() => ({
  fillLoginCredentials: vi.fn(() => true),
  fillGeneratedPassword: vi.fn(() => true),
  fillOneTimeCode: vi.fn(() => true),
  findWorkflowPasskeyControl: vi.fn(),
  performRevalidation: vi.fn(),
  sendAuthenticatorCode: vi.fn(),
  sendLoginFill: vi.fn(),
  sendGeneratePassword: vi.fn(),
  submitLoginForm: vi.fn(() => true),
}))

vi.mock('../../../../nook-web-shared/src/extension/password-forms', () => ({
  fillGeneratedPassword: actionMocks.fillGeneratedPassword,
  fillLoginCredentials: actionMocks.fillLoginCredentials,
  fillOneTimeCode: actionMocks.fillOneTimeCode,
  findWorkflowPasskeyControl: actionMocks.findWorkflowPasskeyControl,
  PasskeyControlLookupKind: { Absent: 'absent', Found: 'found' },
  PasswordFormQueryKind: { Scoped: 'scoped' },
  submitLoginForm: actionMocks.submitLoginForm,
}))

vi.mock(
  '../../../../nook-web-extension/src/content/autofill/workflow-revalidation',
  () => ({
    AuthenticationObservationBindingKind: {
      Unbound: 'unbound',
      Required: 'required',
    },
    performRevalidatedAuthenticationAction: actionMocks.performRevalidation,
  }),
)

vi.mock(
  '../../../../nook-web-extension/src/content/autofill/login-fill-runtime-adapter',
  () => ({
    LoginFillDeliveryKind: {
      Delivered: 'delivered',
      Unavailable: 'unavailable',
    },
    sendLoginFillMessage: actionMocks.sendLoginFill,
  }),
)

vi.mock(
  '../../../../nook-web-extension/src/content/autofill/runtime-message-adapter',
  () => ({
    RuntimeMessageDeliveryKind: {
      Delivered: 'delivered',
      Unavailable: 'unavailable',
    },
    sendAuthenticationWorkflowSnapshotRuntimeMessage: vi.fn(),
    sendAuthenticationOutcomeRuntimeMessage: vi.fn(),
    sendAuthenticatorBackupAttachRuntimeMessage: vi.fn(),
    sendAuthenticatorCodeRuntimeMessage: actionMocks.sendAuthenticatorCode,
    sendAuthenticatorEnrollmentConfirmRuntimeMessage: vi.fn(),
    sendAuthenticatorEnrollmentStageRuntimeMessage: vi.fn(),
    sendAuthenticatorOptionsRuntimeMessage: vi.fn(),
    sendAuthenticatorPickerOpenRuntimeMessage: vi.fn(),
    sendAuthenticatorPreviewRuntimeMessage: vi.fn(),
    sendDecodedRuntimeMessage: vi.fn(),
    sendGeneratePasswordRuntimeMessage: actionMocks.sendGeneratePassword,
    sendLoginOptionsRuntimeMessage: vi.fn(),
    sendLoginPickerOpenRuntimeMessage: vi.fn(),
    sendLoginSaveActionRuntimeMessage: vi.fn(),
    sendLoginSaveOfferRuntimeMessage: vi.fn(),
    sendLoginSavePendingRuntimeMessage: vi.fn(),
    sendRuntimeMessageWithoutResponse: vi.fn(),
  }),
)

vi.mock(
  '../../../../nook-web-extension/src/content/autofill/workflow-ui',
  () => ({
    setFlightProgress: vi.fn(),
    translatedMessage: (key: string) => key,
  }),
)

vi.mock('../../../../nook-web-extension/src/content/autofill/state', () => ({
  AuthenticatorPickerKind: { Closed: 'closed', Open: 'open' },
  LoginPickerKind: { Closed: 'closed', Open: 'open' },
  pickerState: {},
  widgetState: { busy: false },
}))

import { fillAuthenticatorCode } from '../../../../nook-web-extension/src/content/autofill/authenticator-actions'
import {
  fillAndSubmitAccount,
  generatePasswordWithNook,
  proposePasskeyWithNook,
} from '../../../../nook-web-extension/src/content/autofill/login-passkey-actions'

const workflow = {
  root: document,
  formScope: { kind: 'unowned' },
  summary: {},
}

function controls() {
  return {
    step: document.createElement('p'),
    title: document.createElement('h2'),
    description: document.createElement('p'),
    continueButton: document.createElement('button'),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  actionMocks.performRevalidation.mockImplementation(async (request) =>
    request.act({
      currentWorkflow: workflow,
      observationDigest: 'approved-observation',
    }),
  )
})

describe('revalidated authentication actions', () => {
  test('binds login credential release and fill to one observation', async () => {
    actionMocks.sendLoginFill.mockResolvedValue({
      kind: 'delivered',
      response: { ok: true, username: 'person', password: 'secret' },
    })

    await expect(
      fillAndSubmitAccount({
        account: { vaultStoreId: 'vault', secretId: 'login' },
        workflow,
        ...controls(),
      }),
    ).resolves.toBe(true)

    expect(actionMocks.performRevalidation).toHaveBeenCalledTimes(2)
    expect(actionMocks.performRevalidation.mock.calls[1]?.[0]).toMatchObject({
      observationBinding: {
        kind: 'required',
        observationDigest: 'approved-observation',
      },
    })
    expect(actionMocks.fillLoginCredentials).toHaveBeenCalledOnce()
    expect(actionMocks.submitLoginForm).toHaveBeenCalledOnce()
  })

  test('authorizes OTP release before filling the returned code', async () => {
    actionMocks.sendAuthenticatorCode.mockResolvedValue({
      kind: 'delivered',
      response: { kind: AuthenticatorCodeResponseKind.Ready, code: '123456' },
    })

    await expect(
      fillAuthenticatorCode({
        account: { vaultStoreId: 'vault', secretId: 'otp' },
        workflow,
        ...controls(),
      }),
    ).resolves.toBe(true)

    expect(actionMocks.performRevalidation).toHaveBeenCalledTimes(2)
    expect(actionMocks.sendAuthenticatorCode).toHaveBeenCalledOnce()
    expect(actionMocks.fillOneTimeCode).toHaveBeenCalledOnce()
  })

  test('actuates only the passkey control returned by approved lookup', async () => {
    const approvedControl = document.createElement('button')
    actionMocks.findWorkflowPasskeyControl.mockReturnValue({
      kind: 'found',
      control: approvedControl,
    })
    const click = vi.spyOn(approvedControl, 'click')
    const ui = controls()

    await proposePasskeyWithNook({
      description: ui.description,
      continueButton: ui.continueButton,
      action: AuthenticationWorkflowAction.UsePasskey,
      workflow,
    })

    expect(click).toHaveBeenCalledOnce()
  })

  test('binds generated password release and fill to one observation', async () => {
    actionMocks.sendGeneratePassword.mockResolvedValue({
      kind: 'delivered',
      response: {
        kind: GeneratedPasswordResponseKind.Generated,
        password: 'generated-secret',
      },
    })

    await generatePasswordWithNook({ workflow, ...controls() })

    expect(actionMocks.performRevalidation).toHaveBeenCalledTimes(2)
    expect(actionMocks.performRevalidation.mock.calls[1]?.[0]).toMatchObject({
      expectedAction: AuthenticationWorkflowAction.GeneratePassword,
      observationBinding: {
        kind: 'required',
        observationDigest: 'approved-observation',
      },
    })
    expect(actionMocks.fillGeneratedPassword).toHaveBeenCalledWith(
      expect.objectContaining({ password: 'generated-secret' }),
    )
  })
})
