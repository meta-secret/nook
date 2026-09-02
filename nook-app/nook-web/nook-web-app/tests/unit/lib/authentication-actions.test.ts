import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  AuthenticationWorkflowAction,
  AuthenticatorCodeResponseKind,
  GeneratedPasswordResponseKind,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import type { AuthenticationWorkflowApproval } from '../../../../nook-web-extension/src/lib/auth-workflow-messages'
import type { PasswordFormObservation } from '../../../../nook-web-shared/src/extension/password-forms'

const actionMocks = vi.hoisted(() => ({
  clearLoginCredentials: vi.fn(),
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
  clearLoginCredentials: actionMocks.clearLoginCredentials,
  fillGeneratedPassword: actionMocks.fillGeneratedPassword,
  fillLoginCredentials: actionMocks.fillLoginCredentials,
  fillOneTimeCode: actionMocks.fillOneTimeCode,
  findWorkflowPasskeyControl: actionMocks.findWorkflowPasskeyControl,
  FormSubmissionResult: {
    NotObserved: 'not-observed',
    Submitted: 'submitted',
    Rejected: 'rejected',
  },
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
    RevalidatedAuthenticationActionOutcomeKind: {
      Acted: 'acted',
      Rejected: 'rejected',
      ActionFailed: 'action-failed',
      ControlMissing: 'control-missing',
    },
    RevalidatedAuthenticationActResultKind: {
      Acted: 'acted',
      Failed: 'failed',
      ControlMissing: 'control-missing',
    },
    requiredAuthenticationObservationBinding: () => ({
      kind: 'required',
      token: 'rendered-observation',
    }),
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

import { widgetState } from '../../../../nook-web-extension/src/content/autofill/state'
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
} as unknown as PasswordFormObservation

const approval: AuthenticationWorkflowApproval = {
  workflowKey: 'login:credentials',
  facts: {} as AuthenticationWorkflowApproval['facts'],
}

function controls() {
  const result = {
    step: document.createElement('p'),
    title: document.createElement('h2'),
    description: document.createElement('p'),
    continueButton: document.createElement('button'),
  }
  document.body.append(result.continueButton)
  return result
}

enum DeferredResolverKind {
  Waiting = 'waiting',
  Available = 'available',
}

type DeferredResolver<Value> =
  | { kind: DeferredResolverKind.Waiting }
  | {
      kind: DeferredResolverKind.Available
      resolve: (value: Value) => void
    }

function deferred<Value>() {
  let resolver: DeferredResolver<Value> = {
    kind: DeferredResolverKind.Waiting,
  }
  const promise = new Promise<Value>((resolve) => {
    resolver = { kind: DeferredResolverKind.Available, resolve }
  })
  return {
    promise,
    resolve: (value: Value) => {
      if (resolver.kind !== DeferredResolverKind.Available) {
        throw new Error('deferred resolver was not initialized')
      }
      resolver.resolve(value)
    },
  }
}

beforeEach(() => {
  document.body.replaceChildren()
  vi.clearAllMocks()
  widgetState.dismissed = false
  actionMocks.performRevalidation.mockImplementation(async (request) => {
    const actResult = request.act({
      currentWorkflow: workflow,
      observationBindingToken: 'approved-observation',
      revalidateCurrentWorkflow: () => workflow,
    })
    return {
      kind:
        actResult.kind === 'acted'
          ? 'acted'
          : actResult.kind === 'control-missing'
            ? 'control-missing'
            : 'action-failed',
    }
  })
})

describe('revalidated authentication actions', () => {
  test('binds login credential release and fill to one observation', async () => {
    actionMocks.sendLoginFill.mockResolvedValue({
      kind: 'delivered',
      response: { ok: true, username: 'person', password: 'secret' },
    })

    await expect(
      fillAndSubmitAccount({
        account: {
          vaultStoreId: 'vault',
          secretId: 'login',
          authorizationGeneration: 'epoch-1',
        },
        workflow,
        approval,
        ...controls(),
      }),
    ).resolves.toBe(true)

    expect(actionMocks.performRevalidation).toHaveBeenCalledTimes(2)
    expect(actionMocks.performRevalidation.mock.calls[1]?.[0]).toMatchObject({
      observationBinding: {
        kind: 'required',
        token: 'approved-observation',
      },
    })
    expect(actionMocks.fillLoginCredentials).toHaveBeenCalledOnce()
    expect(actionMocks.submitLoginForm).toHaveBeenCalledOnce()
  })

  test('authorizes OTP release before filling the returned code', async () => {
    actionMocks.sendAuthenticatorCode.mockResolvedValue({
      kind: 'delivered',
      response: {
        kind: AuthenticatorCodeResponseKind.Ready,
        code: '123456',
        expiresAt: Date.now() + 30_000,
      },
    })

    await expect(
      fillAuthenticatorCode({
        account: { vaultStoreId: 'vault', secretId: 'otp' },
        workflow,
        approval,
        ...controls(),
      }),
    ).resolves.toBe(true)

    expect(actionMocks.performRevalidation).toHaveBeenCalledTimes(2)
    expect(actionMocks.sendAuthenticatorCode).toHaveBeenCalledOnce()
    expect(actionMocks.fillOneTimeCode).toHaveBeenCalledOnce()
  })

  test('scrubs delayed login credentials after the approved surface is replaced', async () => {
    const response = { ok: true, username: 'person', password: 'secret' }
    const delivery = deferred<{ kind: string; response: typeof response }>()
    actionMocks.sendLoginFill.mockReturnValue(delivery.promise)
    const ui = controls()
    const pending = fillAndSubmitAccount({
      account: {
        vaultStoreId: 'vault',
        secretId: 'login',
        authorizationGeneration: 'epoch-1',
      },
      workflow,
      approval,
      ...ui,
    })
    await vi.waitFor(() => expect(actionMocks.sendLoginFill).toHaveBeenCalled())
    ui.continueButton.remove()
    delivery.resolve({ kind: 'delivered', response })

    await expect(pending).resolves.toBe(false)
    expect(response.password).toBe('')
    expect(actionMocks.fillLoginCredentials).not.toHaveBeenCalled()
  })

  test('scrubs a delayed authenticator code after the approved surface is replaced', async () => {
    const response = {
      kind: AuthenticatorCodeResponseKind.Ready,
      code: '123456',
      expiresAt: Date.now() + 30_000,
    }
    const delivery = deferred<{ kind: string; response: typeof response }>()
    actionMocks.sendAuthenticatorCode.mockReturnValue(delivery.promise)
    const ui = controls()
    const pending = fillAuthenticatorCode({
      account: { vaultStoreId: 'vault', secretId: 'otp' },
      workflow,
      approval,
      ...ui,
    })
    await vi.waitFor(() =>
      expect(actionMocks.sendAuthenticatorCode).toHaveBeenCalled(),
    )
    ui.continueButton.remove()
    delivery.resolve({ kind: 'delivered', response })

    await expect(pending).resolves.toBe(false)
    expect(response.code).toBe('')
    expect(actionMocks.fillOneTimeCode).not.toHaveBeenCalled()
  })

  test('scrubs a delayed generated password after the approved surface is replaced', async () => {
    const response = {
      kind: GeneratedPasswordResponseKind.Generated,
      password: 'generated-secret',
    }
    const delivery = deferred<{ kind: string; response: typeof response }>()
    actionMocks.sendGeneratePassword.mockReturnValue(delivery.promise)
    const ui = controls()
    const pending = generatePasswordWithNook({
      workflow,
      approval,
      ...ui,
    })
    await vi.waitFor(() =>
      expect(actionMocks.sendGeneratePassword).toHaveBeenCalled(),
    )
    ui.continueButton.remove()
    delivery.resolve({ kind: 'delivered', response })

    await pending
    expect(response.password).toBe('')
    expect(actionMocks.fillGeneratedPassword).not.toHaveBeenCalled()
  })

  test('actuates only the passkey control returned by approved lookup', async () => {
    const approvedControl = document.createElement('button')
    actionMocks.findWorkflowPasskeyControl.mockReturnValue({
      kind: 'found',
      control: approvedControl,
    })
    const click = vi.spyOn(approvedControl, 'click')
    const ui = controls()
    document.body.append(ui.continueButton)

    await proposePasskeyWithNook({
      description: ui.description,
      continueButton: ui.continueButton,
      action: AuthenticationWorkflowAction.UsePasskey,
      workflow,
      approval,
    })
    expect(click).not.toHaveBeenCalled()

    await proposePasskeyWithNook({
      description: ui.description,
      continueButton: ui.continueButton,
      action: AuthenticationWorkflowAction.UsePasskey,
      workflow,
      approval,
    })

    expect(click).toHaveBeenCalledOnce()
  })

  test('does not prepare passkey actuation after approval is withdrawn', async () => {
    const approvedControl = document.createElement('button')
    actionMocks.findWorkflowPasskeyControl.mockReturnValue({
      kind: 'found',
      control: approvedControl,
    })
    const click = vi.spyOn(approvedControl, 'click')
    const ui = controls()
    actionMocks.performRevalidation.mockImplementationOnce(async (request) => {
      widgetState.dismissed = true
      expect(request.approvalIsActive()).toBe(false)
      return { kind: 'rejected' }
    })

    await proposePasskeyWithNook({
      description: ui.description,
      continueButton: ui.continueButton,
      action: AuthenticationWorkflowAction.UsePasskey,
      workflow,
      approval,
    })

    expect(click).not.toHaveBeenCalled()
    expect(actionMocks.findWorkflowPasskeyControl).not.toHaveBeenCalled()
  })

  test('revalidates the submit route after credential input handlers run', async () => {
    const response = {
      ok: true,
      username: 'ada@example.test',
      password: 'vault-secret',
    }
    actionMocks.sendLoginFill.mockResolvedValue({
      kind: 'delivered',
      response,
    })
    actionMocks.performRevalidation.mockImplementationOnce(async (request) => {
      const result = request.act({
        currentWorkflow: workflow,
        observationBindingToken: 'approved-observation',
        revalidateCurrentWorkflow: () => workflow,
      })
      return { kind: result.kind }
    })
    actionMocks.performRevalidation.mockImplementationOnce(async (request) => {
      const result = request.act({
        currentWorkflow: workflow,
        observationBindingToken: 'approved-observation',
        revalidateCurrentWorkflow: () => false,
      })
      return {
        kind: result.kind === 'acted' ? 'acted' : 'action-failed',
      }
    })

    await expect(
      fillAndSubmitAccount({
        account: {
          vaultStoreId: 'vault',
          secretId: 'login',
          authorizationGeneration: 'epoch-1',
        },
        workflow,
        approval,
        ...controls(),
      }),
    ).resolves.toBe(false)

    expect(actionMocks.fillLoginCredentials).toHaveBeenCalledOnce()
    expect(actionMocks.submitLoginForm).not.toHaveBeenCalled()
    expect(response.password).toBe('')
  })

  test('refuses a TOTP that expires during revalidation', async () => {
    const response = {
      kind: AuthenticatorCodeResponseKind.Ready,
      code: '123456',
      expiresAt: Date.now() - 1,
    }
    actionMocks.sendAuthenticatorCode.mockResolvedValue({
      kind: 'delivered',
      response,
    })

    await expect(
      fillAuthenticatorCode({
        account: { vaultStoreId: 'vault', secretId: 'otp' },
        workflow,
        approval,
        ...controls(),
      }),
    ).resolves.toBe(false)

    expect(actionMocks.fillOneTimeCode).not.toHaveBeenCalled()
    expect(response.code).toBe('')
  })

  test('binds generated password release and fill to one observation', async () => {
    actionMocks.sendGeneratePassword.mockResolvedValue({
      kind: 'delivered',
      response: {
        kind: GeneratedPasswordResponseKind.Generated,
        password: 'generated-secret',
      },
    })

    await generatePasswordWithNook({ workflow, approval, ...controls() })

    expect(actionMocks.performRevalidation).toHaveBeenCalledTimes(2)
    expect(actionMocks.performRevalidation.mock.calls[1]?.[0]).toMatchObject({
      expectedAction: AuthenticationWorkflowAction.GeneratePassword,
      observationBinding: {
        kind: 'required',
        token: 'approved-observation',
      },
    })
    expect(actionMocks.fillGeneratedPassword).toHaveBeenCalledWith(
      expect.objectContaining({ password: 'generated-secret' }),
    )
  })
})
