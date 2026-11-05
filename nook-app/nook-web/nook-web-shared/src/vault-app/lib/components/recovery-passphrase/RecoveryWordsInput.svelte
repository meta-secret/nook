<!--
The words of a recovery passphrase, typed in one field. Rust suggests list
words for the word being typed; a suggestion completes it. What Rust refused
shows under the field, naming the words it refused.
-->
<script lang="ts">
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import type { VaultState } from '$lib/vault.svelte'
  import {
    RecoveryWordSuggestions,
    RecoveryWordsSlipKind,
    RecoveryWordsText,
    type RecoveryWordCompletion,
    type RecoveryWordsPurpose,
    type RecoveryWordsSlip,
    type RecoveryWordsSlipText,
  } from '$lib/vault/recovery-words'

  let {
    vault,
    id,
    value = $bindable(''),
    slip,
    purpose,
    disabled,
    testId,
    onedit,
  }: {
    vault: VaultState
    /** The field's id; its message and suggestions derive theirs. */
    id: string
    value: string
    slip: RecoveryWordsSlip
    purpose: RecoveryWordsPurpose
    disabled: boolean
    testId: string
    /** The words changed: an earlier refusal no longer applies. */
    onedit: () => void
  } = $props()

  const suggested = $derived(RecoveryWordSuggestions.of(value))
  const message = $derived.by(() => {
    const request: RecoveryWordsSlipText = { slip, purpose }
    return new RecoveryWordsText(vault).slip(request)
  })
  const refused = $derived(slip.kind === RecoveryWordsSlipKind.Refused)

  function complete(word: string): void {
    const completion: RecoveryWordCompletion = { typed: value, word }
    value = RecoveryWordSuggestions.complete(completion)
    onedit()
    const field = document.getElementById(id)
    if (field instanceof HTMLInputElement) field.focus()
  }
</script>

<div class="grid gap-2">
  <label class="nk-label" for={id}>
    {vault.t(I18N_KEYS.RecoveryPassphraseWordsLabel)}
  </label>
  <input
    {id}
    class="h-10 w-full border bg-card px-3 font-mono text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 {refused
      ? 'border-destructive'
      : 'border-border'}"
    type="text"
    autocomplete="off"
    autocapitalize="none"
    spellcheck="false"
    aria-invalid={refused}
    aria-describedby="{id}-message"
    data-testid={testId}
    {disabled}
    bind:value
    oninput={onedit}
  />
  {#if suggested.length > 0}
    <div
      class="flex flex-wrap gap-1.5"
      role="group"
      aria-label={vault.t(I18N_KEYS.RecoveryPassphraseSuggestionsLabel)}
      data-testid="{testId}-suggestions"
    >
      {#each suggested as word (word)}
        <button
          type="button"
          class="inline-flex h-8 items-center border border-dashed border-border px-2.5 font-mono text-xs text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50"
          data-testid="{testId}-suggestion"
          data-word={word}
          {disabled}
          onclick={() => complete(word)}
        >
          {word}
        </button>
      {/each}
    </div>
  {/if}
  <p
    id="{id}-message"
    class="min-h-4 text-xs text-destructive"
    aria-live="polite"
    data-testid="{testId}-message">{message}</p
  >
</div>
