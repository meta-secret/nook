<!--
Background work of an open identity (sync, vault changes). It runs WASM
encryption on the main thread, so the page can pause; this line says so
while it runs instead of leaving a still page that looks frozen.
-->
<script lang="ts">
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import { RefreshCw } from '@lucide/svelte'
  import type { VaultState } from '$lib/vault.svelte'
  import {
    VaultActivity,
    VaultActivityKind,
    type VaultActivityFlags,
  } from '$lib/vault/vault-activity'

  let { vault }: { vault: VaultState } = $props()

  const activity = $derived.by(() => {
    const flags: VaultActivityFlags = {
      isVerifying: vault.isVerifying,
      isSaving: vault.isSaving,
      isSyncing: vault.isSyncing,
    }
    return new VaultActivity(flags)
  })
</script>

{#if activity.kind !== VaultActivityKind.Idle}
  <div
    class="grid gap-1.5 px-4 pb-4 sm:px-5"
    role="status"
    aria-live="polite"
    aria-busy="true"
    data-testid="identity-vault-activity"
    data-activity={activity.kind}
  >
    <p class="flex items-center gap-2 text-xs text-foreground">
      <RefreshCw
        class="size-3.5 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none"
        aria-hidden="true"
      />
      {vault.t(activity.titleKey)}
    </p>
    <span class="nk-progress-sweep" aria-hidden="true"></span>
    <p class="text-[11px] text-pretty text-muted-foreground">
      {vault.t(I18N_KEYS.WorkspaceVaultActivityHint)}
    </p>
  </div>
{/if}
