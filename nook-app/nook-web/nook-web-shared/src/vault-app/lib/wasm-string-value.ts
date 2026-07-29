import { NookStringValue, NookValueState } from "./nook-wasm/nook_wasm";

export function intoWasmStringValue(value: string): NookStringValue {
  return NookStringValue.value(value);
}

export function requireWasmStringValue(value: NookStringValue): string {
  try {
    if (value.state !== NookValueState.Value) {
      throw new Error("required WASM string value is unavailable");
    }
    return value.string;
  } finally {
    value.free();
  }
}
