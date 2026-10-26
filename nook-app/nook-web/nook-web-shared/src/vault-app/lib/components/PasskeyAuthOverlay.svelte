<script lang="ts">
  import { I18N_KEYS } from '../../../generated/i18n-keys'
  import BackButton from '$lib/components/workspace/BackButton.svelte'
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

  function handleBeforeProtectionAction(): void {}

  function portal(node: HTMLElement) {
    const anchor = document.createComment('passkey-auth-overlay-home')
    node.before(anchor)
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
      <div class="absolute top-3 left-3 z-10">
        <BackButton
          label={vault.t(I18N_KEYS.CommonBack)}
          testId="passkey-auth-overlay-dismiss"
          onBack={onDismiss}
        />
      </div>
    {/if}
    <DeviceProtectionGate
      {vault}
      frame={DeviceProtectionGateFrame.SetupStep}
      creationOnly={false}
      initializeSession={true}
      recoveryAppId={vault.deviceId}
      onBeforeProtectionAction={handleBeforeProtectionAction}
      onProtectionReady={handleProtectionReady}
    />
  </div>
</div>
