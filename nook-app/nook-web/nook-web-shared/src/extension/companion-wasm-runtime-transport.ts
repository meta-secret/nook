/* eslint-disable nook-typed-api/no-raw-object-arguments, max-params -- Browser runtime owns the transport callback shape used by this adapter. */
import type {
  CompanionWasmRuntimeMessage,
  CompanionWasmSessionResponse,
} from "./companion-wasm-runtime-messages";
import { CompanionWasmSessionMessageType } from "./companion-wasm-runtime-messages";
import type { AuthenticationLoginChecklistPresentation } from "./nook-companion-wasm/nook_companion_wasm.js";

export enum CompanionWasmRuntimeDeliveryKind {
  Delivered = "delivered",
  Unavailable = "unavailable",
}

export type CompanionWasmRuntimeDelivery<
  Response = CompanionWasmSessionResponse,
> =
  | {
      readonly kind: CompanionWasmRuntimeDeliveryKind.Delivered;
      readonly response: Response;
    }
  | { readonly kind: CompanionWasmRuntimeDeliveryKind.Unavailable };

type CompanionWasmRuntimeResponse =
  | {
      readonly ok: true;
      readonly result: CompanionWasmSessionResponse;
    }
  | { readonly ok: false };

export function sendCompanionWasmRuntimeMessage(
  browser: typeof globalThis,
  message: CompanionWasmRuntimeMessage,
): Promise<CompanionWasmRuntimeDelivery> {
  return new Promise((resolve) => {
    try {
      browser.chrome.runtime.sendMessage(
        message,
        (response: CompanionWasmRuntimeResponse) => {
          if (
            browser.chrome.runtime.lastError ||
            !response ||
            response.ok !== true ||
            !("result" in response)
          ) {
            resolve({ kind: CompanionWasmRuntimeDeliveryKind.Unavailable });
            return;
          }
          resolve({
            kind: CompanionWasmRuntimeDeliveryKind.Delivered,
            response: response.result,
          });
        },
      );
    } catch {
      resolve({ kind: CompanionWasmRuntimeDeliveryKind.Unavailable });
    }
  });
}

export type LoginChecklistProjectionMessage = Extract<
  CompanionWasmRuntimeMessage,
  {
    readonly type: CompanionWasmSessionMessageType.ProjectAuthenticationLoginChecklist;
  }
>;
export type LoginChecklistProjectionRequest = {
  readonly browser: typeof globalThis;
  readonly message: LoginChecklistProjectionMessage;
};
type LoginChecklistProjectionDelivery =
  CompanionWasmRuntimeDelivery<AuthenticationLoginChecklistPresentation>;
type LoginChecklistProjectionResponse =
  | {
      readonly ok: true;
      readonly result: AuthenticationLoginChecklistPresentation;
    }
  | { readonly ok: false };

enum ChecklistProjectionCompletionKind {
  Idle = "idle",
  Pending = "pending",
}
type ChecklistProjectionCompletion =
  | { kind: ChecklistProjectionCompletionKind.Idle }
  | {
      kind: ChecklistProjectionCompletionKind.Pending;
      resolve: (delivery: LoginChecklistProjectionDelivery) => void;
    };
enum ChecklistRuntimeAvailability {
  Available = "available",
  Unavailable = "unavailable",
}

/** Owns the exact operation-to-generated-response contract at the Chrome boundary. */
class LoginChecklistProjectionTransport {
  private completion: ChecklistProjectionCompletion = {
    kind: ChecklistProjectionCompletionKind.Idle,
  };
  constructor(private readonly request: LoginChecklistProjectionRequest) {}
  send(): Promise<LoginChecklistProjectionDelivery> {
    return new Promise(this.deliver.bind(this));
  }
  private deliver(
    resolve: (delivery: LoginChecklistProjectionDelivery) => void,
  ): void {
    this.completion = {
      kind: ChecklistProjectionCompletionKind.Pending,
      resolve,
    };
    try {
      this.request.browser.chrome.runtime.sendMessage(
        this.request.message,
        this.receive.bind(this),
      );
    } catch {
      this.unavailable();
    }
  }
  private runtimeAvailability(): ChecklistRuntimeAvailability {
    switch (Boolean(this.request.browser.chrome.runtime.lastError)) {
      case true:
        return ChecklistRuntimeAvailability.Unavailable;
      case false:
        return ChecklistRuntimeAvailability.Available;
    }
  }
  private receive(response: LoginChecklistProjectionResponse): void {
    switch (this.runtimeAvailability()) {
      case ChecklistRuntimeAvailability.Unavailable:
        this.unavailable();
        return;
      case ChecklistRuntimeAvailability.Available:
        break;
    }
    switch (response?.ok) {
      case true:
        switch ("result" in response) {
          case false:
            this.unavailable();
            return;
          case true: {
            const delivery: LoginChecklistProjectionDelivery = {
              kind: CompanionWasmRuntimeDeliveryKind.Delivered,
              response: response.result,
            };
            this.finish(delivery);
            return;
          }
        }
        break;
      case false:
        this.unavailable();
        return;
      default:
        this.unavailable();
    }
  }
  private unavailable(): void {
    const delivery: LoginChecklistProjectionDelivery = {
      kind: CompanionWasmRuntimeDeliveryKind.Unavailable,
    };
    this.finish(delivery);
  }
  private finish(delivery: LoginChecklistProjectionDelivery): void {
    switch (this.completion.kind) {
      case ChecklistProjectionCompletionKind.Idle:
        return;
      case ChecklistProjectionCompletionKind.Pending: {
        const resolve = this.completion.resolve;
        this.completion = { kind: ChecklistProjectionCompletionKind.Idle };
        resolve(delivery);
      }
    }
  }
}

export function sendLoginChecklistProjection(
  request: LoginChecklistProjectionRequest,
): Promise<LoginChecklistProjectionDelivery> {
  return new LoginChecklistProjectionTransport(request).send();
}
