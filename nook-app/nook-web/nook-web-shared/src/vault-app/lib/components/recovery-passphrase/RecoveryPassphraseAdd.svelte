<!--
Adding a recovery passphrase, in three steps on one panel: name it and pick
its strength, write down the words Rust generated (shown this once), then
type them back. Only when Rust accepts the typed words is the passphrase
saved in the keyring. Cancel, or leaving the page, drops the pending one.
-->
<script lang="ts">
  import { onDestroy } from 'svelte'
  import { KeyRound, RefreshCw, ShieldCheck } from '@lucide/svelte'
  import type { RecoveryStrength } from '$app-wasm'
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import { Button } from '$lib/components/ui/button'
  import type { VaultState } from '$lib/vault.svelte'
  import type { RecoveryPassphraseRequest } from '$lib/vault/identity-control.svelte'
  import {
    RECOVERY_STRENGTHS,
    RecoveryWordsOutcomeKind,
    RecoveryWordsPurpose,
    RecoveryWordsSlipKind,
    RecoveryWordsText,
    recoveryWordsOutcome,
    type RecoveryWordsSlip,
  } from '$lib/vault/recovery-words'
  import RecoveryWordsInput from './RecoveryWordsInput.svelte'
  import { RecoveryAddKind, type RecoveryAdd } from './recovery-passphrase-state'

  let {
    vault,
    onClose,
  }: {
    vault: VaultState
    /** The flow ended: saved or cancelled. */
    onClose: () => void
  } = $props()

  const text = $derived(new RecoveryWordsText(vault))
  let step = $state<RecoveryAdd>({ kind: RecoveryAddKind.Choosing })
  let label = $state('')
  let strength = $state<RecoveryStrength>('standard')
  let typed = $state('')
  let slip = $state<RecoveryWordsSlip>({ kind: RecoveryWordsSlipKind.Clear })
  let working = $state(false)

  async function generate(event: SubmitEvent): Promise<void> {
    event.preventDefault()
    const name = label.trim()
    if (!name) return
    working = true
    try {
      const request: RecoveryPassphraseRequest = { label: name, strength }
      const begun =
        await vault.identityControl.beginRecoveryPassphrase(request)
      if (begun.isErr()) {
        vault.errorMsg = vault.t(begun.error.translationKey)
        return
      }
      step = {
        kind: RecoveryAddKind.Writing,
        label: name,
        words: begun.value.words,
      }
    } finally {
      working = false
    }
  }

  /** The words were written down: they leave the screen for good. */
  function written(name: string): void {
    step = { kind: RecoveryAddKind.Confirming, label: name }
  }

  async function confirm(name: string): Promise<void> {
    working = true
    try {
      const checked =
        await vault.identityControl.confirmRecoveryPassphrase(typed)
      if (checked.isErr()) {
        vault.errorMsg = vault.t(checked.error.translationKey)
        return
      }
      const outcome = recoveryWordsOutcome(checked.value)
      switch (outcome.kind) {
        case RecoveryWordsOutcomeKind.Refused:
          slip = {
            kind: RecoveryWordsSlipKind.Refused,
            refusal: outcome.refusal,
          }
          return
        case RecoveryWordsOutcomeKind.Accepted:
          break
      }
      typed = ''
      const saved: Parameters<typeof vault.t>[0] = {
        key: I18N_KEYS.RecoveryPassphraseSaved,
        replacements: { label: name },
      }
      vault.showSuccess(vault.t(saved))
      step = { kind: RecoveryAddKind.Choosing }
      onClose()
    } finally {
      working = false
    }
  }

  /** Closing the flow drops a pending passphrase, as leaving the page
   * does: the panel goes, and with it what Rust keeps for it. */
  function cancel(): void {
    typed = ''
    onClose()
  }

  onDestroy(() => {
    switch (step.kind) {
      case RecoveryAddKind.Choosing:
        return
      case RecoveryAddKind.Writing:
      case RecoveryAddKind.Confirming:
        vault.identityControl.cancelRecoveryPassphrase()
    }
  })
</script>

<div
  class="nk-panel grid gap-4 p-4"
  data-testid="recovery-passphrase-add-flow"
  data-step={step.kind}
>
  {#if step.kind === RecoveryAddKind.Choosing}
    <form class="grid gap-4" onsubmit={(event) => void generate(event)}>
      <div class="grid gap-2">
        <label class="nk-label" for="recovery-passphrase-label">
          {vault.t(I18N_KEYS.RecoveryPassphraseLabelLabel)}
        </label>
        <input
          id="recovery-passphrase-label"
          class="h-10 w-full border border-border bg-card px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          maxlength="80"
          autocomplete="off"
          placeholder={vault.t(I18N_KEYS.RecoveryPassphraseLabelPlaceholder)}
          data-testid="recovery-passphrase-label-input"
          disabled={working}
          bind:value={label}
        />
      </div>
      <div class="grid gap-2">
        <p class="nk-label" id="recovery-passphrase-strength-label">
          {vault.t(I18N_KEYS.RecoveryPassphraseStrengthLabel)}
        </p>
        <div
          class="grid grid-cols-2 gap-2"
          role="radiogroup"
          aria-labelledby="recovery-passphrase-strength-label"
          data-testid="recovery-passphrase-strength-choice"
        >
          {#each RECOVERY_STRENGTHS as choice (choice)}
            {@const picked = choice === strength}
            <button
              type="button"
              role="radio"
              aria-checked={picked}
              class="nk-frame-nick nk-frame-interactive nk-choice-tile flex min-h-14 items-center gap-2.5 px-3 py-2.5 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
              data-testid="recovery-passphrase-strength-choice-{choice}"
              disabled={working}
              onclick={() => (strength = choice)}
            >
              <span
                class="nk-choice-icon flex size-8 shrink-0 items-center justify-center border border-border text-muted-foreground"
                aria-hidden="true"
              >
                {#if choice === 'high'}
                  <ShieldCheck class="size-4" />
                {:else}
                  <KeyRound class="size-4" />
                {/if}
              </span>
              <span class="grid min-w-0">
                <span class="text-sm font-medium text-foreground"
                  >{text.strength(choice)}</span
                >
                <span class="text-xs text-muted-foreground"
                  >{text.strengthDetail(choice)}</span
                >
              </span>
            </button>
          {/each}
        </div>
      </div>
      <div class="flex flex-wrap gap-2">
        <Button
          type="submit"
          size="sm"
          data-testid="recovery-passphrase-generate"
          disabled={working || !label.trim()}
        >
          {#if working}
            <RefreshCw class="size-4 animate-spin" aria-hidden="true" />
            {vault.t(I18N_KEYS.RecoveryPassphraseGenerating)}
          {:else}
            {vault.t(I18N_KEYS.RecoveryPassphraseGenerate)}
          {/if}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          data-testid="recovery-passphrase-cancel"
          disabled={working}
          onclick={cancel}
        >
          {vault.t(I18N_KEYS.CommonCancel)}
        </Button>
      </div>
    </form>
  {:else if step.kind === RecoveryAddKind.Writing}
    {@const name = step.label}
    <div class="grid gap-1">
      <p class="text-sm font-semibold text-foreground">
        {vault.t(I18N_KEYS.RecoveryPassphraseWriteTitle)}
      </p>
      <p class="text-xs text-pretty text-muted-foreground">
        {vault.t(I18N_KEYS.RecoveryPassphraseWriteBody)}
      </p>
    </div>
    <ol class="nk-words" data-testid="recovery-passphrase-words">
      {#each step.words as word, index (index)}
        <li>
          <i>{index + 1}</i><b data-testid="recovery-passphrase-word">{word}</b>
        </li>
      {/each}
    </ol>
    <div class="flex flex-wrap gap-2">
      <Button
        type="button"
        size="sm"
        data-testid="recovery-passphrase-written"
        onclick={() => written(name)}
      >
        {vault.t(I18N_KEYS.RecoveryPassphraseWritten)}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        data-testid="recovery-passphrase-cancel"
        onclick={cancel}
      >
        {vault.t(I18N_KEYS.CommonCancel)}
      </Button>
    </div>
  {:else}
    {@const name = step.label}
    <form class="grid gap-3" onsubmit={(event) => {
        event.preventDefault()
        void confirm(name)
      }}>
      <p class="text-sm font-semibold text-foreground">
        {vault.t(I18N_KEYS.RecoveryPassphraseConfirmTitle)}
      </p>
      <RecoveryWordsInput
        {vault}
        id="recovery-passphrase-confirm-words"
        bind:value={typed}
        {slip}
        purpose={RecoveryWordsPurpose.Confirm}
        disabled={working}
        testId="recovery-passphrase-confirm-words"
        onedit={() => (slip = { kind: RecoveryWordsSlipKind.Clear })}
      />
      <div class="flex flex-wrap gap-2">
        <Button
          type="submit"
          size="sm"
          data-testid="recovery-passphrase-confirm"
          disabled={working}
        >
          {#if working}
            <RefreshCw class="size-4 animate-spin" aria-hidden="true" />
            {vault.t(I18N_KEYS.RecoveryPassphraseConfirming)}
          {:else}
            {vault.t(I18N_KEYS.RecoveryPassphraseConfirm)}
          {/if}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          data-testid="recovery-passphrase-cancel"
          disabled={working}
          onclick={cancel}
        >
          {vault.t(I18N_KEYS.CommonCancel)}
        </Button>
      </div>
    </form>
  {/if}
</div>
