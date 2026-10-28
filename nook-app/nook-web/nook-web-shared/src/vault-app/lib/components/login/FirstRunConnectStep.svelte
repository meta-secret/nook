<!--
The last step for a new identity created on a sync provider: its first vault
exists, and the provider signed in to during setup connects now, without
another sign-in. Once it syncs, the identities open. A connection that fails
can be tried again, or left for the Sync page.
-->
<script lang="ts">
  import { RefreshCw } from '@lucide/svelte'
  import { untrack } from 'svelte'
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import { Button } from '$lib/components/ui/button'
  import FirstRunProgress from './FirstRunProgress.svelte'
  import type { VaultState } from '$lib/vault.svelte'
  import { FirstRunActions } from '$lib/vault/first-run'
  import { FirstRunStage } from '$lib/vault/state/ui.svelte'

  let {
    vault,
    onDone,
  }: {
    vault: VaultState
    /** Leave setup for the identities. */
    onDone: () => void
  } = $props()

  const actions = $derived(new FirstRunActions(vault))
  let connecting = $state(true)

  async function connect(): Promise<void> {
    connecting = true
    try {
      if (await actions.connectProvider()) onDone()
    } finally {
      connecting = false
    }
  }

  untrack(() => void connect())
</script>

<section
  class="mx-auto grid w-full max-w-md gap-6 py-6 sm:py-10"
  data-testid="first-run-connect-step"
>
  <FirstRunProgress {vault} current={FirstRunStage.Connect} />

  <div class="space-y-2">
    <h1
      class="text-[1.75rem] leading-tight font-semibold tracking-[-0.02em] text-foreground"
    >
      {vault.t(I18N_KEYS.FirstRunConnectTitle)}
    </h1>
    <p class="text-sm text-pretty text-muted-foreground">
      {vault.t(I18N_KEYS.FirstRunConnectBody)}
    </p>
  </div>

  {#if connecting}
    <p
      class="flex items-center gap-2 text-sm text-muted-foreground"
      role="status"
      data-testid="first-run-connecting"
    >
      <RefreshCw class="size-4 animate-spin" aria-hidden="true" />
      {vault.t(I18N_KEYS.AuthStorageSyncConnecting)}
    </p>
  {:else}
    {#if vault.errorMsg}
      <p class="text-xs text-destructive" role="alert">{vault.errorMsg}</p>
    {/if}
    <div class="flex flex-wrap items-center gap-3">
      <Button
        type="button"
        data-testid="first-run-connect-retry"
        onclick={() => void connect()}
      >
        {vault.t(I18N_KEYS.FirstRunConnectRetry)}
      </Button>
      <Button
        type="button"
        variant="ghost"
        data-testid="first-run-connect-skip"
        onclick={() => {
          vault.cancelProviderSetup()
          onDone()
        }}
      >
        {vault.t(I18N_KEYS.FirstRunConnectSkip)}
      </Button>
    </div>
  {/if}
</section>
