<script lang="ts">
  import { ArrowLeftRight, ArrowRight, Cloud, Laptop, LockKeyhole, Monitor, Smartphone } from "@lucide/svelte";
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
  <div class="routes grid gap-3">
    <Button
      type="button"
      class="device-sync"
      aria-labelledby="first-run-cloud-action"
      aria-describedby="first-run-cloud-description"
      data-testid="first-run-choose-sync"
      disabled={vault.isVerifying}
      onclick={() => (vault.firstRun = FirstRunStage.Sync)}
    >
      <span class="flex w-full items-center justify-between gap-3">
        <span id="first-run-cloud-action">{vault.t(I18N_KEYS.FirstRunChooseSync)}</span>
        <ArrowRight aria-hidden="true" />
      </span>
      <span aria-hidden="true" class="connection">
        <Smartphone class="device" />
        <ArrowLeftRight class="link" />
        <span class="cloud">
          <span class="cloud-icon"><Cloud /><LockKeyhole class="lock" /></span>
          <span>{vault.t(I18N_KEYS.FirstRunLocalFirstStorage)}</span>
        </span>
        <ArrowLeftRight class="link" />
        <Laptop class="device" />
      </span>
    </Button>
    <Button
      type="button"
      variant="outline"
      class="min-h-12 h-auto justify-start gap-3 px-4 py-3 text-left whitespace-normal"
      data-testid="first-run-keep-local"
      disabled={vault.isVerifying}
      onclick={() => actions.nameNew(FirstRunPlace.ThisBrowser)}
    >
      <Monitor aria-hidden="true" />
      {vault.t(I18N_KEYS.FirstRunKeepLocal)}
    </Button>
  </div>
  <span id="first-run-cloud-description" class="sr-only">
    {vault.t(I18N_KEYS.FirstRunCloudActionDescription)}
  </span>
</section>

<style>
  .routes :global(.device-sync) {
    display: grid;
    height: auto;
    justify-content: stretch;
    gap: 0.8rem;
    padding: 0.95rem 1.1rem;
    border: 1px solid #74af99;
    background: #99e7c8;
    color: #092c23;
    text-align: left;
    font-size: 1.05rem;
    font-weight: 650;
    white-space: normal;
  }
  .routes :global(.device-sync:hover) {
    background: #b1f0d7;
  }
  .connection {
    display: grid;
    grid-template-columns: auto minmax(1rem, 2.75rem) auto minmax(1rem, 2.75rem) auto;
    align-items: start;
    justify-content: center;
    gap: clamp(0.45rem, 2.5vw, 1rem);
    border-top: 1px solid #38685455;
    padding-top: 0.7rem;
  }
  .connection :global(svg.device),
  .cloud-icon :global(svg) {
    width: 1.7rem;
    height: 1.7rem;
  }
  .connection :global(svg.link) {
    align-self: start;
    justify-self: center;
    width: 1.15rem;
    height: 1.7rem;
    color: #235d49;
  }
  .cloud {
    display: grid;
    justify-items: center;
    gap: 0.25rem;
    text-align: center;
    font-size: 0.8rem;
    font-weight: 550;
    line-height: 1.2;
  }
  .cloud-icon {
    position: relative;
  }
  .cloud-icon :global(svg.lock) {
    position: absolute;
    bottom: 0;
    right: -0.2rem;
    width: 0.85rem;
    height: 0.85rem;
    fill: #99e7c8;
  }
</style>
