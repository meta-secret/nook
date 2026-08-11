<script lang="ts">
  import { Cloud, ShieldCheck, Users } from '@lucide/svelte'
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import type { VaultState } from '$lib/vault.svelte'
  import { Button } from '$lib/components/ui/button'
  import {
    AdminAccordionSection,
    SettingsAccordionSection,
    SettingsSection,
  } from '$lib/vault/state/ui.svelte'

  let {
    vault,
    readyParticipants,
    requiredParticipants,
    compatibleProviderCount,
  }: {
    vault: VaultState
    readyParticipants: number
    requiredParticipants: number
    compatibleProviderCount: number
  } = $props()

  const hasCompatibleProviders = $derived(compatibleProviderCount > 0)
</script>

<div
  class="space-y-4 rounded-lg border border-primary/20 bg-primary/[0.04] p-4"
  data-testid="sentinel-onboard-guidance"
>
  <div class="flex items-start gap-3">
    <div
      class="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
      aria-hidden="true"
    >
      <Users class="size-4.5" />
    </div>
    <div class="min-w-0 space-y-1">
      <h3 class="text-sm font-semibold text-foreground">
        {vault.t(I18N_KEYS.OnboardDeviceSentinelTitle)}
      </h3>
      <p class="text-sm text-muted-foreground text-pretty">
        {vault.t(I18N_KEYS.OnboardDeviceSentinelNoPasswordDesc)}
      </p>
    </div>
  </div>

  <div
    class="rounded-md border border-border bg-background/70 px-3 py-2.5"
    data-testid="sentinel-participant-readiness"
  >
    <p class="text-xs font-medium text-muted-foreground">
      {vault.t(I18N_KEYS.OnboardDeviceSentinelReadinessLabel)}
    </p>
    <p class="mt-0.5 text-sm font-semibold text-foreground">
      {(() => { const translationRequest: Parameters<typeof vault.t>[0] = { key: I18N_KEYS.OnboardDeviceSentinelReadinessCount, replacements: {
        ready: String(readyParticipants),
        required: String(requiredParticipants),
      } }; return vault.t(translationRequest); })()}
    </p>
  </div>

  <ol class="space-y-3 text-sm text-foreground">
    <li class="flex gap-3">
      <span
        class="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground"
        >1</span
      >
      <span>{vault.t(I18N_KEYS.OnboardDeviceSentinelStepConnect)}</span>
    </li>
    <li class="flex gap-3">
      <span
        class="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground"
        >2</span
      >
      <span>{vault.t(I18N_KEYS.OnboardDeviceSentinelStepApprove)}</span>
    </li>
  </ol>

  <p
    class="text-xs {hasCompatibleProviders
      ? 'text-muted-foreground'
      : 'text-amber-700 dark:text-amber-300'}"
    data-testid="sentinel-compatible-provider-status"
  >
    {hasCompatibleProviders
      ? (() => { const translationRequest: Parameters<typeof vault.t>[0] = { key: I18N_KEYS.OnboardDeviceSentinelProviderReady, replacements: {
          count: String(compatibleProviderCount),
        } }; return vault.t(translationRequest); })()
      : vault.t(I18N_KEYS.OnboardDeviceSentinelProviderMissing)}
  </p>

  <div class="flex flex-wrap gap-2">
    <Button
      type="button"
      variant="outline"
      size="sm"
      data-testid="sentinel-manage-providers"
      onclick={() => vault.openAdmin(AdminAccordionSection.Storage)}
    >
      <Cloud class="size-4" />
      {vault.t(I18N_KEYS.OnboardDeviceSentinelManageProviders)}
    </Button>
    <Button
      type="button"
      size="sm"
      data-testid="sentinel-review-joins"
      onclick={() => {
        const settingsRequest: Parameters<typeof vault.openSettings>[0] = {
          section: SettingsSection.Storage,
          accordion: SettingsAccordionSection.Devices,
        }
        vault.openSettings(settingsRequest)
      }}
    >
      <ShieldCheck class="size-4" />
      {vault.t(I18N_KEYS.OnboardDeviceSentinelReviewJoins)}
    </Button>
  </div>
</div>
