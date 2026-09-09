import { mount } from "svelte";
import "./app.css";
import { configured_vault_application, type VaultApplication } from "$app-wasm";
import { VaultStartupShell } from "$lib/app/startup-shell";
import { vaultApplicationRuntime } from "$lib/runtime/wasm-bootstrap";

export async function mountVaultApp(
  expectedKind: VaultApplication,
): Promise<void> {
  const target = document.getElementById("app");
  if (!target) throw new Error("Vault app mount target is missing");
  const startupShellArgs: ConstructorParameters<typeof VaultStartupShell>[0] = {
    target,
  };
  const startupShell = new VaultStartupShell(startupShellArgs);

  try {
    await vaultApplicationRuntime.ensureAppWasm(expectedKind);
    const { default: App } = await import("./App.svelte");
    const configuredKind = configured_vault_application();
    if (configuredKind !== expectedKind) {
      throw new Error(
        `Expected ${expectedKind} vault build, received ${configuredKind}.`,
      );
    }
    if (!target.isConnected || document.getElementById("app") !== target) {
      return;
    }
    const mountArgs: { readonly target: HTMLElement } = { target };
    mount(App, mountArgs);
    startupShell.remove();
  } catch (error) {
    startupShell.showUnavailable();
    throw error;
  }
}
