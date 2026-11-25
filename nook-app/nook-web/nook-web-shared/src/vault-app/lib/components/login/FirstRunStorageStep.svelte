<script lang="ts">
  import { Cloud, LockKeyhole, Monitor } from "@lucide/svelte";
  import { DeviceProtectionStatus } from "$app-wasm";
  import { I18N_KEYS } from "../../../../generated/i18n-keys";
  import { Button } from "$lib/components/ui/button";
  import type { VaultState } from "$lib/vault.svelte";
  import { FirstRunActions } from "$lib/vault/first-run";
  import { FirstRunPlace, FirstRunStage } from "$lib/vault/state/ui.svelte";
  import FirstRunBackLink from "./FirstRunBackLink.svelte";
  import FirstRunMilestone from "./FirstRunMilestone.svelte";

  let { vault }: { vault: VaultState } = $props();

  const actions = $derived(new FirstRunActions(vault));
</script>

<section
  class="mx-auto grid w-full max-w-md gap-6 py-6 sm:py-10"
  data-testid="first-run-storage-step"
>
  <FirstRunBackLink
    {vault}
    testId="first-run-storage-back"
    disabled={vault.isVerifying}
    onBack={() => (vault.firstRun = FirstRunStage.Off)}
  />
  <header class="grid gap-3">
    {#if vault.deviceProtectionReady}
      <FirstRunMilestone
        label={vault.t(
          vault.deviceProtectionLockedStatus === DeviceProtectionStatus.Passkey
            ? I18N_KEYS.FirstRunPasskeyReady
            : I18N_KEYS.FirstRunProtectionReady,
        )}
      />
    {/if}
    <h1
      class="text-[1.75rem] leading-tight font-semibold tracking-[-0.02em] text-balance text-foreground"
    >
      {vault.t(I18N_KEYS.FirstRunStorageTitle)}
    </h1>
  </header>
  <div class="grid gap-3">
    <Button
      type="button"
      class="h-auto min-h-16 justify-start gap-4 px-4 py-3 text-left whitespace-normal"
      data-testid="first-run-keep-local"
      disabled={vault.isVerifying}
      onclick={() => actions.nameNew(FirstRunPlace.ThisBrowser)}
    >
      <span class="action-icon" aria-hidden="true">
        <Monitor />
        <LockKeyhole class="badge" />
      </span>
      {vault.t(I18N_KEYS.FirstRunKeepLocal)}
    </Button>
    <Button
      type="button"
      variant="outline"
      class="h-auto min-h-16 justify-start gap-4 px-4 py-3 text-left whitespace-normal"
      aria-labelledby="first-run-cloud-action"
      aria-describedby="first-run-cloud-description"
      data-testid="first-run-choose-sync"
      disabled={vault.isVerifying}
      onclick={() => (vault.firstRun = FirstRunStage.Sync)}
    >
      <span class="action-icon" aria-hidden="true">
        <Cloud />
        <LockKeyhole class="badge" />
      </span>
      <span class="grid min-w-0 gap-0.5">
        <span id="first-run-cloud-action"
          >{vault.t(I18N_KEYS.FirstRunChooseSync)}</span
        >
        <span class="text-xs text-muted-foreground"
          >{vault.t(I18N_KEYS.FirstRunCloudDeviceCue)}</span
        >
      </span>
    </Button>
  </div>
  <span id="first-run-cloud-description" class="sr-only">
    {vault.t(I18N_KEYS.FirstRunCloudActionDescription)}
  </span>
</section>

<style>
  .action-icon {
    position: relative;
    display: grid;
    width: 1.75rem;
    height: 1.75rem;
    flex-shrink: 0;
    place-items: center;
  }
  .action-icon :global(svg) {
    width: 1.6rem;
    height: 1.6rem;
  }
  .action-icon :global(svg.badge) {
    position: absolute;
    right: -0.15rem;
    bottom: 0;
    width: 0.85rem;
    height: 0.85rem;
    stroke-width: 2.25;
    fill: var(--color-background);
  }
</style>
