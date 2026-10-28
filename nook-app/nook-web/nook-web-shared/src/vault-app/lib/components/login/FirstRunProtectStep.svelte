<!--
First step of setup, where the identity is introduced: a new passkey, or one
made for Nook before, makes this browser's key. No vault exists yet; the
sync provider comes next and shows the identities that key belongs to. The
card below is a preview of the identity card the hub will show.
-->
<script lang="ts">
  import { KeyRound } from "@lucide/svelte";
  import { I18N_KEYS } from "../../../../generated/i18n-keys";
  import DeviceProtectionGate from "$lib/components/DeviceProtectionGate.svelte";
  import { DeviceProtectionGateFrame } from "$lib/components/device-protection-gate-state";
  import IdentityCard from "$lib/components/identities/IdentityCard.svelte";
  import {
    IdentityCardStatus,
    IdentityKeyKind,
    type IdentityCardView,
  } from "$lib/components/identities/identity-card-model";
  import FirstRunBackLink from "./FirstRunBackLink.svelte";
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

  /** Hue of the preview monogram; the real card derives its own. */
  const PREVIEW_HUE = 285;

  const identityLabel = $derived.by(() => {
    const labelRequest: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.DevicesAccessIdentityDefaultLabel,
      replacements: { count: "1" },
    };
    return vault.t(labelRequest);
  });
  const preview = $derived.by((): IdentityCardView => {
    const view: IdentityCardView = {
      identityId: "first-run-preview",
      label: identityLabel,
      monogram: identityLabel.charAt(0).toUpperCase(),
      hue: PREVIEW_HUE,
      fingerprint: [],
      keyCount: 1,
      keyKind: IdentityKeyKind.Passkey,
      status: IdentityCardStatus.Locked,
      current: true,
      vaults: [],
    };
    return view;
  });
  const body = $derived(vault.t(I18N_KEYS.FirstRunProtectBody));
</script>

<section
  class="mx-auto grid w-full max-w-4xl gap-6 py-6 sm:py-10"
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

  <div class="space-y-2">
    <h1
      class="text-[1.75rem] leading-tight font-semibold tracking-[-0.02em] text-foreground"
    >
      {vault.t(I18N_KEYS.FirstRunProtectTitle)}
    </h1>
    <p class="max-w-[60ch] text-sm text-pretty text-muted-foreground">
      {body}
    </p>
  </div>

  <div
    class="grid items-start gap-6 sm:gap-8 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]"
  >
    <figure
      class="m-0 grid min-w-0 gap-2"
      aria-label={vault.t(I18N_KEYS.FirstRunPreviewLabel)}
    >
      <figcaption class="nk-label nk-lockup">
        {vault.t(I18N_KEYS.FirstRunPreviewLabel)}
      </figcaption>
      <div class="min-w-0" inert data-testid="first-run-identity-preview">
        <IdentityCard
          {vault}
          card={preview}
          preview
          onOpenVault={() => {}}
        />
      </div>
    </figure>
    <div class="grid min-w-0 gap-3 max-lg:order-first">
      <p class="flex items-center gap-2 text-sm font-medium text-foreground">
        <KeyRound
          class="size-4 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        {vault.t(I18N_KEYS.FirstRunProtectHint)}
      </p>
      <DeviceProtectionGate
        {vault}
        frame={DeviceProtectionGateFrame.Embedded}
        creationOnly={false}
        initializeSession={true}
        recoveryAppId={vault.deviceId}
        onBeforeProtectionAction={() => {}}
        onProtectionReady={() => {}}
      />
    </div>
  </div>
</section>
