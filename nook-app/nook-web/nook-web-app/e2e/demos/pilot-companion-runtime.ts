import {
  isCompanionWasmSessionMessageType,
  type CompanionWasmSessionMessage,
} from '../../../nook-web-shared/src/extension/companion-wasm-runtime-messages'
import { handleCompanionWasmMessage } from '../../../nook-web-extension/src/offscreen/session-companion-wasm-operations'
import { Effect } from 'effect'
import { companionWasmReady } from '../../../nook-web-shared/src/extension/companion-ready'

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
    switch (isCompanionWasmSessionMessageType(message.type)) {
      case false:
        this.sendMessage(message, callback)
        return
      case true:
        this.deliver(message as CompanionWasmSessionMessage, callback)
        return
    }
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
