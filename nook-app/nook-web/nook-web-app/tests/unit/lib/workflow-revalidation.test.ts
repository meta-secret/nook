import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  AuthenticationWorkflowAction,
  AuthenticationWorkflowKind,
  AuthenticationWorkflowSnapshotResponseKind,
  AuthenticationWorkflowStage,
  type AuthenticationApprovalRequirement,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  summarizeAuthenticationWorkflowForms,
  type PasswordFormObservation,
} from '../../../../nook-web-shared/src/extension/password-forms'

const runtime = vi.hoisted(() => ({ sendSnapshot: vi.fn() }))

vi.mock(
  '../../../../nook-web-extension/src/content/autofill/runtime-message-adapter',
  () => ({
    RuntimeMessageDeliveryKind: {
      Delivered: 'delivered',
      Unavailable: 'unavailable',
    },
    sendAuthenticationWorkflowSnapshotRuntimeMessage: runtime.sendSnapshot,
  }),
)

import { RuntimeMessageDeliveryKind } from '../../../../nook-web-extension/src/content/autofill/runtime-message-adapter'
import {
  AuthenticationObservationBindingKind,
  performRevalidatedAuthenticationAction,
} from '../../../../nook-web-extension/src/content/autofill/workflow-revalidation'

const explicitUserApproval =
  'explicit-user-approval' satisfies AuthenticationApprovalRequirement

function firstWorkflow(): PasswordFormObservation {
  const workflow = summarizeAuthenticationWorkflowForms()[0]
  if (!workflow) throw new Error('expected an authentication workflow')
  return workflow
}

afterEach(() => {
  document.body.replaceChildren()
  runtime.sendSnapshot.mockReset()
})

describe('credential-bearing workflow revalidation', () => {
  test('refuses actuation when DOM facts change while Rust is deciding', async () => {
    document.body.innerHTML = `
      <form id="otp" action="/login/mfa">
        <input autocomplete="one-time-code" />
        <button type="submit">Verify code</button>
      </form>
    `
    const workflow = firstWorkflow()
    runtime.sendSnapshot.mockImplementation(async () => {
      const form = document.querySelector<HTMLFormElement>('#otp')
      if (form) form.action = '/transfer/confirm'
      return {
        kind: RuntimeMessageDeliveryKind.Delivered,
        response: {
          kind: AuthenticationWorkflowSnapshotResponseKind.Matched,
          snapshot: {
            kind: AuthenticationWorkflowKind.TotpChallenge,
            stage: AuthenticationWorkflowStage.SecondFactor,
            action: AuthenticationWorkflowAction.FillTotp,
            currentStep: 2,
            totalSteps: 3,
            approvalRequirement: explicitUserApproval,
            observationIndex: 0,
          },
        },
      }
    })
    const act = vi.fn(() => true)

    await expect(
      performRevalidatedAuthenticationAction({
        workflow,
        expectedAction: AuthenticationWorkflowAction.FillTotp,
        observationBinding: {
          kind: AuthenticationObservationBindingKind.Unbound,
        },
        act,
      }),
    ).resolves.toBe(false)
    expect(act).not.toHaveBeenCalled()
  })

  test('refuses actuation after the observed workflow root is detached', async () => {
    const root = document.createElement('section')
    root.innerHTML = `
      <input autocomplete="one-time-code" />
      <button type="button">Verify code</button>
    `
    document.body.append(root)
    const workflow = summarizeAuthenticationWorkflowForms(root)[0]
    if (!workflow) throw new Error('expected an authentication workflow')
    runtime.sendSnapshot.mockImplementation(async () => {
      root.remove()
      return {
        kind: RuntimeMessageDeliveryKind.Delivered,
        response: {
          kind: AuthenticationWorkflowSnapshotResponseKind.Matched,
          snapshot: {
            kind: AuthenticationWorkflowKind.TotpChallenge,
            stage: AuthenticationWorkflowStage.SecondFactor,
            action: AuthenticationWorkflowAction.FillTotp,
            currentStep: 2,
            totalSteps: 3,
            approvalRequirement: explicitUserApproval,
            observationIndex: 0,
          },
        },
      }
    })
    const act = vi.fn(() => true)

    await expect(
      performRevalidatedAuthenticationAction({
        workflow,
        expectedAction: AuthenticationWorkflowAction.FillTotp,
        observationBinding: {
          kind: AuthenticationObservationBindingKind.Unbound,
        },
        act,
      }),
    ).resolves.toBe(false)
    expect(act).not.toHaveBeenCalled()
  })

  test('acts synchronously on the approved current passkey control', async () => {
    document.body.innerHTML = `
      <button type="button" data-nook-passkey-control>Use passkey</button>
    `
    const workflow = firstWorkflow()
    runtime.sendSnapshot.mockResolvedValue({
      kind: RuntimeMessageDeliveryKind.Delivered,
      response: {
        kind: AuthenticationWorkflowSnapshotResponseKind.Matched,
        snapshot: {
          kind: AuthenticationWorkflowKind.Login,
          stage: AuthenticationWorkflowStage.Credentials,
          action: AuthenticationWorkflowAction.UsePasskey,
          currentStep: 1,
          totalSteps: 3,
          approvalRequirement: explicitUserApproval,
          observationIndex: 0,
        },
      },
    })
    const act = vi.fn(() => true)

    await expect(
      performRevalidatedAuthenticationAction({
        workflow,
        expectedAction: AuthenticationWorkflowAction.UsePasskey,
        observationBinding: {
          kind: AuthenticationObservationBindingKind.Unbound,
        },
        act,
      }),
    ).resolves.toBe(true)
    expect(act).toHaveBeenCalledOnce()
    expect(act).toHaveBeenCalledWith(
      expect.objectContaining({
        currentWorkflow: expect.objectContaining({
          root: workflow.root,
          formScope: workflow.formScope,
        }),
        observationDigest: expect.any(String),
      }),
    )
  })

  test('rejects a later action when its release-bound observation changed', async () => {
    document.body.innerHTML = `
      <form id="login" action="/login">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
        <button type="submit">Sign in</button>
      </form>
    `
    const workflow = firstWorkflow()
    runtime.sendSnapshot.mockResolvedValue({
      kind: RuntimeMessageDeliveryKind.Delivered,
      response: {
        kind: AuthenticationWorkflowSnapshotResponseKind.Matched,
        snapshot: {
          kind: AuthenticationWorkflowKind.Login,
          stage: AuthenticationWorkflowStage.Credentials,
          action: AuthenticationWorkflowAction.ContinueWithNook,
          currentStep: 1,
          totalSteps: 3,
          approvalRequirement: explicitUserApproval,
          observationIndex: 0,
        },
      },
    })
    let observationDigest = ''
    await performRevalidatedAuthenticationAction({
      workflow,
      expectedAction: AuthenticationWorkflowAction.ContinueWithNook,
      observationBinding: {
        kind: AuthenticationObservationBindingKind.Unbound,
      },
      act: ({ observationDigest: approvedDigest }) => {
        observationDigest = approvedDigest
        return true
      },
    })
    document
      .querySelector<HTMLFormElement>('#login')
      ?.setAttribute('action', '/different-safe-login')
    const act = vi.fn(() => true)

    await expect(
      performRevalidatedAuthenticationAction({
        workflow,
        expectedAction: AuthenticationWorkflowAction.ContinueWithNook,
        observationBinding: {
          kind: AuthenticationObservationBindingKind.Required,
          observationDigest,
        },
        act,
      }),
    ).resolves.toBe(false)
    expect(act).not.toHaveBeenCalled()
  })

  test('sends current field semantics before allowing credential release', async () => {
    document.body.innerHTML = `
      <form action="/login">
        <input autocomplete="username" />
        <input id="password" type="password" autocomplete="current-password" />
        <button type="submit">Sign in</button>
      </form>
    `
    const workflow = firstWorkflow()
    document
      .querySelector<HTMLInputElement>('#password')
      ?.setAttribute('autocomplete', 'new-password')
    runtime.sendSnapshot.mockImplementation(async (message) => {
      expect(message.payload.observations[0]?.fields).toMatchObject({
        currentPasswordFieldCount: 0,
        newPasswordFieldCount: 1,
      })
      return {
        kind: RuntimeMessageDeliveryKind.Delivered,
        response: {
          kind: AuthenticationWorkflowSnapshotResponseKind.NoMatch,
        },
      }
    })
    const act = vi.fn(() => true)

    await expect(
      performRevalidatedAuthenticationAction({
        workflow,
        expectedAction: AuthenticationWorkflowAction.ContinueWithNook,
        observationBinding: {
          kind: AuthenticationObservationBindingKind.Unbound,
        },
        act,
      }),
    ).resolves.toBe(false)
    expect(act).not.toHaveBeenCalled()
  })
})
