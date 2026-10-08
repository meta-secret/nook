import { describe, expect, test } from 'bun:test'
import { Deferred, Effect, Schema } from 'effect'
import { companionWasmReady } from '../../nook-web-shared/src/extension/companion-ready'
import {
  WebsiteFocusedLoginRevealMessage,
  WebsiteFocusedLoginRevealMessageType,
  type WebsiteFocusedLoginFillResponse,
} from '../src/lib/focused-login-fill-messages'
import { FocusedLoginMessageRoute } from '../src/background/service-worker/focused-login-message-route'
import {
  OrderedBackgroundRuntimeMessageRouter,
  RuntimeMessageResponseChannel,
  RuntimeMessageRouteKind,
  SchemaRuntimeMessageRoute,
  type BackgroundRuntimeMessageRoute,
  type BackgroundRuntimeMessageRoutes,
  type BackgroundRuntimeMessageRoutingRequest,
  type SchemaRuntimeMessageOperationRequest,
  type RuntimeMessageRouteOutcome,
} from '../src/background/service-worker/schema-runtime-message-route'
import {
  BrowserRuntimeMessage,
  BrowserRuntimeMessageAdmissionKind,
  type BrowserRuntimeMessageValue,
} from '../src/lib/browser-runtime-message'

type RecordedRouteRequest = {
  readonly name: string
  readonly outcome: RuntimeMessageRouteOutcome
  readonly calls: string[]
}

class RecordedRoute implements BackgroundRuntimeMessageRoute {
  constructor(private readonly request: RecordedRouteRequest) {}

  route(): RuntimeMessageRouteOutcome {
    this.request.calls.push(this.request.name)
    return this.request.outcome
  }
}

class MatchingRuntimeMessageSchema {
  static decode(message: BrowserRuntimeMessage) {
    return Schema.decodeUnknownEffect(matchingRuntimeMessageSchema)(message)
  }
}

enum MatchingRuntimeMessageType {
  Test = 'nook:test',
}

type MatchingRuntimeMessage = {
  readonly type: MatchingRuntimeMessageType.Test
  readonly payload: {
    readonly value: string
  }
}

const matchingRuntimeMessageSchema = Schema.Struct({
  type: Schema.Literal(MatchingRuntimeMessageType.Test),
  payload: Schema.Struct({
    value: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
  }),
}) satisfies Schema.Codec<MatchingRuntimeMessage>

class RejectingRuntimeMessageOperation {
  constructor(private readonly receivedValues: string[]) {}

  execute(
    request: SchemaRuntimeMessageOperationRequest<MatchingRuntimeMessage>,
  ): Promise<string> {
    this.receivedValues.push(request.message.payload.value)
    return Promise.reject(new Error('expected operation rejection'))
  }
}

enum FocusedRouteScenario {
  InvalidSelector = 'invalid-credential',
  ProviderFailure = 'operation-failed',
  Selected = 'selected',
}
type FocusedRouteOperationRequest = Parameters<
  ConstructorParameters<typeof FocusedLoginMessageRoute>[0]['operation']
>[0]
type FocusedRouteFixtureContext = { readonly self: FocusedRouteFixture }
class FocusedRouteFixture {
  static readonly FAILURE_SCENARIOS: readonly FocusedRouteScenario[] = [
    FocusedRouteScenario.InvalidSelector,
    FocusedRouteScenario.ProviderFailure,
  ]
  private readonly generatorContext: FocusedRouteFixtureContext = { self: this }
  private readonly response = Effect.runSync(
    Deferred.make<WebsiteFocusedLoginFillResponse>(),
  )
  private readonly received: WebsiteFocusedLoginRevealMessage[] = []
  private calls = 0
  constructor(private readonly scenario: FocusedRouteScenario) {}
  private operation(
    request: FocusedRouteOperationRequest,
  ): Promise<WebsiteFocusedLoginFillResponse> {
    this.calls += 1
    this.received.push(request.message)
    switch (this.scenario) {
      case FocusedRouteScenario.InvalidSelector:
      case FocusedRouteScenario.ProviderFailure:
        return Effect.runPromise(
          Effect.fail(new Error('Fixture focused operation failed')),
        )
      case FocusedRouteScenario.Selected: {
        const selected: WebsiteFocusedLoginFillResponse = {
          ok: true,
          value: 'selected-only',
        }
        return Effect.runPromise(Effect.succeed(selected))
      }
    }
  }
  private respond(value: WebsiteFocusedLoginFillResponse): void {
    Effect.runSync(Deferred.succeed(this.response, value))
  }
  run(): Promise<void> {
    return Effect.runPromise(
      Effect.gen(this.generatorContext, function* () {
        yield* Effect.promise(() => companionWasmReady)
        const credentials: Record<FocusedRouteScenario, string> = {
          [FocusedRouteScenario.InvalidSelector]: 'Unsupported',
          [FocusedRouteScenario.ProviderFailure]: 'Username',
          [FocusedRouteScenario.Selected]: 'Username',
        }
        const envelope: BrowserRuntimeMessageValue = {
          type: WebsiteFocusedLoginRevealMessageType.Reveal,
          payload: {
            origin: 'https://example.com',
            vaultStoreId: 'store_abcdefghijk',
            secretId: 'secret_SMypl8K0w9a',
            authorizationGeneration: 'fixture-generation',
            credential: credentials[this.scenario],
          },
        }
        const admission = BrowserRuntimeMessage.from(envelope)
        switch (admission.kind) {
          case BrowserRuntimeMessageAdmissionKind.Rejected:
            throw new Error('Expected admitted fixture envelope')
          case BrowserRuntimeMessageAdmissionKind.Accepted:
            break
        }
        const configuration: ConstructorParameters<
          typeof FocusedLoginMessageRoute
        >[0] = { operation: this.operation.bind(this) }
        const request: BackgroundRuntimeMessageRoutingRequest = {
          message: admission.message,
          sender: { id: 'nook-extension', url: 'https://example.com' },
          sendResponse: this.respond.bind(this),
        }
        const expectedRoute: RuntimeMessageRouteOutcome = {
          kind: RuntimeMessageRouteKind.Handled,
          responseChannel: RuntimeMessageResponseChannel.Open,
        }
        expect(
          new FocusedLoginMessageRoute(configuration).route(request),
        ).toEqual(expectedRoute)
        const response = yield* Deferred.await(this.response)
        const failed: WebsiteFocusedLoginFillResponse = {
          ok: false,
          reason: 'login-fill-failed',
        }
        switch (this.scenario) {
          case FocusedRouteScenario.InvalidSelector:
            expect(response).toEqual(failed)
            expect(this.calls).toBe(0)
            break
          case FocusedRouteScenario.ProviderFailure:
            expect(response).toEqual(failed)
            expect(this.calls).toBe(1)
            break
          case FocusedRouteScenario.Selected: {
            const selected: WebsiteFocusedLoginFillResponse = {
              ok: true,
              value: 'selected-only',
            }
            const expectedMessage: WebsiteFocusedLoginRevealMessage = {
              type: WebsiteFocusedLoginRevealMessageType.Reveal,
              payload: {
                origin: 'https://example.com',
                vaultStoreId: 'store_abcdefghijk',
                secretId: 'secret_SMypl8K0w9a',
                authorizationGeneration: 'fixture-generation',
                credential: 'Username',
              },
            }
            expect(response).toEqual(selected)
            const expectedMessages: WebsiteFocusedLoginRevealMessage[] = [
              expectedMessage,
            ]
            expect(this.received).toEqual(expectedMessages)
            break
          }
        }
      }),
    )
  }
}

describe('ordered background runtime message router', () => {
  const failureScenarios: FocusedRouteScenario[] = [
    ...FocusedRouteFixture.FAILURE_SCENARIOS,
  ]
  test.each(failureScenarios)(
    'focused async route returns the fixed failure for %s',
    (scenario) => new FocusedRouteFixture(scenario).run(),
  )
  test('keeps the focused reveal channel open through asynchronous Rust admission', () =>
    new FocusedRouteFixture(FocusedRouteScenario.Selected).run())
  test('falls through unhandled routes and stops at the first handler', () => {
    const calls: string[] = []
    const firstRouteRequest: RecordedRouteRequest = {
      name: 'first',
      outcome: { kind: RuntimeMessageRouteKind.Unhandled },
      calls,
    }
    const secondRouteRequest: RecordedRouteRequest = {
      name: 'second',
      outcome: {
        kind: RuntimeMessageRouteKind.Handled,
        responseChannel: RuntimeMessageResponseChannel.Open,
      },
      calls,
    }
    const thirdRouteRequest: RecordedRouteRequest = {
      name: 'third',
      outcome: {
        kind: RuntimeMessageRouteKind.Handled,
        responseChannel: RuntimeMessageResponseChannel.Closed,
      },
      calls,
    }
    const routes: BackgroundRuntimeMessageRoutes = [
      new RecordedRoute(firstRouteRequest),
      new RecordedRoute(secondRouteRequest),
      new RecordedRoute(thirdRouteRequest),
    ]
    const admission = BrowserRuntimeMessage.from({
      type: MatchingRuntimeMessageType.Test,
    })
    expect(admission.kind).toBe(BrowserRuntimeMessageAdmissionKind.Accepted)
    if (admission.kind !== BrowserRuntimeMessageAdmissionKind.Accepted) return
    const request: BackgroundRuntimeMessageRoutingRequest = {
      message: admission.message,
      sender: {},
      sendResponse: () => {
        calls.push('response')
      },
    }

    expect(
      new OrderedBackgroundRuntimeMessageRouter(routes).route(request),
    ).toEqual({
      kind: RuntimeMessageRouteKind.Handled,
      responseChannel: RuntimeMessageResponseChannel.Open,
    })
    expect(calls).toEqual(['first', 'second'])
  })

  test('sends the typed failure response and keeps the channel open', async () => {
    const admission = BrowserRuntimeMessage.from({
      type: MatchingRuntimeMessageType.Test,
      payload: { value: 'decoded payload' },
    })
    expect(admission.kind).toBe(BrowserRuntimeMessageAdmissionKind.Accepted)
    if (admission.kind !== BrowserRuntimeMessageAdmissionKind.Accepted) return
    const responses: string[] = []
    const receivedValues: string[] = []
    const operation = new RejectingRuntimeMessageOperation(receivedValues)
    const route = SchemaRuntimeMessageRoute.matching(
      MatchingRuntimeMessageSchema,
    )
      .respondWith(operation.execute.bind(operation))
      .onRejected(() => 'operation-failed')
    const request: BackgroundRuntimeMessageRoutingRequest = {
      message: admission.message,
      sender: {},
      sendResponse: (response: string) => {
        responses.push(response)
      },
    }

    expect(route.route(request)).toEqual({
      kind: RuntimeMessageRouteKind.Handled,
      responseChannel: RuntimeMessageResponseChannel.Open,
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(responses).toEqual(['operation-failed'])
    expect(receivedValues).toEqual(['decoded payload'])
  })

  test('leaves schema-invalid messages unhandled', () => {
    const admission = BrowserRuntimeMessage.from({
      type: MatchingRuntimeMessageType.Test,
      payload: { value: 7 },
    })
    expect(admission.kind).toBe(BrowserRuntimeMessageAdmissionKind.Accepted)
    if (admission.kind !== BrowserRuntimeMessageAdmissionKind.Accepted) return

    const route = SchemaRuntimeMessageRoute.matching(
      MatchingRuntimeMessageSchema,
    )
      .respondWith(async () => 'should-not-run')
      .onRejected(() => 'operation-failed')
    const request: BackgroundRuntimeMessageRoutingRequest = {
      message: admission.message,
      sender: {},
      sendResponse: () => {},
    }

    expect(route.route(request)).toEqual({
      kind: RuntimeMessageRouteKind.Unhandled,
    })
  })
})
