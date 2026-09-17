import type { BrowserRuntimeMessage } from '../../lib/browser-runtime-message'

type ChromeMessageListener = Parameters<
  typeof chrome.runtime.onMessage.addListener
>[0]

export type BackgroundRuntimeMessageRoutingRequest = {
  readonly message: BrowserRuntimeMessage
  readonly sender: chrome.runtime.MessageSender
  readonly sendResponse: Parameters<ChromeMessageListener>[2]
}

export enum RuntimeMessageRouteKind {
  Handled = 'handled',
  Unhandled = 'unhandled',
}

export enum RuntimeMessageResponseChannel {
  Closed = 'closed',
  Open = 'open',
}

export type RuntimeMessageRouteOutcome =
  | { readonly kind: RuntimeMessageRouteKind.Unhandled }
  | {
      readonly kind: RuntimeMessageRouteKind.Handled
      readonly responseChannel: RuntimeMessageResponseChannel
    }

export interface BackgroundRuntimeMessageRoute {
  route(
    request: BackgroundRuntimeMessageRoutingRequest,
  ): RuntimeMessageRouteOutcome
}

export interface RuntimeMessageSchema<Message extends BrowserRuntimeMessage> {
  is(message: BrowserRuntimeMessage): message is Message
}

export type SchemaRuntimeMessageOperationRequest<
  Message extends BrowserRuntimeMessage,
> = {
  readonly message: Message
  readonly sender: chrome.runtime.MessageSender
}

export type SchemaRuntimeMessageOperation<
  Message extends BrowserRuntimeMessage,
  Response,
> = (request: SchemaRuntimeMessageOperationRequest<Message>) => Promise<Response>

type SchemaRuntimeMessageRouteRequest<
  Message extends BrowserRuntimeMessage,
  Response,
  FailureResponse,
> = {
  readonly schema: RuntimeMessageSchema<Message>
  readonly operation: SchemaRuntimeMessageOperation<Message, Response>
  readonly failureResponse: () => FailureResponse
}

type SchemaRuntimeMessageOperationBuilderRequest<
  Message extends BrowserRuntimeMessage,
> = {
  readonly schema: RuntimeMessageSchema<Message>
}

type SchemaRuntimeMessageFailureBuilderRequest<
  Message extends BrowserRuntimeMessage,
  Response,
> = {
  readonly schema: RuntimeMessageSchema<Message>
  readonly operation: SchemaRuntimeMessageOperation<Message, Response>
}

export class SchemaRuntimeMessageRoute<
  Message extends BrowserRuntimeMessage,
  Response,
  FailureResponse,
> implements BackgroundRuntimeMessageRoute
{
  private constructor(
    private readonly request: SchemaRuntimeMessageRouteRequest<
      Message,
      Response,
      FailureResponse
    >,
  ) {}

  static matching<Message extends BrowserRuntimeMessage>(
    schema: RuntimeMessageSchema<Message>,
  ): SchemaRuntimeMessageOperationBuilder<Message> {
    const request: SchemaRuntimeMessageOperationBuilderRequest<Message> = {
      schema,
    }
    return new SchemaRuntimeMessageOperationBuilder(request)
  }

  route(
    request: BackgroundRuntimeMessageRoutingRequest,
  ): RuntimeMessageRouteOutcome {
    if (!this.request.schema.is(request.message))
      return { kind: RuntimeMessageRouteKind.Unhandled }
    const operationRequest: SchemaRuntimeMessageOperationRequest<Message> = {
      message: request.message,
      sender: request.sender,
    }
    void this.request
      .operation(operationRequest)
      .then(request.sendResponse)
      .catch(() => request.sendResponse(this.request.failureResponse()))
    return {
      kind: RuntimeMessageRouteKind.Handled,
      responseChannel: RuntimeMessageResponseChannel.Open,
    }
  }

  static create<
    Message extends BrowserRuntimeMessage,
    Response,
    FailureResponse,
  >(
    request: SchemaRuntimeMessageRouteRequest<
      Message,
      Response,
      FailureResponse
    >,
  ): SchemaRuntimeMessageRoute<Message, Response, FailureResponse> {
    return new SchemaRuntimeMessageRoute(request)
  }
}

export class SchemaRuntimeMessageOperationBuilder<
  Message extends BrowserRuntimeMessage,
> {
  constructor(
    private readonly request: SchemaRuntimeMessageOperationBuilderRequest<Message>,
  ) {}

  respondWith<Response>(
    operation: SchemaRuntimeMessageOperation<Message, Response>,
  ): SchemaRuntimeMessageFailureBuilder<Message, Response> {
    const request: SchemaRuntimeMessageFailureBuilderRequest<
      Message,
      Response
    > = {
      schema: this.request.schema,
      operation,
    }
    return new SchemaRuntimeMessageFailureBuilder(request)
  }
}

export class SchemaRuntimeMessageFailureBuilder<
  Message extends BrowserRuntimeMessage,
  Response,
> {
  constructor(
    private readonly request: SchemaRuntimeMessageFailureBuilderRequest<
      Message,
      Response
    >,
  ) {}

  onRejected<FailureResponse>(
    failureResponse: () => FailureResponse,
  ): SchemaRuntimeMessageRoute<Message, Response, FailureResponse> {
    const request: SchemaRuntimeMessageRouteRequest<
      Message,
      Response,
      FailureResponse
    > = {
      ...this.request,
      failureResponse,
    }
    return SchemaRuntimeMessageRoute.create(request)
  }
}

export type BackgroundRuntimeMessageRoutes = readonly BackgroundRuntimeMessageRoute[]

export class OrderedBackgroundRuntimeMessageRouter {
  constructor(private readonly routes: BackgroundRuntimeMessageRoutes) {}

  route(
    request: BackgroundRuntimeMessageRoutingRequest,
  ): RuntimeMessageRouteOutcome {
    for (const route of this.routes) {
      const outcome = route.route(request)
      if (outcome.kind === RuntimeMessageRouteKind.Handled) return outcome
    }
    return { kind: RuntimeMessageRouteKind.Unhandled }
  }
}
