<!--
The words of one of a keyring's recovery passphrases, typed to join it.
The passphrases are listed by the labels in the keyring's log; the words
typed for the one picked go to Rust, which says which words it refused.
Accepted, this browser's key joins the keyring, and the page connects its
sync provider its own way.
-->
<script lang="ts">
  import { onMount } from 'svelte'
  import { RefreshCw } from '@lucide/svelte'
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import { Button } from '$lib/components/ui/button'
  import { ChoiceChips, type ChoiceChip } from '$lib/components/ui/choice-chips'
  import RecoveryWordsInput from '$lib/components/recovery-passphrase/RecoveryWordsInput.svelte'
  import type { VaultState } from '$lib/vault.svelte'
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
  import {
    RecoveryListKind,
    recoveryList,
    type RecoveryList,
  } from '$lib/components/login/first-run-recover-state'

  let {
    vault,
    join,
    connect,
    working = $bindable(false),
  }: {
    vault: VaultState
    join: IdentityJoinIntent
    /** Connects the keyring's sync provider once the words let this
     * browser in; true when it connected. */
    connect: () => Promise<boolean>
    /** True while the words are checked and the keyring set up. */
    working: boolean
  } = $props()

  const recovery = $derived(new FirstRunRecovery(vault))
  let list = $state.raw<RecoveryList>({ kind: RecoveryListKind.Loading })
  let typed = $state('')
  let slip = $state<RecoveryWordsSlip>({ kind: RecoveryWordsSlipKind.Clear })

  const passphrases = $derived(
    list.kind === RecoveryListKind.Ready ? list.passphrases : [],
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
    list = recoveryList(read.value)
  }

  onMount(() => {
    void load()
  })

  function pick(id: string): void {
    switch (list.kind) {
      case RecoveryListKind.Ready:
        list = { ...list, picked: id }
        break
      case RecoveryListKind.Loading:
      case RecoveryListKind.None:
      case RecoveryListKind.Failed:
        return
    }
    slip = { kind: RecoveryWordsSlipKind.Clear }
  }

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault()
    switch (list.kind) {
      case RecoveryListKind.Ready:
        return recoverWith(list.picked)
      case RecoveryListKind.Loading:
      case RecoveryListKind.None:
      case RecoveryListKind.Failed:
        return
    }
  }

  async function recoverWith(picked: string): Promise<void> {
    working = true
    vault.errorMsg = ''
    try {
      const attempt: FirstRunRecoveryAttempt = {
        join,
        recoveryId: picked,
        words: typed,
        connect,
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
{:else if list.kind === RecoveryListKind.None}
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
          value={list.picked}
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
        disabled={busy}
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
