import { afterEach, describe, expect, test, vi } from 'vitest'
import type { CompanionWasmRuntimeMessage } from '../../../../nook-web-shared/src/extension/companion-wasm-runtime-messages'
import type { ApprovedAuthenticationWorkflowDecision } from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  AuthenticationWorkflowClassification,
  LiveApprovedAuthenticationWorkflow,
  LiveAuthenticationWorkflowDisposition,
} from '../../../../nook-web-shared/src/extension/password-form-classified-observations'
import { passwordFormInteraction as forms } from '../../../../nook-web-shared/src/extension/password-forms'

afterEach(() => {
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

describe('authentication workflow live revalidation', () => {
  test('fails closed through the extension session when the approved workflow disappears', async () => {
    document.body.innerHTML = `
      <form method="post" id="login" action="/login">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
        <button type="submit">Sign in</button>
      </form>
    `
    const observation = forms.summarizeAuthenticationWorkflowForms()[0]
    if (!observation) throw new Error('expected an authentication workflow')
    const approved = new AuthenticationWorkflowClassification({
      workflowForms: [observation],
      authenticatorSetupHint: false,
      backupCodesHint: false,
    }).observations[0]
    if (!approved) throw new Error('expected an approved workflow')
    document.body.replaceChildren()
    type RevalidationResponse = {
      readonly ok: true
      readonly result: {
        readonly revalidationDecision: ApprovedAuthenticationWorkflowDecision
      }
    }
    const response: RevalidationResponse = {
      ok: true,
      result: { revalidationDecision: { kind: 'rejected' } },
    }
    const sendMessage = vi.fn(
      (
        message: CompanionWasmRuntimeMessage,
        callback: (response: RevalidationResponse) => void,
      ) => {
        expect(message.type).toBe(
          'nook:extension-session-revalidate-approved-authentication-workflow',
        )
        callback(response)
      },
    )
    vi.stubGlobal('chrome', {
      runtime: { id: 'test-extension', sendMessage, lastError: false },
    })

    await expect(
      new LiveApprovedAuthenticationWorkflow({
        approved,
        authenticatorSetupHint: false,
        backupCodesHint: false,
      }).extensionDisposition(globalThis),
    ).resolves.toBe(LiveAuthenticationWorkflowDisposition.Changed)
    expect(sendMessage).toHaveBeenCalledOnce()
  })
})
