<!--
Second step of the first-vault setup. This is where the identity is
introduced: the passkey made here protects the identity, and the identity
opens the vault named on the first screen. The card below is a preview of the
identity card the hub will show once setup finishes.
-->
<script lang="ts">
  import { ArrowLeft } from "@lucide/svelte";
  import { I18N_KEYS } from "../../../../generated/i18n-keys";
  import { Button } from "$lib/components/ui/button";
  import DeviceProtectionGate from "$lib/components/DeviceProtectionGate.svelte";
  import { DeviceProtectionGateFrame } from "$lib/components/device-protection-gate-state";
  import IdentityCard from "$lib/components/identities/IdentityCard.svelte";
  import {
    IdentityCardStatus,
    IdentityKeyKind,
    IdentityVaultRowState,
    type IdentityCardView,
  } from "$lib/components/identities/identity-card-model";
  import FirstRunProgress from "./FirstRunProgress.svelte";
  import type { VaultState } from "$lib/vault.svelte";
  import { FirstRunStage } from "$lib/vault/state/ui.svelte";

  let {
    vault,
    onBack,
  }: {
    vault: VaultState;
    /** Return to the naming screen; the pending vault is dropped. */
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
      vaults: [
        {
          storeId: "first-run-preview",
          label: vault.firstRunVaultName,
          state: IdentityVaultRowState.Available,
        },
      ],
    };
    return view;
  });
  const body = $derived.by(() => {
    const bodyRequest: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.FirstRunProtectBody,
      replacements: { vault: vault.firstRunVaultName },
    };
    return vault.t(bodyRequest);
  });
</script>

<section
  class="mx-auto grid w-full max-w-4xl gap-6 py-6 sm:py-10"
  data-testid="first-run-protect-step"
>
  <div class="flex items-center gap-3">
    <Button
      type="button"
      variant="ghost"
      size="icon"
      class="-ml-2 size-9 shrink-0"
      aria-label={vault.t(I18N_KEYS.FirstRunBack)}
      title={vault.t(I18N_KEYS.FirstRunBack)}
      data-testid="first-run-back"
      disabled={vault.isVerifying}
      onclick={onBack}
    >
      <ArrowLeft class="size-4" />
    </Button>
    <div class="min-w-0 flex-1">
      <FirstRunProgress {vault} current={FirstRunStage.Protect} />
    </div>
  </div>

  <div class="space-y-2">
    <h1 class="text-[1.75rem] leading-tight font-semibold tracking-[-0.02em] text-foreground">
      {vault.t(I18N_KEYS.FirstRunProtectTitle)}
    </h1>
    <p class="max-w-[60ch] text-sm text-pretty text-muted-foreground">
      {body}
    </p>
  </div>

  <div class="grid items-start gap-8 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
    <figure class="m-0 grid min-w-0 gap-2" aria-label={vault.t(I18N_KEYS.FirstRunPreviewLabel)}>
      <figcaption class="nk-label">
        {vault.t(I18N_KEYS.FirstRunPreviewLabel)}
      </figcaption>
      <div class="min-w-0" inert data-testid="first-run-identity-preview">
        <IdentityCard
          {vault}
          card={preview}
          onOpenVault={() => {}}
          onManage={() => {}}
        />
      </div>
    </figure>
    <div class="grid min-w-0 gap-3">
      <p class="text-sm font-medium text-foreground">
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
