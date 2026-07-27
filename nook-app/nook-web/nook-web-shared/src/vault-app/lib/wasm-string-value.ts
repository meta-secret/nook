import { NookStringValue, NookValueState } from "./nook-wasm/nook_wasm";

export function intoWasmStringValue(
  value: string | undefined,
): NookStringValue {
  return value === undefined || value.length === 0
    ? NookStringValue.unavailable()
    : NookStringValue.value(value);
}

export function takeWasmStringValue(
  value: NookStringValue,
): string | undefined {
  try {
    return value.state === NookValueState.Value ? value.string : undefined;
  } finally {
    value.free();
  }
}
