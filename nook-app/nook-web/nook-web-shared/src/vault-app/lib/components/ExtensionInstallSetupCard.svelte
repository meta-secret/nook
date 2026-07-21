<script lang="ts">
  import { Puzzle } from "@lucide/svelte";
  import { Button } from "$lib/components/ui/button";
  import type { ExtensionSetupStatus } from "$lib/extension-install";
  import type { VaultState } from "$lib/vault.svelte";

  let {
    vault,
    status,
    installBusy = false,
    onInstall,
  }: {
    vault: VaultState;
    status: ExtensionSetupStatus;
    installBusy?: boolean;
    onInstall: () => void;
  } = $props();

  const isNotInstalled = $derived(status === "not_installed");
  const isInstalledUnpaired = $derived(status === "installed_unpaired");
</script>

<aside
  class="rounded-lg border border-primary/25 bg-primary/5 p-4 animate-in fade-in slide-in-from-top-2"
  data-testid="extension-install-setup"
  data-status={status}
>
  <div class="flex items-start gap-3">
    <Puzzle class="mt-0.5 size-5 shrink-0 text-primary" />
    <div class="min-w-0 flex-1 space-y-3">
      <div class="space-y-1">
        <p class="text-sm font-semibold text-foreground">
          {vault.t(
            isNotInstalled
              ? "extension_setup.title"
              : "extension_setup.pair_title",
          )}
        </p>
        <p class="text-xs leading-relaxed text-muted-foreground">
          {vault.t(
            isNotInstalled
              ? "extension_setup.body"
              : "extension_setup.pair_body",
          )}
        </p>
        {#if isInstalledUnpaired}
          <p class="text-[11px] leading-relaxed text-muted-foreground/80">
            {vault.t("extension_setup.pair_hint")}
          </p>
        {/if}
      </div>
      {#if isNotInstalled}
        <Button
          type="button"
          size="sm"
          disabled={installBusy}
          data-testid="extension-install-setup-cta"
          onclick={onInstall}
        >
          {installBusy
            ? vault.t("extension_setup.loading_install")
            : vault.t("extension_setup.install_cta")}
        </Button>
      {:else if isInstalledUnpaired}
        <Button
          type="button"
          size="sm"
          variant="outline"
          class="border-border"
          disabled={installBusy}
          data-testid="extension-install-setup-open-page"
          onclick={onInstall}
        >
          {installBusy
            ? vault.t("extension_setup.loading_install")
            : vault.t("extension_setup.open_install_page")}
        </Button>
      {/if}
    </div>
  </div>
</aside>
