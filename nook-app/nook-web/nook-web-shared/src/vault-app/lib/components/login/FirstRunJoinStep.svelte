<!--
This browser's key is not a member of the identity picked, so setup asked to
join it. A device that is already a member approves the request on its
Devices page, where it sees this browser's device id; the same id shows
here to compare. There is no polling: Check again reads the answer.
-->
<script lang="ts">
  import { Lock, RefreshCw } from '@lucide/svelte'
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import { Button } from '$lib/components/ui/button'
  import FirstRunBackLink from './FirstRunBackLink.svelte'
  import FirstRunProgress from './FirstRunProgress.svelte'
  import type { VaultState } from '$lib/vault.svelte'
  import { FirstRunActions } from '$lib/vault/first-run'
  import { FirstRunJoinKind } from '$lib/vault/identity-join-wait'
  import { FirstRunStage } from '$lib/vault/state/ui.svelte'

  let { vault }: { vault: VaultState } = $props()

  const actions = $derived(new FirstRunActions(vault))
  let checking = $state(false)
  const identity = $derived(
    vault.firstRunJoin.kind === FirstRunJoinKind.Asked
      ? vault.firstRunJoin.join.label
      : '',
  )

  async function check(): Promise<void> {
    checking = true
    try {
      await actions.checkJoin()
    } finally {
      checking = false
    }
  }
</script>

<section
  class="mx-auto grid w-full max-w-md gap-6 py-6 sm:py-10"
  data-testid="first-run-join-step"
>
  <div class="grid gap-4">
    <FirstRunBackLink
      {vault}
      testId="first-run-join-back"
      disabled={checking || vault.isVerifying}
      onBack={() => actions.backToSync()}
    />
    <FirstRunProgress {vault} current={FirstRunStage.Joining} />
  </div>

  <div class="space-y-2">
    <h1
      class="text-[1.75rem] leading-tight font-semibold tracking-[-0.02em] text-foreground"
    >
      {vault.t(I18N_KEYS.FirstRunJoinTitle)}
    </h1>
    <p class="text-sm text-pretty text-muted-foreground">
      {vault.t(I18N_KEYS.FirstRunJoinBody)}
    </p>
  </div>

  <div class="nk-frame space-y-3 px-4 py-3">
    <div class="flex items-center gap-3">
      <span class="nk-tile nk-tile-sm" aria-hidden="true">
        <Lock class="size-4" />
      </span>
      <p
        class="min-w-0 flex-1 truncate text-sm font-semibold text-foreground"
        data-testid="first-run-join-identity"
      >
        {identity}
      </p>
      <span class="nk-tag">{vault.t(I18N_KEYS.AccessCheckIdentityRequested)}</span>
    </div>
    <div class="space-y-1">
      <p class="nk-label">{vault.t(I18N_KEYS.FirstRunJoinCompare)}</p>
      <p
        class="font-mono text-sm break-all text-foreground"
        data-testid="first-run-join-device"
      >
        {vault.t(I18N_KEYS.DevicesCardDevicePrefix)}{vault.deviceId}
      </p>
    </div>
  </div>

  <div>
    <Button
      type="button"
      data-testid="first-run-join-check"
      disabled={checking || vault.isVerifying}
      onclick={() => void check()}
    >
      {#if checking}
        <RefreshCw class="size-4 animate-spin" />
      {/if}
      {vault.t(I18N_KEYS.FirstRunJoinCheck)}
    </Button>
  </div>
</section>
