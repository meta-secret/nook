import { beforeEach, describe, expect, test, vi } from 'vitest'
import { AuthenticationWorkflowAction } from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { PasswordFormScopeKind } from '../../../../nook-web-shared/src/extension/password-form-fields'
import { emptyPasswordFormSummary } from '../../../../nook-web-shared/src/extension/password-form-summary-state'
import type { EnrollmentFlowHost } from '../../../../nook-web-extension/src/content/enrollment-flow'
import type { PasswordFormObservation } from '../../../../nook-web-shared/src/extension/password-forms'
import { RuntimeMessageDeliveryKind } from '../../../../nook-web-extension/src/content/autofill/runtime-message-adapter'
import type { RuntimeMessageDelivery } from '../../../../nook-web-extension/src/content/autofill/runtime-message-adapter'
import {
  RevalidatedAuthenticationActionOutcomeKind,
  RevalidatedAuthenticationActResultKind,
} from '../../../../nook-web-extension/src/content/autofill/workflow-revalidation'

type RevalidationRequest = ConstructorParameters<
  typeof import('../../../../nook-web-extension/src/content/autofill/workflow-revalidation').RevalidatedAuthenticationAction
>[0]
type RevalidationOutcome = Awaited<
  ReturnType<
    typeof import('../../../../nook-web-extension/src/content/autofill/workflow-revalidation').RevalidatedAuthenticationAction.prototype.execute
  >
>

const mocks = vi.hoisted(() => ({
  revalidate: vi.fn<
    (request: RevalidationRequest) => Promise<RevalidationOutcome>
  >(),
  startEnrollment: vi.fn<() => void>(),
}))
vi.mock(
  '../../../../nook-web-extension/src/content/autofill/workflow-revalidation',
  () => ({
    AuthenticationObservationBindingKind: { Unbound: 'unbound' },
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
    RevalidatedAuthenticationAction: class {
      constructor(
        private readonly request: RevalidationRequest,
      ) {}
      execute() {
        return mocks.revalidate(this.request)
      }
      static requiredAuthenticationObservationBinding() {
        return { kind: 'required', token: 'rendered-observation' }
      }
    },
  }),
)
import { RevalidatedEnrollmentAction } from '../../../../nook-web-extension/src/content/autofill/backup-code-workflow-action'
beforeEach(() => vi.clearAllMocks())
describe('backup-code workflow action', () => {
  function connectedHost() {
    let busy = false
    const panel = document.createElement('section')
    const title = document.createElement('h2')
    const description = document.createElement('p')
    const step = document.createElement('p')
    const continueButton = document.createElement('button')
    const openVaultButton = document.createElement('button')
    document.body.append(panel)
    const sendDecodedRuntimeMessage: EnrollmentFlowHost['sendDecodedRuntimeMessage'] =
      async <Response>(): Promise<RuntimeMessageDelivery<Response>> => ({
        kind: RuntimeMessageDeliveryKind.Unavailable,
      })
    const host: EnrollmentFlowHost = {
      panel,
      title,
      description,
      translatedMessage: (key) => key,
      step,
      continueButton,
      openVaultButton,
      isBusy: () => busy,
      setBusy: (value: boolean) => {
        busy = value
      },
      sendDecodedRuntimeMessage,
      sendAuthenticationOutcomeRuntimeMessage:
        vi.fn<EnrollmentFlowHost['sendAuthenticationOutcomeRuntimeMessage']>(),
      sendAuthenticatorBackupAttachRuntimeMessage:
        vi.fn<
          EnrollmentFlowHost['sendAuthenticatorBackupAttachRuntimeMessage']
        >(),
      sendAuthenticatorEnrollmentConfirmRuntimeMessage:
        vi.fn<
          EnrollmentFlowHost['sendAuthenticatorEnrollmentConfirmRuntimeMessage']
        >(),
      sendAuthenticatorEnrollmentStageRuntimeMessage:
        vi.fn<
          EnrollmentFlowHost['sendAuthenticatorEnrollmentStageRuntimeMessage']
        >(),
      sendAuthenticatorCodeRuntimeMessage:
        vi.fn<EnrollmentFlowHost['sendAuthenticatorCodeRuntimeMessage']>(),
      sendAuthenticatorOptionsRuntimeMessage:
        vi.fn<EnrollmentFlowHost['sendAuthenticatorOptionsRuntimeMessage']>(),
      sendAuthenticatorPreviewRuntimeMessage:
        vi.fn<EnrollmentFlowHost['sendAuthenticatorPreviewRuntimeMessage']>(),
      sendRuntimeMessageWithoutResponse:
        vi.fn<EnrollmentFlowHost['sendRuntimeMessageWithoutResponse']>(),
      translatedMessageWithSubstitution:
        vi.fn<EnrollmentFlowHost['translatedMessageWithSubstitution']>(),
    }
    document.body.append(title, description, step, continueButton, openVaultButton)
    return host
  }
  test('starts extraction only inside a fresh Rust-approved action', async () => {
    mocks.revalidate.mockImplementation(async (request) => {
      const result = request.act({
        currentWorkflow: workflow,
        observationBindingToken: 'approved-observation',
        revalidateCurrentWorkflow: () => workflow,
      })
      return {
        kind:
          result.kind === RevalidatedAuthenticationActResultKind.Acted
            ? RevalidatedAuthenticationActionOutcomeKind.Acted
            : RevalidatedAuthenticationActionOutcomeKind.ActionFailed,
      }
    })
    const workflow: PasswordFormObservation = {
      root: document,
      formScope: { kind: PasswordFormScopeKind.Unowned },
      summary: { ...emptyPasswordFormSummary },
    }
    const host = connectedHost()
    await expect(
      new RevalidatedEnrollmentAction({
        workflow,
        host,
        action: AuthenticationWorkflowAction.SaveBackupCodes,
        start: mocks.startEnrollment,
      }).execute(),
    ).resolves.toBe(true)
    expect(mocks.revalidate).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedAction: AuthenticationWorkflowAction.SaveBackupCodes,
      }),
    )
    expect(mocks.startEnrollment).toHaveBeenCalledOnce()
  })
  test('does not extract when Rust rejects the refreshed workflow', async () => {
    mocks.revalidate.mockResolvedValue({
      kind: RevalidatedAuthenticationActionOutcomeKind.Rejected,
    })
    await expect(
      new RevalidatedEnrollmentAction({
        host: connectedHost(),
        action: AuthenticationWorkflowAction.SaveBackupCodes,
        start: mocks.startEnrollment,
      }).execute(),
    ).resolves.toBe(false)
    expect(mocks.startEnrollment).not.toHaveBeenCalled()
  })
  test('rejects a second approval while revalidation is pending', async () => {
    let release: () => void = () => {
      throw new Error('revalidation release was not installed')
    }
    mocks.revalidate.mockImplementation(
      () =>
        new Promise<RevalidationOutcome>((resolve) => {
          release = () =>
            resolve({ kind: RevalidatedAuthenticationActionOutcomeKind.Rejected })
        }),
    )
    const host = connectedHost()
    const request: ConstructorParameters<typeof RevalidatedEnrollmentAction>[0] = {
      workflow: {
        root: document,
        formScope: { kind: PasswordFormScopeKind.Unowned },
        summary: { ...emptyPasswordFormSummary },
      },
      host,
      action: AuthenticationWorkflowAction.SaveBackupCodes,
      start: mocks.startEnrollment,
    }
    const first = new RevalidatedEnrollmentAction(request).execute()
    await expect(
      new RevalidatedEnrollmentAction(request).execute(),
    ).resolves.toBe(false)
    expect(mocks.revalidate).toHaveBeenCalledOnce()
    release?.()
    await first
  })
})
