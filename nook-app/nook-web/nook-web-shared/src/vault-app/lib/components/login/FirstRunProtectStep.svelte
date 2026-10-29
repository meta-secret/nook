<!--
First step of setup: a new passkey, or one made for Nook before, makes this
browser's key. One line and a small diagram say what it is for: the passkey
opens the identity, which holds the vaults. No vault exists yet; the sync
provider comes next and shows the identities that key belongs to.
-->
<script lang="ts">
  import { I18N_KEYS } from "../../../../generated/i18n-keys";
  import DeviceProtectionGate from "$lib/components/DeviceProtectionGate.svelte";
  import { DeviceProtectionGateFrame } from "$lib/components/device-protection-gate-state";
  import FirstRunBackLink from "./FirstRunBackLink.svelte";
  import FirstRunDiagram from "./FirstRunDiagram.svelte";
  import { firstRunKeyDiagram } from "./first-run-diagram";
  import FirstRunProgress from "./FirstRunProgress.svelte";
  import type { VaultState } from "$lib/vault.svelte";
  import { FirstRunStage } from "$lib/vault/state/ui.svelte";

  let {
    vault,
    onBack,
  }: {
    vault: VaultState;
    /** Return to the first screen; nothing was made yet. */
    onBack: () => void;
  } = $props();

  const diagram = $derived(firstRunKeyDiagram(vault));
</script>

<section
  class="mx-auto grid w-full max-w-md gap-6 py-6 sm:py-10"
  data-testid="first-run-protect-step"
>
  <div class="grid gap-4">
    <FirstRunBackLink
      {vault}
      testId="first-run-back"
      disabled={vault.isVerifying}
      {onBack}
    />
    <FirstRunProgress {vault} current={FirstRunStage.Protect} />
  </div>

  <div class="space-y-2 text-center">
    <h1
      class="text-[1.75rem] leading-tight font-semibold tracking-[-0.02em] text-foreground"
    >
      {vault.t(I18N_KEYS.FirstRunProtectTitle)}
    </h1>
    <p class="text-sm text-pretty text-muted-foreground">
      {vault.t(I18N_KEYS.FirstRunProtectBody)}
    </p>
  </div>

  <FirstRunDiagram {diagram} />

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
