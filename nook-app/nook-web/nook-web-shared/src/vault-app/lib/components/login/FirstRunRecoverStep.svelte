<!--
Setup joins a keyring on the sync provider with one of its recovery
passphrases instead of asking its devices. The passphrases are listed by
the labels in the keyring's log; the words typed for the one picked go to
Rust, which says which words it refused. Accepted, this browser's key
joins the keyring and setup ends on it, as after an approved join.
-->
<script lang="ts">
  import { onMount } from 'svelte'
  import { Lock, RefreshCw } from '@lucide/svelte'
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import { Button } from '$lib/components/ui/button'
  import { ChoiceChips, type ChoiceChip } from '$lib/components/ui/choice-chips'
  import RecoveryWordsInput from '$lib/components/recovery-passphrase/RecoveryWordsInput.svelte'
  import FirstRunBackLink from './FirstRunBackLink.svelte'
  import FirstRunProgress from './FirstRunProgress.svelte'
  import type { VaultState } from '$lib/vault.svelte'
  import { FirstRunActions } from '$lib/vault/first-run'
  import {
    FirstRunRecovery,
    type FirstRunRecoveryAttempt,
  } from '$lib/vault/first-run-recovery'
  import type { IdentityJoinIntent } from '$lib/vault/identity-join-wait'
  import {
    RecoveryWordsOutcomeKind,
    RecoveryWordsPurpose,
    RecoveryWordsSlipKind,
    type RecoveryWordsSlip,
  } from '$lib/vault/recovery-words'
  import { FirstRunStage } from '$lib/vault/state/ui.svelte'
  import {
    RecoveryListKind,
    type RecoveryList,
  } from './first-run-recover-state'

  let { vault, join }: { vault: VaultState; join: IdentityJoinIntent } =
    $props()

  const actions = $derived(new FirstRunActions(vault))
  const recovery = $derived(new FirstRunRecovery(vault))
  let list = $state.raw<RecoveryList>({ kind: RecoveryListKind.Loading })
  let picked = $state('')
  let typed = $state('')
  let slip = $state<RecoveryWordsSlip>({ kind: RecoveryWordsSlipKind.Clear })
  let working = $state(false)

  const passphrases = $derived(
    list.kind === RecoveryListKind.Loaded ? list.passphrases : [],
  )
  const choices = $derived(
    passphrases.map(
      (passphrase): ChoiceChip => ({
        value: passphrase.id,
        label: passphrase.label,
      }),
    ),
  )
  const busy = $derived(working || vault.isVerifying)

  async function load(): Promise<void> {
    list = { kind: RecoveryListKind.Loading }
    const read = await recovery.passphrases(join)
    if (read.isErr()) {
      list = { kind: RecoveryListKind.Failed, message: read.error.message(vault) }
      return
    }
    list = { kind: RecoveryListKind.Loaded, passphrases: read.value }
    const [first] = read.value
    if (first) picked = first.id
  }

  onMount(() => {
    void load()
  })

  function pick(id: string): void {
    picked = id
    slip = { kind: RecoveryWordsSlipKind.Clear }
  }

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault()
    if (!picked) return
    working = true
    vault.errorMsg = ''
    try {
      const attempt: FirstRunRecoveryAttempt = {
        join,
        recoveryId: picked,
        words: typed,
      }
      const recovered = await recovery.recover(attempt)
      if (recovered.isErr()) {
        vault.errorMsg = recovered.error.message(vault)
        return
      }
      switch (recovered.value.kind) {
        case RecoveryWordsOutcomeKind.Refused:
          slip = {
            kind: RecoveryWordsSlipKind.Refused,
            refusal: recovered.value.refusal,
          }
          return
        case RecoveryWordsOutcomeKind.Accepted:
          typed = ''
      }
    } finally {
      working = false
    }
  }
</script>

<section
  class="mx-auto grid w-full max-w-md gap-6 py-6 sm:py-10"
  data-testid="first-run-recover-step"
>
  <div class="grid gap-4">
    <FirstRunBackLink
      {vault}
      testId="first-run-recover-back"
      disabled={busy}
      onBack={() => actions.backToSync()}
    />
    <FirstRunProgress {vault} current={FirstRunStage.Joining} />
  </div>

  <div class="space-y-2">
    <h1
      class="text-[1.75rem] leading-tight font-semibold tracking-[-0.02em] text-foreground"
    >
      {vault.t(I18N_KEYS.RecoveryPassphraseRecoverTitle)}
    </h1>
    <p class="text-sm text-pretty text-muted-foreground">
      {vault.t(I18N_KEYS.RecoveryPassphraseRecoverBody)}
    </p>
  </div>

  <div class="nk-frame flex items-center gap-3 px-4 py-3">
    <span class="nk-tile nk-tile-sm" aria-hidden="true">
      <Lock class="size-4" />
    </span>
    <p
      class="min-w-0 flex-1 truncate text-sm font-semibold text-foreground"
      data-testid="first-run-recover-identity"
    >
      {join.label}
    </p>
  </div>

  {#if list.kind === RecoveryListKind.Loading}
    <p
      class="flex items-center gap-2 text-xs text-muted-foreground"
      role="status"
      data-testid="first-run-recover-loading"
    >
      <RefreshCw class="size-3.5 animate-spin" aria-hidden="true" />
      {vault.t(I18N_KEYS.RecoveryPassphraseRecoverLoading)}
    </p>
  {:else if list.kind === RecoveryListKind.Failed}
    <div class="grid gap-3" role="alert">
      <p class="text-sm text-destructive" data-testid="first-run-recover-failed">
        {list.message}
      </p>
      <Button
        type="button"
        size="sm"
        variant="outline"
        class="justify-self-start"
        onclick={() => void load()}
      >
        {vault.t(I18N_KEYS.DevicesAccessTryAgain)}
      </Button>
    </div>
  {:else if passphrases.length === 0}
    <p class="text-sm text-muted-foreground" data-testid="first-run-recover-none">
      {vault.t(I18N_KEYS.RecoveryPassphraseRecoverNone)}
    </p>
  {:else}
    <form class="grid gap-5" onsubmit={(event) => void submit(event)}>
      {#if passphrases.length > 1}
        <div class="grid gap-2">
          <p class="nk-label">
            {vault.t(I18N_KEYS.RecoveryPassphraseRecoverChoose)}
          </p>
          <ChoiceChips
            label={vault.t(I18N_KEYS.RecoveryPassphraseRecoverChoose)}
            {choices}
            value={picked}
            disabled={busy}
            testid="first-run-recover-passphrase"
            onpick={pick}
          />
        </div>
      {:else}
        {#each passphrases as passphrase (passphrase.id)}
          <p class="nk-spec" data-testid="first-run-recover-passphrase-label">
            {passphrase.label}
          </p>
        {/each}
      {/if}
      <RecoveryWordsInput
        {vault}
        id="first-run-recover-words"
        bind:value={typed}
        {slip}
        purpose={RecoveryWordsPurpose.Recover}
        disabled={busy}
        testId="first-run-recover-words"
        onedit={() => (slip = { kind: RecoveryWordsSlipKind.Clear })}
      />
      <div>
        <Button
          type="submit"
          data-testid="first-run-recover-submit"
          disabled={busy || !picked}
        >
          {#if working}
            <RefreshCw class="size-4 animate-spin" aria-hidden="true" />
            {vault.t(I18N_KEYS.RecoveryPassphraseRecoverSubmitting)}
          {:else}
            {vault.t(I18N_KEYS.RecoveryPassphraseRecoverSubmit)}
          {/if}
        </Button>
      </div>
    </form>
  {/if}
</section>
