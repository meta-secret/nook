import { Effect, Schema } from 'effect'
import {
  OpenSimpleVaultMessageType,
  type OpenSimpleVaultMessage,
} from '../../../../nook-web-shared/src/extension/lifecycle-runtime-messages'
import type { BrowserRuntimeMessageValue } from '../../lib/browser-runtime-message'
import { BROWSER_MESSAGE_KEYS } from '../../lib/browser-message-keys'
import { workflowUi } from './workflow-ui'

type PilotVaultOpeningSurface = {
  readonly button: HTMLButtonElement
  readonly description: HTMLParagraphElement
}

/** Opens the configured Simple Vault through the existing background route. */
export class PilotVaultOpening {
  private static readonly acknowledgementFields = { ok: Schema.Literal(true) }
  private static readonly acknowledgement = Schema.Struct(
    PilotVaultOpening.acknowledgementFields,
  )
  private static readonly message: OpenSimpleVaultMessage = {
    type: OpenSimpleVaultMessageType.NookOpenSimpleVault,
  }

  constructor(private readonly surface: PilotVaultOpeningSurface) {}

  activate(): void {
    if (this.surface.button.disabled) return
    this.surface.button.disabled = true
    this.surface.button.setAttribute('aria-busy', 'true')
    const opening = Effect.tryPromise(() =>
      chrome.runtime.sendMessage<
        OpenSimpleVaultMessage,
        BrowserRuntimeMessageValue
      >(PilotVaultOpening.message),
    ).pipe(
      Effect.flatMap(
        Schema.decodeUnknownEffect(PilotVaultOpening.acknowledgement),
      ),
      Effect.match({
        onFailure: () => {
          this.surface.description.textContent = workflowUi.translatedMessage(
            BROWSER_MESSAGE_KEYS.WidgetOpenNookFailed,
          )
          this.surface.description.setAttribute('role', 'alert')
        },
        onSuccess: () => {
          this.surface.description.textContent = workflowUi.translatedMessage(
            BROWSER_MESSAGE_KEYS.WidgetLoginNoMatchDescription,
          )
          this.surface.description.removeAttribute('role')
        },
      }),
      Effect.ensuring(
        Effect.sync(() => {
          this.surface.button.disabled = false
          this.surface.button.removeAttribute('aria-busy')
        }),
      ),
    )
    void Effect.runPromise(opening)
  }
}
