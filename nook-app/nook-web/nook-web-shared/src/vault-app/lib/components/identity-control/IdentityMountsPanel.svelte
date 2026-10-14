<!--
Identity part of the Sync page. The provider list below it already shows the
mounts this app connected, so this adds only what that list cannot: mounts
recorded on the identity but not connected here. Identity sync itself sits
with Devices, where its results (join requests) show.
-->
<script lang="ts">
  import { I18N_KEYS } from "../../../../generated/i18n-keys";
  import { onMount } from "svelte";
  import type { IdentityMountView } from "$app-wasm";
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

  onMount(() => {
    void control.refresh().then((refreshed) => {
      if (refreshed.isErr())
        vault.errorMsg = vault.t(refreshed.error.translationKey);
    });
  });
</script>

{#if unconnected.length > 0}
  <div
    class="nk-banner nk-banner-warning mt-4 space-y-1 p-3 text-sm text-foreground"
    data-testid="identity-unconnected-mounts"
  >
    <p class="font-medium">
      {vault.t(I18N_KEYS.IdentityControlMountUnconnectedTitle)}
    </p>
    <p class="text-xs text-muted-foreground">
      {vault.t(I18N_KEYS.IdentityControlMountUnconnectedDescription)}
    </p>
    <ul class="space-y-0.5 text-xs">
      {#each unconnected as mount (mount.mountId)}
        <li class="truncate" data-testid="identity-mount-row">
          {mount.target}
          <span class="text-muted-foreground">· {coverage(mount)}</span>
        </li>
      {/each}
    </ul>
  </div>
{/if}
