import { Effect } from 'effect'
import {
  WebsiteFocusedLoginRevealMessage,
  WebsiteFocusedLoginRevealMessageType,
  type WebsiteFocusedLoginFillResponse,
} from '../../lib/focused-login-fill-messages'
import type { FocusedWebsiteLoginFillOperation } from './focused-login-operations'
import {
  RuntimeMessageResponseChannel,
  RuntimeMessageRouteKind,
  type BackgroundRuntimeMessageRoute,
  type BackgroundRuntimeMessageRoutingRequest,
  type RuntimeMessageRouteOutcome,
} from './schema-runtime-message-route'

type FocusedLoginMessageOperationRequest = ConstructorParameters<
  typeof FocusedWebsiteLoginFillOperation
>[0]['request']

type FocusedLoginMessageRouteRequest = {
  readonly operation: (
    request: FocusedLoginMessageOperationRequest,
  ) => Promise<WebsiteFocusedLoginFillResponse>
}

/** Keeps the Chrome response channel open while Rust selector admission becomes ready. */
export class FocusedLoginMessageRoute implements BackgroundRuntimeMessageRoute {
  private readonly generatorContext: FocusedLoginMessageRouteGeneratorContext =
    {
      self: this,
    }
  private readonly failed: WebsiteFocusedLoginFillResponse = {
    ok: false,
    reason: 'login-fill-failed',
  }

  constructor(private readonly request: FocusedLoginMessageRouteRequest) {}

  private respond = Effect.fn(
    this.generatorContext,
    function* (delivery: BackgroundRuntimeMessageRoutingRequest) {
      const message = yield* WebsiteFocusedLoginRevealMessage.decode(
        delivery.message,
      )
      const request: FocusedLoginMessageOperationRequest = {
        message,
        sender: delivery.sender,
      }
      return yield* Effect.tryPromise(() => this.request.operation(request))
    },
    Effect.catch(() => Effect.succeed(this.failed)),
  )

  route(
    delivery: BackgroundRuntimeMessageRoutingRequest,
  ): RuntimeMessageRouteOutcome {
    switch (delivery.message.type) {
      case WebsiteFocusedLoginRevealMessageType.Reveal:
        void Effect.runPromise(
          this.respond(delivery).pipe(Effect.map(delivery.sendResponse)),
        )
        return {
          kind: RuntimeMessageRouteKind.Handled,
          responseChannel: RuntimeMessageResponseChannel.Open,
        }
      default:
        return { kind: RuntimeMessageRouteKind.Unhandled }
    }
  }
}

type FocusedLoginMessageRouteGeneratorContext = {
  readonly self: FocusedLoginMessageRoute
}
