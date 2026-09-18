import { Effect, Schema } from "effect";
import type { RuntimeMessage } from "$web-shared/extension/runtime-messages";
import type { ExtensionRuntimeResponseObject } from "./extension-response-decoders";

export type ChromeExtensionRuntimeResponse = ExtensionRuntimeResponseObject;

export type ExtensionMessageRequest = {
  readonly extensionId: string;
  readonly message: RuntimeMessage;
  readonly responseWait: ExtensionMessageResponseWait;
};

export enum ExtensionMessageResponseWaitKind {
  BrowserChannel = "browser-channel",
  Bounded = "bounded",
}

export type ExtensionMessageResponseWait =
  | { readonly kind: ExtensionMessageResponseWaitKind.BrowserChannel }
  | {
      readonly kind: ExtensionMessageResponseWaitKind.Bounded;
      readonly timeoutMs: number;
    };

enum ExtensionMessageResponseTimerKind {
  NotScheduled = "not-scheduled",
  Scheduled = "scheduled",
}

type ExtensionMessageResponseTimer =
  | { readonly kind: ExtensionMessageResponseTimerKind.NotScheduled }
  | {
      readonly kind: ExtensionMessageResponseTimerKind.Scheduled;
      readonly handle: number;
    };

export enum ExtensionMessageDeliveryKind {
  Unavailable = "unavailable",
  Received = "received",
}

export type ExtensionMessageDelivery =
  | { kind: ExtensionMessageDeliveryKind.Unavailable }
  | {
      kind: ExtensionMessageDeliveryKind.Received;
      response: ChromeExtensionRuntimeResponse;
    };

enum ExtensionResponsePhase {
  Pending = "pending",
  Settled = "settled",
}

type ExtensionResponseState =
  | {
      kind: ExtensionResponsePhase.Pending;
      timer: ExtensionMessageResponseTimer;
    }
  | { kind: ExtensionResponsePhase.Settled };

type PendingExtensionResponseRequest = {
  readonly browser: ExtensionBrowserHost;
  readonly wait: ExtensionMessageResponseWait;
  readonly resolve: (delivery: ExtensionMessageDelivery) => void;
};

/** Only a pending response owns timer completion; native callback aliases are invalidated. */
class PendingExtensionResponse {
  private state: ExtensionResponseState = {
    kind: ExtensionResponsePhase.Pending,
    timer: { kind: ExtensionMessageResponseTimerKind.NotScheduled },
  };

  constructor(private readonly request: PendingExtensionResponseRequest) {
    if (request.wait.kind === ExtensionMessageResponseWaitKind.Bounded) {
      this.state = {
        kind: ExtensionResponsePhase.Pending,
        timer: {
          kind: ExtensionMessageResponseTimerKind.Scheduled,
          handle: request.browser.window.setTimeout(
            () => this.unavailable(),
            request.wait.timeoutMs,
          ),
        },
      };
    }
  }

  private settle(delivery: ExtensionMessageDelivery): void {
    const pending = this.state;
    if (pending.kind !== ExtensionResponsePhase.Pending) return;
    this.state = { kind: ExtensionResponsePhase.Settled };
    if (pending.timer.kind === ExtensionMessageResponseTimerKind.Scheduled)
      this.request.browser.window.clearTimeout(pending.timer.handle);
    this.request.resolve(delivery);
  }

  unavailable(): void {
    const unavailableDelivery: ExtensionMessageDelivery = {
      kind: ExtensionMessageDeliveryKind.Unavailable,
    };
    this.settle(unavailableDelivery);
  }

  receive(response: ChromeExtensionRuntimeResponse): void {
    const receivedDelivery: ExtensionMessageDelivery = {
      kind: ExtensionMessageDeliveryKind.Received,
      response,
    };
    this.settle(receivedDelivery);
  }
}

type ChromeRuntimeResponseCallback = (
  response?: ChromeExtensionRuntimeResponse,
) => void;

type ChromeRuntimeSendMessageRequest = readonly [
  extensionId: string,
  message: RuntimeMessage,
  callback: ChromeRuntimeResponseCallback,
];

type ChromeRuntimeHost = {
  readonly sendMessage: (...request: ChromeRuntimeSendMessageRequest) => void;
};

enum ChromeRuntimeLastErrorStateKind {
  Absent = "absent",
  Present = "present",
}

type ChromeRuntimeLastErrorState =
  | { readonly kind: ChromeRuntimeLastErrorStateKind.Absent }
  | {
      readonly kind: ChromeRuntimeLastErrorStateKind.Present;
      readonly message: string;
    };

class ChromeRuntimeLastErrorFields {
  static build() {
    return { message: Schema.optional(Schema.String) };
  }
}

const ChromeRuntimeLastErrorSchema = Schema.Struct(
  ChromeRuntimeLastErrorFields.build(),
);

export type ExtensionBrowserHost = typeof globalThis & {
  readonly chrome?: { readonly runtime?: ChromeRuntimeHost };
};

enum ChromeRuntimeAvailabilityKind {
  Unavailable = "unavailable",
  Available = "available",
}

type ChromeRuntimeAvailability =
  | { readonly kind: ChromeRuntimeAvailabilityKind.Unavailable }
  | {
      readonly kind: ChromeRuntimeAvailabilityKind.Available;
      readonly runtime: ChromeRuntimeHost;
    };

const EXTENSION_MESSAGE_TIMEOUT_MS = 5_000;

/** Owns the browser runtime channel, response timeout, and host error boundary. */
export class ExtensionMessageChannel {
  constructor(private readonly browser: ExtensionBrowserHost) {}

  send(request: ExtensionMessageRequest): Promise<ExtensionMessageDelivery> {
    return new Promise((resolve) => {
      const runtimeAvailability = this.chromeRuntime();
      if (
        runtimeAvailability.kind === ChromeRuntimeAvailabilityKind.Unavailable
      ) {
        const unavailableDelivery: ExtensionMessageDelivery = {
          kind: ExtensionMessageDeliveryKind.Unavailable,
        };
        resolve(unavailableDelivery);
        return;
      }
      const { runtime } = runtimeAvailability;
      const pendingRequest: PendingExtensionResponseRequest = {
        browser: this.browser,
        wait: request.responseWait,
        resolve,
      };
      const pending = new PendingExtensionResponse(pendingRequest);
      runtime.sendMessage(request.extensionId, request.message, (response) => {
        if (
          this.chromeRuntimeLastError(runtime).kind ===
          ChromeRuntimeLastErrorStateKind.Present
        ) {
          pending.unavailable();
          return;
        }
        if (!response) {
          pending.unavailable();
          return;
        }
        pending.receive(response);
      });
    });
  }

  private chromeRuntimeLastError(
    runtime: ChromeRuntimeHost,
  ): ChromeRuntimeLastErrorState {
    if (!("lastError" in runtime)) {
      return { kind: ChromeRuntimeLastErrorStateKind.Absent };
    }
    const decoded = Effect.runSync(
      Effect.either(
        Schema.decodeUnknown(ChromeRuntimeLastErrorSchema)(
          Reflect.get(runtime, "lastError"),
        ),
      ),
    );
    if (decoded._tag === "Left" || !decoded.right.message) {
      return { kind: ChromeRuntimeLastErrorStateKind.Absent };
    }
    return {
      kind: ChromeRuntimeLastErrorStateKind.Present,
      message: decoded.right.message,
    };
  }

  private chromeRuntime(): ChromeRuntimeAvailability {
    const chromeHost = this.browser.chrome;
    if (!chromeHost?.runtime) {
      return { kind: ChromeRuntimeAvailabilityKind.Unavailable };
    }
    if (typeof chromeHost.runtime.sendMessage !== "function") {
      return { kind: ChromeRuntimeAvailabilityKind.Unavailable };
    }
    return {
      kind: ChromeRuntimeAvailabilityKind.Available,
      runtime: chromeHost.runtime,
    };
  }
}

export { EXTENSION_MESSAGE_TIMEOUT_MS };
