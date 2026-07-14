import initNookWasm, { configureVaultApplication } from "$app-wasm";
import { WASM_APPLICATION } from "$lib/wasm-application";

let initialization: Promise<void> | undefined = undefined;

/** Initialize the shared engine and bind it to this web app before app code loads. */
export function ensureAppWasm(): Promise<void> {
  initialization ??= initNookWasm().then(() => {
    configureVaultApplication(WASM_APPLICATION);
  });
  return initialization;
}
