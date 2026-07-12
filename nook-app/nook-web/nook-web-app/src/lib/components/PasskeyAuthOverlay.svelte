<script lang="ts">
  import type { VaultState } from '$lib/vault.svelte'
  import DeviceProtectionGate from '$lib/components/DeviceProtectionGate.svelte'

  let {
    vault,
    onDismiss,
  }: {
    vault: VaultState
    onDismiss?: () => void
  } = $props()
</script>

<div
  class="fixed top-16 right-4 z-50 w-[min(100vw-2rem,22rem)] animate-in fade-in slide-in-from-top-2 duration-200"
  data-testid="passkey-auth-overlay"
  role="dialog"
  aria-modal="true"
  aria-label={vault.t('device_protection.title')}
>
  <div
    class="rounded-xl border border-border/60 bg-background/95 p-1 shadow-xl shadow-black/25 backdrop-blur-md"
  >
    <DeviceProtectionGate {vault} />
    {#if onDismiss}
      <div class="px-3 pb-3">
        <button
          type="button"
          class="w-full rounded-md border border-border/50 bg-background px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          data-testid="passkey-auth-overlay-dismiss"
          onclick={onDismiss}
        >
          {vault.t('common.back')}
        </button>
      </div>
    {/if}
  </div>
</div>
