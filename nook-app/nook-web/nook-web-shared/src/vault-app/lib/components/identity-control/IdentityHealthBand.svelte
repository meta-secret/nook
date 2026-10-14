<!--
Day-2 health of the identity, as assessed by nook-core: where it stands and
the single step that protects it most. Shown at the top of identity
management; it disappears once nothing is missing.
-->
<script lang="ts">
  import { Cloud, Copy, MonitorSmartphone } from '@lucide/svelte'
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import { Button } from '$lib/components/ui/button'
  import { StatusTag, StatusTone } from '$lib/components/ui/status-tag'
  import {
    NookIdentityHealthStage,
    NookIdentityNextStep,
    type NookIdentityHealth,
  } from '$app-wasm'
  import type { VaultState } from '$lib/vault.svelte'

  let {
    vault,
    health,
    onAddSyncProvider,
    onAddDevice,
    actionShown = true,
  }: {
    vault: VaultState
    health: NookIdentityHealth
    onAddSyncProvider: () => void
    onAddDevice: () => void
    /** Off on the page the step leads to: that page offers the action. */
    actionShown?: boolean
  } = $props()

  const stage = $derived(health.stage)
  const nextStep = $derived(health.nextStep)
  const stageLabel = $derived(
    stage === NookIdentityHealthStage.LocalOnly
      ? vault.t(I18N_KEYS.IdentityHealthStageLocalOnly)
      : stage === NookIdentityHealthStage.CopyKept
        ? vault.t(I18N_KEYS.IdentityHealthStageCopyKept)
        : vault.t(I18N_KEYS.IdentityHealthStageMultiDevice),
  )
  const stageTone = $derived(
    stage === NookIdentityHealthStage.LocalOnly
      ? StatusTone.Warning
      : stage === NookIdentityHealthStage.CopyKept
        ? StatusTone.Neutral
        : StatusTone.Success,
  )
</script>

{#if nextStep !== NookIdentityNextStep.Done}
  <section
    class="border border-border"
    aria-label={vault.t(I18N_KEYS.IdentityHealthLabel)}
    data-testid="identity-health-band"
    data-stage={NookIdentityHealthStage[stage]}
    data-next-step={NookIdentityNextStep[nextStep]}
  >
    <div
      class="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5"
    >
      <span class="nk-label">{vault.t(I18N_KEYS.IdentityHealthLabel)}</span>
      <StatusTag
        tone={stageTone}
        label={stageLabel}
        testId="identity-health-stage"
      />
    </div>
    <div
      class="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <div class="flex min-w-0 items-start gap-3">
        <span class="nk-tile shrink-0" aria-hidden="true">
          {#if nextStep === NookIdentityNextStep.AddSyncProvider}
            <Copy class="size-4" />
          {:else if nextStep === NookIdentityNextStep.AddCloudProvider}
            <Cloud class="size-4" />
          {:else}
            <MonitorSmartphone class="size-4" />
          {/if}
        </span>
        <div class="min-w-0 space-y-1">
          <p class="text-sm font-semibold text-foreground">
            {#if nextStep === NookIdentityNextStep.AddSyncProvider}
              {vault.t(I18N_KEYS.IdentityHealthSyncTitle)}
            {:else if nextStep === NookIdentityNextStep.AddCloudProvider}
              {vault.t(I18N_KEYS.IdentityHealthCloudTitle)}
            {:else}
              {vault.t(I18N_KEYS.IdentityHealthDeviceTitle)}
            {/if}
          </p>
          <p class="text-xs leading-relaxed text-pretty text-muted-foreground">
            {#if nextStep === NookIdentityNextStep.AddSyncProvider}
              {vault.t(I18N_KEYS.IdentityHealthSyncBody)}
            {:else if nextStep === NookIdentityNextStep.AddCloudProvider}
              {vault.t(I18N_KEYS.IdentityHealthCloudBody)}
            {:else}
              {vault.t(I18N_KEYS.IdentityHealthDeviceBody)}
            {/if}
          </p>
        </div>
      </div>
      {#if actionShown && nextStep === NookIdentityNextStep.AddDevice}
        <Button
          type="button"
          size="sm"
          variant="outline"
          class="shrink-0 self-start border-border sm:self-center"
          data-testid="identity-health-action"
          onclick={onAddDevice}
        >
          {vault.t(I18N_KEYS.IdentityHealthDeviceCta)}
        </Button>
      {:else if actionShown}
        <Button
          type="button"
          size="sm"
          variant="outline"
          class="shrink-0 self-start border-border sm:self-center"
          data-testid="identity-health-action"
          onclick={onAddSyncProvider}
        >
          {nextStep === NookIdentityNextStep.AddSyncProvider
            ? vault.t(I18N_KEYS.IdentityHealthSyncCta)
            : vault.t(I18N_KEYS.IdentityHealthCloudCta)}
        </Button>
      {/if}
    </div>
  </section>
{/if}
