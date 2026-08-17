<script lang="ts">
  import { I18N_KEYS } from '../../../generated/i18n-keys'
  import { ArrowLeft } from '@lucide/svelte'
  import type { VaultState } from '$lib/vault.svelte'
  import DeviceProtectionGate from '$lib/components/DeviceProtectionGate.svelte'
  import { DeviceProtectionGateFrame } from '$lib/components/device-protection-gate-state'

  let {
    vault,
    onDismiss,
  }: {
    vault: VaultState
    onDismiss?: () => void
  } = $props()

  function handleProtectionReady(): void {}

  function portal(node: HTMLElement) {
    const anchor = document.createComment('passkey-auth-overlay-home')
    if (typeof node.before === 'function') {
      node.before(anchor)
    } else {
      node.parentNode?.insertBefore(anchor, node)
    }
    document.body.appendChild(node)
    return {
      destroy() {
        node.remove()
        anchor.remove()
      },
    }
  }
</script>

<div
  class="fixed top-16 right-4 z-50 w-[min(100vw-2rem,22rem)] animate-in fade-in slide-in-from-top-2 duration-200"
  data-testid="passkey-auth-overlay"
  role="dialog"
  aria-label={vault.t(I18N_KEYS.DeviceProtectionTitle)}
  use:portal
>
  <div
    class="relative max-h-[calc(100svh-5rem)] overflow-y-auto rounded-xl border border-border/60 bg-background/95 shadow-xl shadow-black/25 backdrop-blur-md"
  >
    {#if onDismiss}
      <button
        type="button"
        class="absolute top-3 left-3 z-10 grid size-8 place-items-center rounded-full text-muted-foreground transition hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-testid="passkey-auth-overlay-dismiss"
        aria-label={vault.t(I18N_KEYS.CommonBack)}
        onclick={onDismiss}
      >
        <ArrowLeft class="size-4" aria-hidden="true" />
      </button>
    {/if}
    <DeviceProtectionGate
      {vault}
      frame={DeviceProtectionGateFrame.SetupStep}
      onProtectionReady={handleProtectionReady}
    />
  </div>
</div>
