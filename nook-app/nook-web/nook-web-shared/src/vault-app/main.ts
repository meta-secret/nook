import { mount } from "svelte";
import "./app.css";
import { ensureAppWasm } from "$lib/wasm-bootstrap";
import { APP_KIND, type AppKind } from "$lib/app-kind";

export async function mountVaultApp(expectedKind: AppKind): Promise<void> {
  if (APP_KIND !== expectedKind) {
    throw new Error(
      `Expected ${expectedKind} vault build, received ${APP_KIND}.`,
    );
  }
  const target = document.getElementById("app");
  if (!target) throw new Error("Vault application root is missing.");
  await ensureAppWasm();
  const { default: App } = await import("./App.svelte");
  mount(App, { target });
}
