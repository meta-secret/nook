<script lang="ts">
  import type { VaultState } from '$lib/vault.svelte'
  import {
    inferMnemonicLength,
    isKnownBip39Word,
    isMnemonicValid,
    joinMnemonicWords,
    loadBip39Wordlist,
    parseMnemonicWords,
    type MnemonicLength,
  } from '$lib/bip39-wordlist'

  let {
    vault,
    value = $bindable(''),
    valid = $bindable(false),
    readonly = false,
    revealed = true,
  }: {
    vault: VaultState
    value?: string
    valid?: boolean
    readonly?: boolean
    revealed?: boolean
  } = $props()

  let wordCount = $state<MnemonicLength>(12)
  let cells = $state<string[]>(Array.from({ length: 24 }, () => ''))
  let wordlist = $state<Set<string> | null>(null)
  let loading = $state(true)
  let loadError = $state<string | null>(null)
  let syncingFromCells = $state(false)

  const gridCols = $derived(wordCount === 12 ? 'grid-cols-3' : 'grid-cols-4')
  const activeCells = $derived(cells.slice(0, wordCount))

  function applyValueToCells(seed: string) {
    const inferred = inferMnemonicLength(seed)
    if (inferred) wordCount = inferred

    const words = parseMnemonicWords(seed)
    const next = Array.from({ length: 24 }, () => '')
    for (let index = 0; index < words.length && index < 24; index += 1) {
      next[index] = words[index] ?? ''
    }
    cells = next
  }

  function syncValueFromCells() {
    syncingFromCells = true
    value = joinMnemonicWords(cells.slice(0, wordCount))
    queueMicrotask(() => {
      syncingFromCells = false
    })
  }

  function applyPastedMnemonic(text: string) {
    const words = parseMnemonicWords(text)
    if (words.length === 24) wordCount = 24
    else wordCount = 12

    const next = Array.from({ length: 24 }, () => '')
    for (let index = 0; index < words.length && index < wordCount; index += 1) {
      next[index] = words[index] ?? ''
    }
    cells = next
    syncValueFromCells()
  }

  function setWordCount(count: MnemonicLength) {
    if (readonly) return
    wordCount = count
    syncValueFromCells()
  }

  function onCellInput(index: number, nextValue: string) {
    if (/\s/.test(nextValue)) {
      applyPastedMnemonic(nextValue)
      return
    }

    const next = [...cells]
    next[index] = nextValue.toLowerCase()
    cells = next
    syncValueFromCells()
  }

  function cellInvalid(index: number): boolean {
    const word = cells[index]?.trim()
    if (!word || !wordlist) return false
    return !isKnownBip39Word(word, wordlist)
  }

  $effect(() => {
    if (syncingFromCells) return
    applyValueToCells(value)
  })

  $effect(() => {
    valid = Boolean(wordlist && isMnemonicValid(value, wordlist, wordCount))
  })

  $effect(() => {
    let cancelled = false
    loading = true
    loadError = null

    void loadBip39Wordlist()
      .then((set) => {
        if (cancelled) return
        wordlist = set
        loading = false
      })
      .catch((error: unknown) => {
        if (cancelled) return
        loadError =
          error instanceof Error
            ? error.message
            : vault.t('add_secret.seed_wordlist_error')
        loading = false
      })

    return () => {
      cancelled = true
    }
  })
</script>

<div class="space-y-3" data-testid="seed-phrase-grid">
  {#if loading}
    <p class="text-xs text-muted-foreground">
      {vault.t('add_secret.seed_wordlist_loading')}
    </p>
  {:else if loadError}
    <p class="text-xs text-destructive" data-testid="seed-wordlist-error">
      {vault.t('add_secret.seed_wordlist_error')}
    </p>
  {:else if !readonly}
    <div class="flex items-center gap-2">
      <button
        type="button"
        class="rounded-md border px-2.5 py-1 text-xs font-medium transition-colors {wordCount ===
        12
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-border/50 text-muted-foreground hover:bg-accent'}"
        data-testid="seed-word-count-12"
        onclick={() => setWordCount(12)}
      >
        {vault.t('add_secret.seed_word_count_12')}
      </button>
      <button
        type="button"
        class="rounded-md border px-2.5 py-1 text-xs font-medium transition-colors {wordCount ===
        24
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-border/50 text-muted-foreground hover:bg-accent'}"
        data-testid="seed-word-count-24"
        onclick={() => setWordCount(24)}
      >
        {vault.t('add_secret.seed_word_count_24')}
      </button>
    </div>
  {/if}

  <div
    class="grid gap-2 {gridCols}"
    onpaste={(event) => {
      if (readonly) return
      const text = event.clipboardData?.getData('text')
      if (!text?.trim()) return
      event.preventDefault()
      applyPastedMnemonic(text)
    }}
  >
    {#each activeCells as word, index (index)}
      <label class="relative block" data-testid="seed-word-cell-{index + 1}">
        <span
          class="pointer-events-none absolute left-2 top-1.5 text-[10px] font-medium text-muted-foreground"
        >
          {index + 1}
        </span>
        {#if readonly}
          <div
            class="flex h-10 items-center rounded-md border border-border/45 bg-muted/20 px-2 pt-3 font-mono text-xs text-foreground"
          >
            {#if revealed}
              <span class="truncate" data-testid="seed-word-{index + 1}"
                >{word}</span
              >
            {:else}
              <span aria-hidden="true" data-testid="seed-word-{index + 1}"
                >••••••</span
              >
            {/if}
          </div>
        {:else}
          <input
            type="text"
            value={word}
            autocomplete="off"
            spellcheck="false"
            inputmode="text"
            data-testid="seed-word-{index + 1}"
            aria-invalid={cellInvalid(index)}
            aria-describedby={cellInvalid(index)
              ? `seed-word-error-${index + 1}`
              : undefined}
            class="flex h-10 w-full rounded-md border bg-background/80 px-2 pt-3 font-mono text-xs focus:outline-hidden focus:ring-2 focus:ring-ring sm:bg-background {cellInvalid(
              index,
            )
              ? 'border-destructive focus:ring-destructive/40'
              : 'border-border/45'}"
            oninput={(event) => onCellInput(index, event.currentTarget.value)}
          />
          {#if cellInvalid(index)}
            <span
              id="seed-word-error-{index + 1}"
              class="mt-1 block text-[10px] text-destructive"
            >
              {vault.t('add_secret.seed_word_invalid')}
            </span>
          {/if}
        {/if}
      </label>
    {/each}
  </div>
</div>
