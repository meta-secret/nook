import initNookWasm, { configureVaultApplication } from "$app-wasm";
import { WASM_APPLICATION } from "$lib/wasm-application";

type AppWasmStartup =
  | { kind: "not-started" }
  | { kind: "initializing"; completion: Promise<void> };

let appWasmStartup: AppWasmStartup = { kind: "not-started" };

/** Initialize the shared engine and bind it to this web app before app code loads. */
export function ensureAppWasm(): Promise<void> {
  if (appWasmStartup.kind === "initializing") {
    return appWasmStartup.completion;
  }
  const promise = initNookWasm().then(() => {
    configureVaultApplication(WASM_APPLICATION);
  });
  appWasmStartup = { kind: "initializing", completion: promise };
  return promise;
}
