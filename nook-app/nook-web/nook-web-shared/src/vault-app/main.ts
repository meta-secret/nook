import { mount } from "svelte";
import "./app.css";
import { configured_vault_application, type VaultApplication } from "$app-wasm";
import { ensureAppWasm } from "$lib/runtime/wasm-bootstrap";
import { companionWasmReady } from "$web-shared/extension/companion-ready";

export async function mountVaultApp(
  expectedKind: VaultApplication,
): Promise<void> {
  await ensureAppWasm(expectedKind);
  await companionWasmReady;
  const configuredKind = configured_vault_application();
  if (configuredKind !== expectedKind) {
    throw new Error(
      `Expected ${expectedKind} vault build, received ${configuredKind}.`,
    );
  }
  const target = document.getElementById("app");
  if (!target) throw new Error("Vault app mount target is missing");
  if (!target) throw new Error("Vault application root is missing.");
  const { default: App } = await import("./App.svelte");
  const mountArgs: { readonly target: HTMLElement } = { target };
  mount(App, mountArgs);
}
