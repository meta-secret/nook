import { mount, type Component, type MountOptions } from "svelte";
import { err, ok, type Result } from "neverthrow";
import "./app.css";
import { configured_vault_application, type VaultApplication } from "$app-wasm";
import { VaultStartupShell } from "$lib/app/startup-shell";
import { vaultApplicationRuntime } from "$lib/runtime/wasm-bootstrap";

export enum VaultMountFailure {
  MissingTarget = "missing-target",
  EngineUnavailable = "engine-unavailable",
  ApplicationMismatch = "application-mismatch",
  DetachedTarget = "detached-target",
  RenderUnavailable = "render-unavailable",
}

export enum VaultMountOutcome {
  Mounted = "mounted",
}

class VaultAppMount {
  constructor(private readonly application: VaultApplication) {}
  async mount(): Promise<Result<VaultMountOutcome, VaultMountFailure>> {
    const target = document.getElementById("app");
    if (!target) return err(VaultMountFailure.MissingTarget);
    const startupShellRequest: ConstructorParameters<
      typeof VaultStartupShell
    >[0] = { target };
    const startupShell = new VaultStartupShell(startupShellRequest);
    const ready = await vaultApplicationRuntime.ensureAppWasm(this.application);
    if (ready.isErr()) {
      startupShell.showUnavailable();
      return err(VaultMountFailure.EngineUnavailable);
    }
    // Dynamic module loading and Svelte mount are foreign runtime boundaries.
    try {
      const { default: App } = await import("./App.svelte");
      if (configured_vault_application() !== this.application) {
        startupShell.showUnavailable();
        return err(VaultMountFailure.ApplicationMismatch);
      }
      if (!target.isConnected || document.getElementById("app") !== target)
        return err(VaultMountFailure.DetachedTarget);
      const mountOptions: MountOptions<Record<PropertyKey, never>> = { target };
      mount(App as Component<Record<PropertyKey, never>>, mountOptions);
      startupShell.remove();
      return ok(VaultMountOutcome.Mounted);
    } catch {
      startupShell.showUnavailable();
      return err(VaultMountFailure.RenderUnavailable);
    }
  }
}

/** The browser entrypoint renders failure and records its concrete terminal cause. */
class VaultApplicationEntrypoint {
  async start(application: VaultApplication): Promise<void> {
    const result = await new VaultAppMount(application).mount();
    if (result.isErr())
      console.error("Vault application startup failed", result.error);
  }
}
export const vaultApplicationEntrypoint = new VaultApplicationEntrypoint();
