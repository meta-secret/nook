import { describe, expect, test } from 'bun:test'
import { Schema } from 'effect'
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
    return Schema.decodeUnknown(matchingRuntimeMessageSchema)(message)
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
    value: Schema.String.pipe(Schema.minLength(1)),
  }),
}) satisfies Schema.Schema<MatchingRuntimeMessage>

class RejectingRuntimeMessageOperation {
  constructor(private readonly receivedValues: string[]) {}

  execute(
    request: SchemaRuntimeMessageOperationRequest<MatchingRuntimeMessage>,
  ): Promise<string> {
    this.receivedValues.push(request.message.payload.value)
    return Promise.reject(new Error('expected operation rejection'))
  }
}

describe('ordered background runtime message router', () => {
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
    const admission = BrowserRuntimeMessage.from({ type: 'nook:test' })
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
