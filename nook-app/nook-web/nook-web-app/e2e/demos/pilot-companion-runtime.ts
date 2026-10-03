import {
  isCompanionWasmSessionMessageType,
  type CompanionWasmSessionMessage,
} from '../../../nook-web-shared/src/extension/companion-wasm-runtime-messages'
import { handleCompanionWasmMessage } from '../../../nook-web-extension/src/offscreen/session-companion-wasm-operations'
import { Effect } from 'effect'
import { companionWasmReady } from '../../../nook-web-shared/src/extension/companion-ready'
import {
  decode_authentication_workflow_runtime_response,
  authentication_workflow_pilot_presentation_capability,
  bind_authentication_page_observation_facts,
  saved_login_action_available,
} from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm'
import type { AuthenticationWorkflowRoutingResponse } from '../../../nook-web-extension/src/background/service-worker/authentication-workflow-routing'

type DemoRuntimeMessage = { readonly type: string }
type DemoRuntimeCallback = (response: object) => void

/** UI demos use the owning Rust adapter; production E2E loads the real extension. */
class PilotCompanionDemoRuntime {
  private readonly sendMessage = chrome.runtime.sendMessage.bind(chrome.runtime)

  install(): void {
    Effect.runFork(
      Effect.tryPromise(() => companionWasmReady).pipe(
        Effect.catchAll((error) =>
          Effect.sync(() =>
            console.error(
              'Pilot demo companion readiness rejected',
              String(error.cause),
            ),
          ),
        ),
      ),
    )
    Reflect.set(chrome.runtime, 'sendMessage', this.dispatch.bind(this))
  }

  private dispatch(
    message: DemoRuntimeMessage,
    callback: DemoRuntimeCallback,
  ): void {
    if (message.type === 'nook:authentication-workflow-snapshot') {
      this.sendMessage(
        message,
        (response: AuthenticationWorkflowRoutingResponse) => {
          this.projectWorkflowResponse(response, callback)
        },
      )
      return
    }
    switch (isCompanionWasmSessionMessageType(message.type)) {
      case false:
        this.sendMessage(message, callback)
        return
      case true:
        this.deliver(message as CompanionWasmSessionMessage, callback)
        return
    }
  }

  private projectWorkflowResponse(
    response: AuthenticationWorkflowRoutingResponse,
    callback: DemoRuntimeCallback,
  ): void {
    Effect.runFork(
      Effect.promise(async () => {
        await companionWasmReady
        const decoded =
          decode_authentication_workflow_runtime_response(response)
        if (
          !('snapshot' in decoded.workflow) ||
          decoded.selectedFacts.state !== 'selected'
        ) {
          callback(response)
          return
        }
        const snapshot = decoded.workflow.snapshot
        const bindingRequest: Parameters<
          typeof bind_authentication_page_observation_facts
        >[0] = {
          observations: [decoded.selectedFacts.facts],
        }
        const actionRequest: Parameters<
          typeof saved_login_action_available
        >[0] = {
          action: snapshot.action,
          loginMatches: decoded.loginMatches,
        }
        const projected: AuthenticationWorkflowRoutingResponse = {
          ...response,
          pilotCapability:
            authentication_workflow_pilot_presentation_capability(snapshot),
          factsBindingToken:
            bind_authentication_page_observation_facts(bindingRequest),
          savedLoginActionAvailable:
            saved_login_action_available(actionRequest),
        }
        callback(projected)
      }),
    )
  }

  private deliver(
    message: CompanionWasmSessionMessage,
    callback: DemoRuntimeCallback,
  ): void {
    Effect.runFork(
      Effect.promise(() => handleCompanionWasmMessage(message)).pipe(
        Effect.map((result) =>
          result.match(
            (value) => callback({ ok: true, result: value }),
            (failure) => {
              console.error(
                'Pilot demo companion operation rejected',
                message.type,
                failure.kind,
              )
              callback({ ok: false })
            },
          ),
        ),
      ),
    )
  }
}

new PilotCompanionDemoRuntime().install()
