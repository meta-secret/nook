<script lang="ts">
  import {
    ArrowLeftRight,
    ArrowRight,
    Cloud,
    Laptop,
    LockKeyhole,
    Monitor,
    Smartphone,
  } from '@lucide/svelte'
  import { DeviceProtectionStatus } from '$app-wasm'
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import { Button } from '$lib/components/ui/button'
  import type { VaultState } from '$lib/vault.svelte'
  import { FirstRunActions } from '$lib/vault/first-run'
  import { FirstRunPlace, FirstRunStage } from '$lib/vault/state/ui.svelte'
  import FirstRunBackLink from './FirstRunBackLink.svelte'
  import FirstRunMilestone from './FirstRunMilestone.svelte'

  let { vault }: { vault: VaultState } = $props()

  const actions = $derived(new FirstRunActions(vault))
</script>

<section
  class="mx-auto grid w-full max-w-md gap-6 py-6 sm:py-10"
  data-testid="first-run-storage-step"
>
  <div class="grid gap-4">
    <FirstRunBackLink
      {vault}
      testId="first-run-storage-back"
      disabled={vault.isVerifying}
      onBack={() => (vault.firstRun = FirstRunStage.Off)}
    />
    {#if vault.deviceProtectionReady}
      <FirstRunMilestone
        label={vault.t(
          vault.deviceProtectionLockedStatus === DeviceProtectionStatus.Passkey
            ? I18N_KEYS.FirstRunPasskeyReady
            : I18N_KEYS.FirstRunProtectionReady,
        )}
      />
    {/if}
  </div>

  <header class="space-y-2 text-center">
    <h1
      class="text-[1.75rem] leading-tight font-semibold tracking-[-0.02em] text-balance text-foreground"
    >
      {vault.t(I18N_KEYS.FirstRunStorageTitle)}
    </h1>
    <p class="text-sm leading-relaxed text-pretty text-muted-foreground">
      {vault.t(I18N_KEYS.FirstRunStorageBody)}
    </p>
  </header>

  <div class="routes grid gap-3">
    <Button
      type="button"
      variant="default"
      class="device-sync grid h-auto w-full justify-stretch gap-3 px-4 py-3.5 text-left text-base font-semibold whitespace-normal"
      aria-labelledby="first-run-cloud-action"
      aria-describedby="first-run-cloud-description"
      data-testid="first-run-choose-sync"
      disabled={vault.isVerifying}
      onclick={() => (vault.firstRun = FirstRunStage.Sync)}
    >
      <span class="flex w-full items-center justify-between gap-3">
        <span id="first-run-cloud-action"
          >{vault.t(I18N_KEYS.FirstRunChooseSync)}</span
        >
        <ArrowRight class="size-4 shrink-0" aria-hidden="true" />
      </span>
      <span aria-hidden="true" class="connection">
        <Smartphone class="device" />
        <ArrowLeftRight class="link" />
        <span class="cloud">
          <span class="cloud-chip">
            <Cloud class="cloud-glyph" />
            <LockKeyhole class="lock" />
          </span>
          <span>{vault.t(I18N_KEYS.FirstRunLocalFirstStorage)}</span>
        </span>
        <ArrowLeftRight class="link" />
        <Laptop class="device" />
      </span>
    </Button>
    <Button
      type="button"
      variant="outline"
      class="h-auto min-h-12 w-full justify-start gap-3 px-4 py-3 text-left whitespace-normal"
      data-testid="first-run-keep-local"
      disabled={vault.isVerifying}
      onclick={() => actions.nameNew(FirstRunPlace.ThisBrowser)}
    >
      <Monitor class="size-4 shrink-0" aria-hidden="true" />
      <span>{vault.t(I18N_KEYS.FirstRunKeepLocal)}</span>
    </Button>
  </div>
  <span id="first-run-cloud-description" class="sr-only">
    {vault.t(I18N_KEYS.FirstRunCloudActionDescription)}
  </span>
</section>

<style>
  .connection {
    display: grid;
    grid-template-columns: auto minmax(1rem, 2.5rem) auto minmax(
        1rem,
        2.5rem
      ) auto;
    align-items: center;
    justify-content: center;
    gap: clamp(0.45rem, 2.5vw, 0.875rem);
    border-top: 1px solid color-mix(in oklch, currentColor 20%, transparent);
    padding-top: 0.75rem;
  }

  .connection :global(svg.device) {
    width: 1.375rem;
    height: 1.375rem;
    opacity: 0.9;
  }

  .connection :global(svg.link) {
    justify-self: center;
    width: 1rem;
    height: 1rem;
    color: color-mix(in oklch, currentColor 68%, transparent);
  }

  .cloud {
    display: grid;
    justify-items: center;
    gap: 0.25rem;
    text-align: center;
    font-family: var(--font-mono);
    font-size: 0.6875rem;
    font-weight: 500;
    letter-spacing: 0.04em;
    line-height: 1.2;
    color: color-mix(in oklch, currentColor 88%, transparent);
  }

  .cloud-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.2rem 0.45rem;
    border: 1px solid color-mix(in oklch, currentColor 26%, transparent);
    background: color-mix(in oklch, currentColor 9%, transparent);
  }

  .cloud-chip :global(svg.cloud-glyph) {
    width: 1rem;
    height: 1rem;
  }

  .cloud-chip :global(svg.lock) {
    width: 0.75rem;
    height: 0.75rem;
    opacity: 0.85;
  }
</style>
