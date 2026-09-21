/* eslint-disable nook-typed-api/no-raw-object-arguments, max-params -- Browser runtime owns the transport callback shape used by this adapter. */
import type {
  CompanionWasmRuntimeMessage,
  CompanionWasmSessionResponse,
} from "./companion-wasm-runtime-messages";

export enum CompanionWasmRuntimeDeliveryKind {
  Delivered = "delivered",
  Unavailable = "unavailable",
}

export type CompanionWasmRuntimeDelivery =
  | {
      readonly kind: CompanionWasmRuntimeDeliveryKind.Delivered;
      readonly response: CompanionWasmSessionResponse;
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
