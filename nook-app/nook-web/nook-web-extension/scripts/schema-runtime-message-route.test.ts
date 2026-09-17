import { describe, expect, test } from 'bun:test'
import {
  OrderedBackgroundRuntimeMessageRouter,
  RuntimeMessageResponseChannel,
  RuntimeMessageRouteKind,
  type BackgroundRuntimeMessageRoute,
  type BackgroundRuntimeMessageRoutes,
  type BackgroundRuntimeMessageRoutingRequest,
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

  route(
    _request: BackgroundRuntimeMessageRoutingRequest,
  ): RuntimeMessageRouteOutcome {
    this.request.calls.push(this.request.name)
    return this.request.outcome
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

    expect(new OrderedBackgroundRuntimeMessageRouter(routes).route(request)).toEqual(
      {
        kind: RuntimeMessageRouteKind.Handled,
        responseChannel: RuntimeMessageResponseChannel.Open,
      },
    )
    expect(calls).toEqual(['first', 'second'])
  })
})
