import { mount } from "svelte";
import "./app.css";
import { configuredVaultApplication, type VaultApplication } from "$app-wasm";
import { ensureAppWasm } from "$lib/wasm-bootstrap";

export async function mountVaultApp(
  expectedKind: VaultApplication,
): Promise<void> {
  await ensureAppWasm(expectedKind);
  const configuredKind = configuredVaultApplication();
  if (configuredKind !== expectedKind) {
    throw new Error(
      `Expected ${expectedKind} vault build, received ${configuredKind}.`,
    );
  }
  const target = document.getElementById("app");
  if (!target) throw new Error("Vault app mount target is missing");
  if (!target) throw new Error("Vault application root is missing.");
  const { default: App } = await import("./App.svelte");
  mount(App, { target });
}
