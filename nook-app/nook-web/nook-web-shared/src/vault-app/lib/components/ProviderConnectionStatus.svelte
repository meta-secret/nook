<!--
Connecting a sync provider runs its first upload and sync, which can hold the
page for most of a minute. This card names the running step and says the wait
is expected, so a busy page does not read as a frozen one.
-->
<script lang="ts">
  import { I18N_KEYS } from '../../../generated/i18n-keys'
  import { RefreshCw } from '@lucide/svelte'
  import type { VaultState } from '$lib/vault.svelte'
  import StepProgress from '$lib/components/login/StepProgress.svelte'
  import type { ProviderConnectionProgress } from '$lib/vault/provider-connection-progress'

  let {
    vault,
    progress,
  }: {
    vault: VaultState
    progress: ProviderConnectionProgress
  } = $props()

  const step = $derived(progress.steps[progress.current])
</script>

{#if step}
  <div
    class="grid gap-3 border border-border/60 bg-muted/10 px-4 py-4"
    role="status"
    aria-live="polite"
    aria-busy="true"
    data-testid="provider-connection-progress"
    data-phase={step.phase}
  >
    <p class="flex items-center gap-2 text-sm font-medium text-foreground">
      <RefreshCw
        class="size-4 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none"
        aria-hidden="true"
      />
      {vault.t(step.titleKey)}
    </p>
    <span class="nk-progress-sweep" aria-hidden="true"></span>
    <StepProgress
      steps={progress.steps.map((item) => vault.t(item.labelKey))}
      current={progress.current}
      testId="provider-connection-steps"
    />
    <p class="text-xs text-pretty text-muted-foreground">
      {vault.t(I18N_KEYS.AuthStorageConnectProgressHint)}
    </p>
  </div>
{/if}
