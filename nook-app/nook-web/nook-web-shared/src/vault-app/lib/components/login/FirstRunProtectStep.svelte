<!-- Set up or unlock protection before choosing storage. -->
<script lang="ts">
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import DeviceProtectionGate from '$lib/components/DeviceProtectionGate.svelte'
  import { DeviceProtectionGateFrame } from '$lib/components/device-protection-gate-state'
  import FirstRunBackLink from './FirstRunBackLink.svelte'
  import type { VaultState } from '$lib/vault.svelte'

  let {
    vault,
    onBack,
  }: {
    vault: VaultState
    /** Return to the first screen; nothing was made yet. */
    onBack: () => void
  } = $props()
</script>

<section
  class="mx-auto grid w-full max-w-md gap-6 py-6 sm:py-10"
  data-testid="first-run-protect-step"
>
  <FirstRunBackLink
    {vault}
    testId="first-run-back"
    disabled={vault.isVerifying}
    {onBack}
  />

  <header class="space-y-2 text-center">
    <h1
      class="text-[1.75rem] leading-tight font-semibold tracking-[-0.02em] text-balance text-foreground"
    >
      {vault.t(I18N_KEYS.FirstRunProtectTitle)}
    </h1>
    <p class="text-sm leading-relaxed text-pretty text-muted-foreground">
      {vault.t(I18N_KEYS.FirstRunProtectBody)}
    </p>
  </header>

  <DeviceProtectionGate
    {vault}
    frame={DeviceProtectionGateFrame.Embedded}
    creationOnly={false}
    initializeSession={true}
    recoveryAppId={vault.deviceId}
    onBeforeProtectionAction={() => {}}
    onProtectionReady={() => {}}
  />
</section>
