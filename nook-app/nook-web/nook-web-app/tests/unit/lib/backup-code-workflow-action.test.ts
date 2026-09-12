import { beforeEach, describe, expect, test, vi } from 'vitest'
import { AuthenticationWorkflowAction } from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { emptyPasswordFormSummary } from '../../../../nook-web-shared/src/extension/password-form-summary-state'
import type { EnrollmentFlowHost } from '../../../../nook-web-extension/src/content/enrollment-flow'
import type { PasswordFormObservation } from '../../../../nook-web-shared/src/extension/password-forms'

type RevalidationRequest = ConstructorParameters<
  typeof import('../../../../nook-web-extension/src/content/autofill/workflow-revalidation').RevalidatedAuthenticationAction
>[0]
type RevalidationOutcome = Awaited<
  ReturnType<
    typeof import('../../../../nook-web-extension/src/content/autofill/workflow-revalidation').RevalidatedAuthenticationAction.prototype.execute
  >
>

const mocks = vi.hoisted(() => ({
  revalidate: vi.fn(
    async (request: RevalidationRequest): Promise<RevalidationOutcome> => {
      void request
      return { kind: 'rejected' }
    },
  ),
  startEnrollment: vi.fn<() => void>(),
}))
vi.mock(
  '../../../../nook-web-extension/src/content/autofill/workflow-revalidation',
  () => ({
    AuthenticationObservationBindingKind: { Unbound: 'unbound' },
    RevalidatedAuthenticationActionOutcomeKind: { Acted: 'acted' },
    RevalidatedAuthenticationActResultKind: { Acted: 'acted' },
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
      sendDecodedRuntimeMessage: vi.fn<EnrollmentFlowHost['sendDecodedRuntimeMessage']>(),
      sendAuthenticationOutcomeRuntimeMessage: vi.fn<EnrollmentFlowHost['sendAuthenticationOutcomeRuntimeMessage']>(),
      sendAuthenticatorBackupAttachRuntimeMessage: vi.fn<EnrollmentFlowHost['sendAuthenticatorBackupAttachRuntimeMessage']>(),
      sendAuthenticatorEnrollmentConfirmRuntimeMessage: vi.fn<EnrollmentFlowHost['sendAuthenticatorEnrollmentConfirmRuntimeMessage']>(),
      sendAuthenticatorEnrollmentStageRuntimeMessage: vi.fn<EnrollmentFlowHost['sendAuthenticatorEnrollmentStageRuntimeMessage']>(),
      sendAuthenticatorCodeRuntimeMessage: vi.fn<EnrollmentFlowHost['sendAuthenticatorCodeRuntimeMessage']>(),
      sendAuthenticatorOptionsRuntimeMessage: vi.fn<EnrollmentFlowHost['sendAuthenticatorOptionsRuntimeMessage']>(),
      sendAuthenticatorPreviewRuntimeMessage: vi.fn<EnrollmentFlowHost['sendAuthenticatorPreviewRuntimeMessage']>(),
      sendRuntimeMessageWithoutResponse: vi.fn<EnrollmentFlowHost['sendRuntimeMessageWithoutResponse']>(),
      translatedMessageWithSubstitution: vi.fn<EnrollmentFlowHost['translatedMessageWithSubstitution']>(),
    }
    document.body.append(title, description, step, continueButton, openVaultButton)
    return host
  }
  test('starts extraction only inside a fresh Rust-approved action', async () => {
    mocks.revalidate.mockImplementation(async (request) => {
      const result = request.act()
      return { kind: result.kind === 'acted' ? 'acted' : 'action-failed' }
    })
    const workflow: PasswordFormObservation = {
      root: document,
      formScope: { kind: 'unowned' },
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
    mocks.revalidate.mockResolvedValue(false)
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
        new Promise<{ kind: string }>((resolve) => {
          release = () => resolve({ kind: 'rejected' })
        }),
    )
    const host = connectedHost()
    const request: ConstructorParameters<typeof RevalidatedEnrollmentAction>[0] = {
      workflow: {
        root: document,
        formScope: { kind: 'unowned' },
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
