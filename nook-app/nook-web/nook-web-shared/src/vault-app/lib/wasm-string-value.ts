import { omittedValue } from "../../explicit-state";
import { NookStringValue, NookValueState } from "./nook-wasm/nook_wasm";

export function intoWasmStringValue(value: string | void): NookStringValue {
  return !value ? NookStringValue.unavailable() : NookStringValue.value(value);
}

export function takeWasmStringValue(value: NookStringValue): string | void {
  try {
    return value.state === NookValueState.Value ? value.string : omittedValue();
  } finally {
    value.free();
  }
}
