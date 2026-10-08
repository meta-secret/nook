import { Effect } from 'effect'
import {
  WebsiteFocusedLoginRevealMessage,
  type WebsiteFocusedLoginFillResponse,
} from '../../lib/focused-login-fill-messages'
import {
  accountPickerAuthorizationIsCurrent,
  accountPickerSessions,
} from './account-pickers'
import { extensionPairingIdentity } from './pairing-identity'
import { websiteFocusedLoginRevealSessionRequest } from './session-request-projections'
import type { StoredExtensionPairingGrant } from '../pairing-grants'
import type { ExtensionSessionTransportResult } from './session-document'
import type { ExtensionSessionResponse } from '../../offscreen/session'
import type { ExtensionSessionTransportRequest } from '../../offscreen/session-request-adapter'

type FocusedWebsiteLoginFillRequest = {
  readonly message: WebsiteFocusedLoginRevealMessage
  readonly sender: chrome.runtime.MessageSender
}
export type FocusedWebsiteLoginFillDependencies = {
  readonly generationIsCurrent: typeof accountPickerAuthorizationIsCurrent
  readonly authorizedWebsiteGrant: typeof accountPickerSessions.authorizedWebsiteGrant
  readonly sendSessionMessage: (
    message: ExtensionSessionTransportRequest,
  ) => Promise<ExtensionSessionTransportResult<ExtensionSessionResponse>>
}
enum FocusedReleaseAuthorization {
  Current = 'current',
  Revoked = 'revoked',
}
type FocusedWebsiteLoginFillConfiguration = {
  readonly request: FocusedWebsiteLoginFillRequest
  readonly dependencies: FocusedWebsiteLoginFillDependencies
}

/** Owns sender-origin/grant admission, picker generation, and one-value response cleanup. */
export class FocusedWebsiteLoginFillOperation {
  private readonly locked: WebsiteFocusedLoginFillResponse = {
    ok: false,
    reason: 'login-locked',
  }
  private readonly failed: WebsiteFocusedLoginFillResponse = {
    ok: false,
    reason: 'login-fill-failed',
  }

  private readonly request: FocusedWebsiteLoginFillRequest
  private readonly dependencies: FocusedWebsiteLoginFillDependencies
  constructor(configuration: FocusedWebsiteLoginFillConfiguration) {
    this.request = configuration.request
    this.dependencies = configuration.dependencies
  }

  private authorization(): FocusedReleaseAuthorization {
    switch (
      this.dependencies.generationIsCurrent(
        this.request.message.payload.authorizationGeneration,
      )
    ) {
      case true:
        return FocusedReleaseAuthorization.Current
      case false:
        return FocusedReleaseAuthorization.Revoked
    }
  }

  private clearValue(response: WebsiteFocusedLoginFillResponse): void {
    switch (response.ok) {
      case true:
        response.value = ''
        break
      case false:
        break
    }
  }

  private finish(
    response: WebsiteFocusedLoginFillResponse,
  ): WebsiteFocusedLoginFillResponse {
    switch (this.authorization()) {
      case FocusedReleaseAuthorization.Current:
        return response
      case FocusedReleaseAuthorization.Revoked:
        this.clearValue(response)
        return this.locked
    }
  }

  private decode(
    delivery: ExtensionSessionTransportResult<ExtensionSessionResponse>,
  ) {
    return delivery.match(
      (value) => WebsiteFocusedLoginRevealMessage.decodeResponse(value),
      (error) => Effect.succeed(error.response),
    )
  }

  private release(grant: StoredExtensionPairingGrant) {
    const execution1: { readonly self: FocusedWebsiteLoginFillOperation } = {
      self: this,
    }
    return Effect.gen(execution1, function* () {
      switch (this.authorization()) {
        case FocusedReleaseAuthorization.Revoked:
          return this.locked
        case FocusedReleaseAuthorization.Current:
          break
      }
      const request: Parameters<
        typeof websiteFocusedLoginRevealSessionRequest
      >[0] = {
        grant,
        origin: this.request.message.payload.origin,
        secretId: this.request.message.payload.secretId,
        credential: this.request.message.payload.credential,
      }
      const message = websiteFocusedLoginRevealSessionRequest(request)
      const delivery = yield* Effect.tryPromise(() =>
        this.dependencies.sendSessionMessage(message),
      )
      const response: WebsiteFocusedLoginFillResponse =
        yield* this.decode(delivery)
      return this.finish(response)
    })
  }

  run(): Promise<WebsiteFocusedLoginFillResponse> {
    const execution2: { readonly self: FocusedWebsiteLoginFillOperation } = {
      self: this,
    }
    return Effect.runPromise(
      Effect.gen(execution2, function* () {
        switch (this.authorization()) {
          case FocusedReleaseAuthorization.Revoked:
            return this.locked
          case FocusedReleaseAuthorization.Current:
            break
        }
        const request: Parameters<
          typeof accountPickerSessions.authorizedWebsiteGrant
        >[0] = {
          origin: this.request.message.payload.origin,
          vaultStoreId: this.request.message.payload.vaultStoreId,
          sender: this.request.sender,
          reasons: {
            forbidden: 'login-forbidden-origin',
            missing: 'login-vault-not-granted',
            locked: 'login-locked',
          },
        }
        const access = yield* Effect.tryPromise(() =>
          this.dependencies.authorizedWebsiteGrant(request),
        )
        switch (true) {
          case 'response' in access:
            return access.response
          case 'grant' in access:
            return yield* this.release(access.grant)
          case true:
            return this.failed
        }
        return this.failed
      }).pipe(Effect.catch(() => Effect.succeed(this.failed))),
    )
  }
}
export const focusedWebsiteLoginFillDependencies: FocusedWebsiteLoginFillDependencies =
  {
    generationIsCurrent: accountPickerAuthorizationIsCurrent,
    authorizedWebsiteGrant: accountPickerSessions.authorizedWebsiteGrant.bind(
      accountPickerSessions,
    ),
    sendSessionMessage: extensionPairingIdentity.sendSessionMessage.bind(
      extensionPairingIdentity,
    ),
  }
