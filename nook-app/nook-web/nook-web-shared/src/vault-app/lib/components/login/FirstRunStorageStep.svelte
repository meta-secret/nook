<script lang="ts">
  import { Cloud, CloudUpload, KeyRound, MonitorSmartphone } from '@lucide/svelte'
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
    <ul class="grid gap-2 text-sm leading-5 text-muted-foreground">
      <li class="flex items-start gap-2.5">
        <CloudUpload class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>{vault.t(I18N_KEYS.FirstRunBackupBenefit)}</span>
      </li>
      <li class="flex items-start gap-2.5">
        <KeyRound class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>{vault.t(I18N_KEYS.FirstRunDeviceAccessBenefit)}</span>
      </li>
    </ul>
  </header>
  <div class="grid gap-3">
    <Button
      type="button"
      class="min-h-11 h-auto whitespace-normal"
      data-testid="first-run-keep-local"
      disabled={vault.isVerifying}
      onclick={() => actions.nameNew(FirstRunPlace.ThisBrowser)}
    >
      <MonitorSmartphone class="size-4" aria-hidden="true" />
      {vault.t(I18N_KEYS.FirstRunKeepLocal)}
    </Button>
    <Button
      type="button"
      variant="outline"
      class="min-h-11 h-auto whitespace-normal"
      data-testid="first-run-choose-sync"
      disabled={vault.isVerifying}
      onclick={() => (vault.firstRun = FirstRunStage.Sync)}
    >
      <Cloud class="size-4" aria-hidden="true" />
      {vault.t(I18N_KEYS.FirstRunChooseSync)}
    </Button>
  </div>
</section>
