<!--
Identity Sync page header: the provider mounts recorded on the identity, what
each one replicates, and the mounts this app has not connected yet.
-->
<script lang="ts">
  import { I18N_KEYS } from "../../../../generated/i18n-keys";
  import { onMount } from "svelte";
  import { Cloud, RefreshCw } from "@lucide/svelte";
  import type { IdentityMountView } from "$app-wasm";
  import { Button } from "$lib/components/ui/button";
  import type { VaultState } from "$lib/vault.svelte";
  import { IdentityMountPresentation } from "./identity-mount";

  let { vault }: { vault: VaultState } = $props();

  const control = $derived(vault.identityControl);
  const mounts = $derived.by(() => {
    const snapshot = control.snapshot;
    return snapshot === false ? [] : snapshot.mounts;
  });
  const unconnected = $derived(mounts.filter((mount) => !mount.connectedHere));

  function coverage(mount: IdentityMountView): string {
    const presentation = new IdentityMountPresentation(mount);
    if (presentation.isICloud()) return vault.t(I18N_KEYS.IdentityControlMountIcloud);
    const vaultId = presentation.legacyVaultId();
    if (vaultId === false) return vault.t(I18N_KEYS.IdentityControlMountNamespaced);
    const legacyArgs: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.IdentityControlMountLegacy,
      replacements: { vault: vaultId },
    };
    return vault.t(legacyArgs);
  }

  async function syncNow() {
    const synced = await control.syncWithMounts();
    if (synced.isErr()) vault.errorMsg = vault.t(synced.error.translationKey);
  }

  onMount(() => {
    void control.refresh().then((refreshed) => {
      if (refreshed.isErr())
        vault.errorMsg = vault.t(refreshed.error.translationKey);
    });
  });
</script>

<section class="space-y-3" data-testid="identity-mounts-panel">
  <div class="flex items-start justify-between gap-3">
    <div class="space-y-1">
      <h3 class="text-sm font-semibold text-foreground">
        {vault.t(I18N_KEYS.IdentityControlSyncTitle)}
      </h3>
      <p class="text-xs text-muted-foreground text-pretty">
        {vault.t(I18N_KEYS.IdentityControlSyncDescription)}
      </p>
    </div>
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={control.busy}
      data-testid="identity-mounts-sync-btn"
      onclick={() => void syncNow()}
    >
      <RefreshCw class="size-3.5 {control.busy ? 'animate-spin' : ''}" />
      {vault.t(I18N_KEYS.IdentityControlSyncNow)}
    </Button>
  </div>

  {#if mounts.length === 0}
    <p class="text-xs text-muted-foreground" data-testid="identity-mounts-empty">
      {vault.t(I18N_KEYS.IdentityControlNoMounts)}
    </p>
  {:else}
    <ul class="space-y-2" data-testid="identity-mounts-list">
      {#each mounts as mount (mount.mountId)}
        <li
          class="flex items-start gap-3 rounded-lg border border-border/50 bg-background/60 p-3"
          data-testid="identity-mount-row"
          data-mount-id={mount.mountId}
        >
          <Cloud class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div class="min-w-0 space-y-0.5">
            <p class="truncate text-sm text-foreground">{mount.target}</p>
            <p
              class="text-xs text-muted-foreground"
              data-testid="identity-mount-coverage"
            >
              {coverage(mount)}
            </p>
          </div>
        </li>
      {/each}
    </ul>
  {/if}

  {#if unconnected.length > 0}
    <div
      class="nk-banner nk-banner-warning space-y-1 p-3 text-sm text-foreground"
      data-testid="identity-unconnected-mounts"
    >
      <p class="font-medium">
        {vault.t(I18N_KEYS.IdentityControlMountUnconnectedTitle)}
      </p>
      <p class="text-xs text-muted-foreground">
        {vault.t(I18N_KEYS.IdentityControlMountUnconnectedDescription)}
      </p>
      <ul class="text-xs">
        {#each unconnected as mount (mount.mountId)}
          <li class="truncate">{mount.target}</li>
        {/each}
      </ul>
    </div>
  {/if}
</section>
