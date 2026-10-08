import { Effect } from 'effect'
import { err, ok } from 'neverthrow'
import type {
  NookVaultManager,
  NookFocusedLoginFillCredential,
} from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import { ExtensionSessionMessageType } from '../lib/extension-session-message-type'
import type { WebsiteFocusedLoginFillResponse } from '../lib/focused-login-fill-messages'
import type { ExtensionSessionRequest } from './session-request-adapter'
import { extensionVaultGrant } from './session-vault-grant'
import { openPasskeyVault } from './session-vault-operations'

type FocusedRevealRequest = {
  readonly message: Extract<
    ExtensionSessionRequest,
    { type: typeof ExtensionSessionMessageType.RevealFocusedLogin }
  >
  readonly getManager: () => Promise<NookVaultManager>
}

/** Owns one admitted vault request and the lifetime of its single returned credential. */
export class FocusedLoginRevealOperation {
  constructor(private readonly request: FocusedRevealRequest) {}

  private reveal(activeManager: NookVaultManager) {
    const payload = this.request.message.payload
    const request: Parameters<
      NookVaultManager['reveal_website_login_for_focused_fill']
    >[0] = {
      secret_id: payload.secretId,
      origin: payload.origin,
      credential: payload.credential,
    }
    return Effect.tryPromise(() =>
      activeManager.reveal_website_login_for_focused_fill(request),
    )
  }

  private consume(credential: NookFocusedLoginFillCredential) {
    try {
      const response: WebsiteFocusedLoginFillResponse = {
        ok: true,
        value: credential.value,
      }
      return ok(response)
    } finally {
      credential.free()
    }
  }

  run() {
    const generatorContext: FocusedLoginRevealOperationGeneratorContext = {
      self: this,
    }
    return Effect.runPromise(
      Effect.gen(generatorContext, function* () {
        const activeManager = yield* Effect.tryPromise(this.request.getManager)
        const admissionRequest: Parameters<typeof openPasskeyVault>[0] = {
          activeManager,
          grant: extensionVaultGrant(this.request.message.payload),
        }
        const admission = yield* Effect.tryPromise(() =>
          openPasskeyVault(admissionRequest),
        )
        switch (true) {
          case admission.isErr():
            return err(admission.error)
          case true:
            break
        }
        const credential = yield* this.reveal(activeManager)
        return this.consume(credential)
      }),
    )
  }
}

type FocusedLoginRevealOperationGeneratorContext = {
  readonly self: FocusedLoginRevealOperation
}
