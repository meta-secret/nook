import initNookWasm, { configureVaultApplication } from "$app-wasm";
import { WASM_APPLICATION } from "$lib/wasm-application";
import {
  EMPTY_VALUE,
  presentValue,
  type ValueState,
} from "../../explicit-state";

let initialization: ValueState<Promise<void>> = EMPTY_VALUE;

/** Initialize the shared engine and bind it to this web app before app code loads. */
export function ensureAppWasm(): Promise<void> {
  if (initialization.kind === "present") {
    return initialization.value;
  }
  const promise = initNookWasm().then(() => {
    configureVaultApplication(WASM_APPLICATION);
  });
  initialization = presentValue(promise);
  return promise;
}
