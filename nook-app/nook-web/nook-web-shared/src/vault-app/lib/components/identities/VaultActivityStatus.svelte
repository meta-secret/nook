<!--
Background work of an open identity (sync, vault changes). It runs WASM
encryption on the main thread, so the page can pause; while it runs, the
card's status says so in place of "Unlocked" and a progress line runs along
the header's foot. Nothing changes size, so the card never jumps when a
background sync starts or ends.
-->
<script lang="ts">
  import type { Snippet } from 'svelte'
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import { RefreshCw } from '@lucide/svelte'
  import type { VaultState } from '$lib/vault.svelte'
  import {
    VaultActivity,
    VaultActivityKind,
    type VaultActivityFlags,
  } from '$lib/vault/vault-activity'

  let {
    vault,
    idle,
  }: {
    vault: VaultState
    /** The status shown while no work runs. */
    idle: Snippet
  } = $props()

  const activity = $derived.by(() => {
    const flags: VaultActivityFlags = {
      isVerifying: vault.isVerifying,
      isSaving: vault.isSaving,
      isSyncing: vault.isSyncing,
    }
    return new VaultActivity(flags)
  })
</script>

{#if activity.kind === VaultActivityKind.Idle}
  {@render idle()}
{:else}
  <span
    class="nk-tag inline-flex items-center gap-1.5 text-foreground"
    role="status"
    aria-live="polite"
    aria-busy="true"
    title={vault.t(I18N_KEYS.WorkspaceVaultActivityHint)}
    data-testid="identity-vault-activity"
    data-activity={activity.kind}
  >
    <RefreshCw
      class="size-3 shrink-0 animate-spin motion-reduce:animate-none"
      aria-hidden="true"
    />
    {vault.t(activity.titleKey)}
    <span class="sr-only">{vault.t(I18N_KEYS.WorkspaceVaultActivityHint)}</span>
  </span>
  <span
    class="nk-progress-sweep absolute inset-x-0 bottom-0"
    aria-hidden="true"
  ></span>
{/if}
