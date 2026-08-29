import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  AuthenticationWorkflowAction,
  AuthenticationWorkflowKind,
  AuthenticationWorkflowSnapshotResponseKind,
  AuthenticationWorkflowStage,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { summarizeAuthenticationWorkflowForms } from '../../../../nook-web-shared/src/extension/password-forms'

const runtime = vi.hoisted(() => ({
  sendSnapshot: vi.fn(),
}))

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

import { performRevalidatedAuthenticationAction } from '../../../../nook-web-extension/src/content/autofill/workflow-revalidation'

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
    const workflow = summarizeAuthenticationWorkflowForms()[0]
    expect(workflow).toBeDefined()
    if (!workflow) return
    runtime.sendSnapshot.mockImplementation(async () => {
      const form = document.querySelector<HTMLFormElement>('#otp')
      if (form) form.action = '/transfer/confirm'
      return {
        kind: 'delivered',
        response: {
          kind: AuthenticationWorkflowSnapshotResponseKind.Matched,
          snapshot: {
            kind: AuthenticationWorkflowKind.TotpChallenge,
            stage: AuthenticationWorkflowStage.SecondFactor,
            action: AuthenticationWorkflowAction.FillTotp,
            currentStep: 2,
            totalSteps: 3,
            approvalRequirement: 'explicit-user-approval',
            observationIndex: 0,
          },
        },
      }
    })
    const act = vi.fn(() => true)
    const request: Parameters<
      typeof performRevalidatedAuthenticationAction
    >[0] = {
      workflow,
      expectedAction: AuthenticationWorkflowAction.FillTotp,
      act,
    }

    await expect(performRevalidatedAuthenticationAction(request)).resolves.toBe(
      false,
    )
    expect(act).not.toHaveBeenCalled()
  })

  test('acts synchronously after an unchanged current-head decision', async () => {
    document.body.innerHTML = `
      <button type="button" data-nook-passkey-control>Use passkey</button>
    `
    const workflow = summarizeAuthenticationWorkflowForms()[0]
    expect(workflow).toBeDefined()
    if (!workflow) return
    runtime.sendSnapshot.mockResolvedValue({
      kind: 'delivered',
      response: {
        kind: AuthenticationWorkflowSnapshotResponseKind.Matched,
        snapshot: {
          kind: AuthenticationWorkflowKind.Login,
          stage: AuthenticationWorkflowStage.Credentials,
          action: AuthenticationWorkflowAction.UsePasskey,
          currentStep: 1,
          totalSteps: 3,
          approvalRequirement: 'explicit-user-approval',
          observationIndex: 0,
        },
      },
    })
    const act = vi.fn(() => true)
    const request: Parameters<
      typeof performRevalidatedAuthenticationAction
    >[0] = {
      workflow,
      expectedAction: AuthenticationWorkflowAction.UsePasskey,
      act,
    }

    await expect(performRevalidatedAuthenticationAction(request)).resolves.toBe(
      true,
    )
    expect(act).toHaveBeenCalledOnce()
  })

  test('sends current field semantics before allowing credential release', async () => {
    document.body.innerHTML = `
      <form action="/login">
        <input autocomplete="username" />
        <input id="password" type="password" autocomplete="current-password" />
        <button type="submit">Sign in</button>
      </form>
    `
    const workflow = summarizeAuthenticationWorkflowForms()[0]
    expect(workflow).toBeDefined()
    if (!workflow) return
    document
      .querySelector<HTMLInputElement>('#password')
      ?.setAttribute('autocomplete', 'new-password')
    runtime.sendSnapshot.mockImplementation(async (message) => {
      expect(message.payload.observations[0]?.fields).toMatchObject({
        currentPasswordFieldCount: 0,
        newPasswordFieldCount: 1,
      })
      return {
        kind: 'delivered',
        response: {
          kind: AuthenticationWorkflowSnapshotResponseKind.NoMatch,
        },
      }
    })
    const act = vi.fn(() => true)
    const request: Parameters<
      typeof performRevalidatedAuthenticationAction
    >[0] = {
      workflow,
      expectedAction: AuthenticationWorkflowAction.ContinueWithNook,
      act,
    }

    await expect(performRevalidatedAuthenticationAction(request)).resolves.toBe(
      false,
    )
    expect(act).not.toHaveBeenCalled()
  })
})
