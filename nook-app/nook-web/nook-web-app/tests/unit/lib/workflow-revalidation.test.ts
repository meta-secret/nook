import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  AuthenticationWorkflowAction,
  AuthenticationWorkflowKind,
  AuthenticationWorkflowSnapshotResponseKind,
  AuthenticationWorkflowStage,
  type AuthenticationApprovalRequirement,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  PasswordFormScopeKind,
  summarizeAuthenticationWorkflowForms,
  type PasswordFormObservation,
} from '../../../../nook-web-shared/src/extension/password-forms'
import type { AuthenticationWorkflowSnapshotMessage } from '../../../../nook-web-extension/src/lib/auth-workflow-messages'

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
  RevalidatedAuthenticationActionOutcomeKind,
  RevalidatedAuthenticationActResultKind,
  type AuthenticationObservationBinding,
} from '../../../../nook-web-extension/src/content/autofill/workflow-revalidation'

const explicitUserApproval =
  'explicit-user-approval' satisfies AuthenticationApprovalRequirement

function firstWorkflow(): PasswordFormObservation {
  const workflow = summarizeAuthenticationWorkflowForms()[0]
  if (!workflow) throw new Error('expected an authentication workflow')
  return workflow
}

function matchedDelivery(
  action: AuthenticationWorkflowAction,
  observationIndex = 0,
) {
  return {
    kind: RuntimeMessageDeliveryKind.Delivered,
    response: {
      verdict: {
        kind: AuthenticationWorkflowSnapshotResponseKind.Matched,
        snapshot: {
          kind: AuthenticationWorkflowKind.Login,
          stage: AuthenticationWorkflowStage.Credentials,
          action,
          currentStep: 1,
          totalSteps: 3,
          approvalRequirement: explicitUserApproval,
          observationIndex,
        },
      },
      loginMatches: [],
    },
  }
}

function enrichedMatchedDelivery(
  message: AuthenticationWorkflowSnapshotMessage,
  action: AuthenticationWorkflowAction,
) {
  const selectedFacts = message.payload.observations[0]
  if (!selectedFacts) throw new Error('expected selected workflow facts')
  const delivery = matchedDelivery(action)
  return {
    ...delivery,
    response: {
      ...delivery.response,
      selectedFacts: {
        ...selectedFacts,
        authenticator: {
          ...selectedFacts.authenticator,
          passkeyAccountAvailability: 'ready' as const,
        },
      },
    },
  }
}

afterEach(() => {
  document.body.replaceChildren()
  runtime.sendSnapshot.mockReset()
})

describe('credential-bearing workflow revalidation', () => {
  test.each([
    {
      flow: 'saved-login',
      action: AuthenticationWorkflowAction.ContinueWithNook,
      markup: `<form action="/login"><input autocomplete="username" /><input type="password" autocomplete="current-password" /><button type="submit">Sign in</button></form>`,
    },
    {
      flow: 'authenticator',
      action: AuthenticationWorkflowAction.FillTotp,
      markup: `<form action="/login/mfa"><input autocomplete="one-time-code" /><button type="submit">Verify code</button></form>`,
    },
  ])(
    'preserves an enriched binding across two-stage $flow authorization',
    async ({ action, markup }) => {
      document.body.innerHTML = markup
      const workflow = firstWorkflow()
      runtime.sendSnapshot.mockImplementation(
        async (message: AuthenticationWorkflowSnapshotMessage) =>
          enrichedMatchedDelivery(message, action),
      )
      const releaseState: { binding: AuthenticationObservationBinding } = {
        binding: { kind: AuthenticationObservationBindingKind.Unbound },
      }

      await expect(
        performRevalidatedAuthenticationAction({
          workflow,
          expectedAction: action,
          observationBinding: {
            kind: AuthenticationObservationBindingKind.Unbound,
          },
          approvalIsActive: () => true,
          act: ({ observationBindingToken }) => {
            releaseState.binding = {
              kind: AuthenticationObservationBindingKind.Required,
              token: observationBindingToken,
            }
            return { kind: RevalidatedAuthenticationActResultKind.Acted }
          },
        }),
      ).resolves.toEqual({
        kind: RevalidatedAuthenticationActionOutcomeKind.Acted,
      })
      if (
        releaseState.binding.kind !==
        AuthenticationObservationBindingKind.Required
      ) {
        throw new Error('expected an enriched binding token')
      }
      const stagedAct = vi.fn(() => ({
        kind: RevalidatedAuthenticationActResultKind.Acted,
      }))

      await expect(
        performRevalidatedAuthenticationAction({
          workflow,
          expectedAction: action,
          observationBinding: releaseState.binding,
          approvalIsActive: () => true,
          act: stagedAct,
        }),
      ).resolves.toEqual({
        kind: RevalidatedAuthenticationActionOutcomeKind.Acted,
      })
      expect(stagedAct).toHaveBeenCalledOnce()
    },
  )

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
          verdict: {
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
          loginMatches: [],
        },
      }
    })
    const act = vi.fn(() => ({
      kind: RevalidatedAuthenticationActResultKind.Acted,
    }))

    await expect(
      performRevalidatedAuthenticationAction({
        workflow,
        expectedAction: AuthenticationWorkflowAction.FillTotp,
        observationBinding: {
          kind: AuthenticationObservationBindingKind.Unbound,
        },
        approvalIsActive: () => true,
        act,
      }),
    ).resolves.toEqual({
      kind: RevalidatedAuthenticationActionOutcomeKind.Rejected,
    })
    expect(act).not.toHaveBeenCalled()
  })

  test('refuses actuation after the observed workflow root is detached', async () => {
    const root = document.createElement('section')
    root.innerHTML = `
      <input autocomplete="one-time-code" />
      <button type="button">Verify code</button>
    `
    document.body.append(root)
    const workflow: PasswordFormObservation = {
      root,
      formScope: { kind: PasswordFormScopeKind.Unowned },
      summary: {
        usernameFieldCount: 0,
        passwordFieldCount: 0,
        currentPasswordFieldCount: 0,
        newPasswordFieldCount: 0,
        genericPasswordFieldCount: 0,
        oneTimeCodeFieldCount: 1,
        manualCheckpointPresent: false,
        passkeyControlPresent: false,
        formCount: 0,
        observedAt: Date.now(),
      },
    }
    runtime.sendSnapshot.mockImplementation(async () => {
      root.remove()
      return {
        kind: RuntimeMessageDeliveryKind.Delivered,
        response: {
          verdict: {
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
          loginMatches: [],
        },
      }
    })
    const act = vi.fn(() => ({
      kind: RevalidatedAuthenticationActResultKind.Acted,
    }))

    await expect(
      performRevalidatedAuthenticationAction({
        workflow,
        expectedAction: AuthenticationWorkflowAction.FillTotp,
        observationBinding: {
          kind: AuthenticationObservationBindingKind.Unbound,
        },
        approvalIsActive: () => true,
        act,
      }),
    ).resolves.toEqual({
      kind: RevalidatedAuthenticationActionOutcomeKind.Rejected,
    })
    expect(act).not.toHaveBeenCalled()
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
        verdict: {
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
        loginMatches: [],
      },
    })
    let observationBindingToken = ''
    await performRevalidatedAuthenticationAction({
      workflow,
      expectedAction: AuthenticationWorkflowAction.ContinueWithNook,
      observationBinding: {
        kind: AuthenticationObservationBindingKind.Unbound,
      },
      approvalIsActive: () => true,
      act: ({ observationBindingToken: approvedToken }) => {
        observationBindingToken = approvedToken
        return { kind: RevalidatedAuthenticationActResultKind.Acted }
      },
    })
    document
      .querySelector<HTMLFormElement>('#login')
      ?.setAttribute('action', '/different-safe-login')
    const act = vi.fn(() => ({
      kind: RevalidatedAuthenticationActResultKind.Acted,
    }))

    await expect(
      performRevalidatedAuthenticationAction({
        workflow,
        expectedAction: AuthenticationWorkflowAction.ContinueWithNook,
        observationBinding: {
          kind: AuthenticationObservationBindingKind.Required,
          token: observationBindingToken,
        },
        approvalIsActive: () => true,
        act,
      }),
    ).resolves.toEqual({
      kind: RevalidatedAuthenticationActionOutcomeKind.Rejected,
    })
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
    runtime.sendSnapshot.mockImplementation(
      async (message: AuthenticationWorkflowSnapshotMessage) => {
        expect(message.payload.observations[0]?.fields).toMatchObject({
          currentPasswordFieldCount: 0,
          newPasswordFieldCount: 1,
        })
        return {
          kind: RuntimeMessageDeliveryKind.Delivered,
          response: {
            verdict: {
              kind: AuthenticationWorkflowSnapshotResponseKind.NoMatch,
            },
            loginMatches: [],
          },
        }
      },
    )
    const act = vi.fn(() => ({
      kind: RevalidatedAuthenticationActResultKind.Acted,
    }))

    await expect(
      performRevalidatedAuthenticationAction({
        workflow,
        expectedAction: AuthenticationWorkflowAction.ContinueWithNook,
        observationBinding: {
          kind: AuthenticationObservationBindingKind.Unbound,
        },
        approvalIsActive: () => true,
        act,
      }),
    ).resolves.toEqual({
      kind: RevalidatedAuthenticationActionOutcomeKind.Rejected,
    })
    expect(act).not.toHaveBeenCalled()
  })

  test('refuses actuation when approval is withdrawn during the snapshot await', async () => {
    document.body.innerHTML = `
      <form action="/login" method="post">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
        <button type="submit">Sign in</button>
      </form>
    `
    const workflow = firstWorkflow()
    let approvalIsActive = true
    runtime.sendSnapshot.mockImplementation(async () => {
      approvalIsActive = false
      return matchedDelivery(AuthenticationWorkflowAction.ContinueWithNook)
    })
    const act = vi.fn(() => ({
      kind: RevalidatedAuthenticationActResultKind.Acted,
    }))

    await expect(
      performRevalidatedAuthenticationAction({
        workflow,
        expectedAction: AuthenticationWorkflowAction.ContinueWithNook,
        observationBinding: {
          kind: AuthenticationObservationBindingKind.Unbound,
        },
        approvalIsActive: () => approvalIsActive,
        act,
      }),
    ).resolves.toEqual({
      kind: RevalidatedAuthenticationActionOutcomeKind.Rejected,
    })
    expect(act).not.toHaveBeenCalled()
  })

  test('refuses equivalent replacement controls after approval', async () => {
    document.body.innerHTML = `
      <form id="login" action="/login" method="post">
        <input autocomplete="username" />
        <input id="password" type="password" autocomplete="current-password" />
      </form>
      <button id="submit" form="login" type="submit">Sign in</button>
    `
    const workflow = firstWorkflow()
    runtime.sendSnapshot.mockImplementation(async () => {
      const submit = document.querySelector<HTMLButtonElement>('#submit')
      if (submit) submit.replaceWith(submit.cloneNode(true))
      return matchedDelivery(AuthenticationWorkflowAction.ContinueWithNook)
    })
    const act = vi.fn(() => ({
      kind: RevalidatedAuthenticationActResultKind.Acted,
    }))

    await expect(
      performRevalidatedAuthenticationAction({
        workflow,
        expectedAction: AuthenticationWorkflowAction.ContinueWithNook,
        observationBinding: {
          kind: AuthenticationObservationBindingKind.Unbound,
        },
        approvalIsActive: () => true,
        act,
      }),
    ).resolves.toEqual({
      kind: RevalidatedAuthenticationActionOutcomeKind.Rejected,
    })
    expect(act).not.toHaveBeenCalled()
  })

  test('requires the bound workflow to remain selected from every current candidate', async () => {
    document.body.innerHTML = `
      <form action="/login" method="post">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
        <button type="submit">Sign in</button>
      </form>
    `
    const workflow = firstWorkflow()
    document.body.insertAdjacentHTML(
      'beforeend',
      `<form action="/login/mfa" method="post">
        <input autocomplete="one-time-code" />
        <button type="submit">Verify code</button>
      </form>`,
    )
    runtime.sendSnapshot.mockImplementation(
      async (message: AuthenticationWorkflowSnapshotMessage) => {
        expect(message.payload.observations).toHaveLength(2)
        const otpIndex = message.payload.observations.findIndex(
          (facts) => facts.fields.oneTimeCodeFieldCount === 1,
        )
        expect(otpIndex).toBeGreaterThanOrEqual(0)
        return matchedDelivery(AuthenticationWorkflowAction.FillTotp, otpIndex)
      },
    )
    const act = vi.fn(() => ({
      kind: RevalidatedAuthenticationActResultKind.Acted,
    }))

    await expect(
      performRevalidatedAuthenticationAction({
        workflow,
        expectedAction: AuthenticationWorkflowAction.ContinueWithNook,
        observationBinding: {
          kind: AuthenticationObservationBindingKind.Unbound,
        },
        approvalIsActive: () => true,
        act,
      }),
    ).resolves.toEqual({
      kind: RevalidatedAuthenticationActionOutcomeKind.Rejected,
    })
    expect(act).not.toHaveBeenCalled()
  })

  test('binds readonly state and the effective submission method', async () => {
    document.body.innerHTML = `
      <form id="login" action="/login" method="post">
        <input autocomplete="username" />
        <input id="password" type="password" autocomplete="current-password" />
        <button type="submit">Sign in</button>
      </form>
    `
    const workflow = firstWorkflow()
    runtime.sendSnapshot.mockResolvedValue(
      matchedDelivery(AuthenticationWorkflowAction.ContinueWithNook),
    )
    let token = ''
    await performRevalidatedAuthenticationAction({
      workflow,
      expectedAction: AuthenticationWorkflowAction.ContinueWithNook,
      observationBinding: {
        kind: AuthenticationObservationBindingKind.Unbound,
      },
      approvalIsActive: () => true,
      act: ({ observationBindingToken }) => {
        token = observationBindingToken
        return { kind: RevalidatedAuthenticationActResultKind.Acted }
      },
    })
    const password = document.querySelector<HTMLInputElement>('#password')
    const form = document.querySelector<HTMLFormElement>('#login')
    if (!password || !form) throw new Error('expected login controls')
    const act = vi.fn(() => ({
      kind: RevalidatedAuthenticationActResultKind.Acted,
    }))
    const requiredBinding = {
      kind: AuthenticationObservationBindingKind.Required,
      token,
    } as const

    password.readOnly = true
    await expect(
      performRevalidatedAuthenticationAction({
        workflow,
        expectedAction: AuthenticationWorkflowAction.ContinueWithNook,
        observationBinding: requiredBinding,
        approvalIsActive: () => true,
        act,
      }),
    ).resolves.toEqual({
      kind: RevalidatedAuthenticationActionOutcomeKind.Rejected,
    })
    password.readOnly = false
    form.method = 'get'
    await expect(
      performRevalidatedAuthenticationAction({
        workflow,
        expectedAction: AuthenticationWorkflowAction.ContinueWithNook,
        observationBinding: requiredBinding,
        approvalIsActive: () => true,
        act,
      }),
    ).resolves.toEqual({
      kind: RevalidatedAuthenticationActionOutcomeKind.Rejected,
    })
    expect(act).not.toHaveBeenCalled()
  })
})
