import { Effect } from 'effect'
import type { LoginPickerPageVerification } from '../../lib/inline-login-picker'
import { LiveAuthenticationWorkflowDisposition } from '../../../../nook-web-shared/src/extension/password-form-classified-observations'
import { LoginPickerKind, pickerState } from './state'
import { authenticationWorkflowUi } from './authentication-workflow-ui-state'

type RuntimeMessageListener = Parameters<
  typeof chrome.runtime.onMessage.addListener
>[0]
interface LoginPickerVerificationDelivery {
  readonly message: LoginPickerPageVerification
  readonly sender: chrome.runtime.MessageSender
  readonly sendResponse: Parameters<RuntimeMessageListener>[2]
}

/** Verifies the original requesting document and its approved workflow, including subframes. */
export class LoginPickerPageVerificationReceiver {
  receive(delivery: LoginPickerVerificationDelivery): boolean {
    switch (
      delivery.sender.id === chrome.runtime.id &&
      delivery.message.origin === location.origin
    ) {
      case false:
        return false
      case true:
        break
    }
    switch (pickerState.login.kind) {
      case LoginPickerKind.Closed:
        return false
      case LoginPickerKind.Open: {
        const pending = pickerState.login.request
        switch (pending.requestId === delivery.message.requestId) {
          case false:
            return false
          case true:
            break
        }
        const verification = Effect.promise(() =>
          authenticationWorkflowUi.approvedWorkflowDisposition(
            pending.workflow,
          ),
        ).pipe(
          Effect.map((disposition) => {
            const response: Parameters<typeof delivery.sendResponse>[0] = {
              ok:
                disposition === LiveAuthenticationWorkflowDisposition.Current &&
                pickerState.login.kind === LoginPickerKind.Open &&
                pickerState.login.request.requestId === pending.requestId,
            }
            delivery.sendResponse(response)
          }),
        )
        void Effect.runPromise(verification)
        return true
      }
    }
  }
}
