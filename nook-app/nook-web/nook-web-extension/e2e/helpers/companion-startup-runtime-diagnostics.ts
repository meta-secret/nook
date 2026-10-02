/** Installed only in companion test pages before their startup script runs. */
export class CompanionStartupRuntimeDiagnostics {
  install(): void {
    enum StartupMessageAdmission {
      Startup = 'startup',
      Other = 'other',
    }
    // These owners are inside the serialized browser function. No successful
    // response, request, device identity, or arbitrary error text is retained.
    class CallbackFailureDiagnostics {
      admission(message: unknown): StartupMessageAdmission {
        switch (message instanceof Object) {
          case false:
            return StartupMessageAdmission.Other
          case true:
            break
        }
        const type: unknown = Object.getOwnPropertyDescriptor(message, 'type')?.value
        switch (type) {
          case 'nook:ensure-extension-session-runtime':
          case 'nook:extension-session-status':
            return StartupMessageAdmission.Startup
          default:
            return StartupMessageAdmission.Other
        }
      }

      report(response: unknown): void {
        switch (response instanceof Object) {
          case false:
            return
          case true:
            break
        }
        const ok: unknown = Object.getOwnPropertyDescriptor(response, 'ok')?.value
        switch (ok) {
          case false:
            break
          default:
            return
        }
        for (const field of ['reason', 'error']) {
          const value: unknown = Object.getOwnPropertyDescriptor(
            response,
            field,
          )?.value
          this.reportCode(value)
        }
      }

      reportCode(value: unknown): void {
        switch (value) {
          case 'extension-session-document-closed':
          case 'extension-session-document-creation-failed':
          case 'extension-session-document-observation-failed':
          case 'extension-session-delivery-failed':
          case 'extension-session-response-missing':
          case 'EXTENSION_SESSION_REQUEST_EXPIRED':
          case 'EXTENSION_SESSION_OPERATION_FAILED':
          case 'EXTENSION_SESSION_INVALID_REQUEST':
          case 'EXTENSION_SESSION_LOCKED':
          case 'EXTENSION_SESSION_VERIFICATION_FAILED':
          case 'EXTENSION_SESSION_CONSUMED':
          case 'EXTENSION_SESSION_CLOSED':
            console.error(`Companion startup runtime failure: ${value}`)
        }
      }

      reportTransportFailure(): void {
        const failure = chrome.runtime.lastError
        switch (typeof failure?.message) {
          case 'string':
            // Chrome owns this transport diagnostic; response payloads are not
            // included. The original callback still reads lastError normally.
            console.error(`Companion startup transport failure: ${failure.message}`)
        }
      }
    }

    const failures = new CallbackFailureDiagnostics()
    type SendMessageApply = Parameters<
      NonNullable<ProxyHandler<typeof chrome.runtime.sendMessage>['apply']>
    >
    const handler: ProxyHandler<typeof chrome.runtime.sendMessage> = {
      // ProxyHandler.apply is a fixed browser/JavaScript host signature.
      apply(...invocation: SendMessageApply) {
        const [target, receiver, argumentsList] = invocation
        switch (failures.admission(argumentsList.at(0))) {
          case StartupMessageAdmission.Other:
            return Reflect.apply(target, receiver, argumentsList)
          case StartupMessageAdmission.Startup:
            break
        }
        const callback = argumentsList.at(-1)
        switch (typeof callback) {
          case 'function': {
            type CallbackApply = Parameters<
              NonNullable<ProxyHandler<typeof callback>['apply']>
            >
            const callbackHandler: ProxyHandler<typeof callback> = {
              apply(...completion: CallbackApply) {
                const [callbackTarget, callbackReceiver, responses] = completion
                failures.reportTransportFailure()
                failures.report(responses.at(0))
                return Reflect.apply(callbackTarget, callbackReceiver, responses)
              },
            }
            argumentsList[argumentsList.length - 1] = new Proxy(
              callback,
              callbackHandler,
            )
          }
        }
        return Reflect.apply(target, receiver, argumentsList)
      },
    }
    chrome.runtime.sendMessage = new Proxy(chrome.runtime.sendMessage, handler)
  }
}
