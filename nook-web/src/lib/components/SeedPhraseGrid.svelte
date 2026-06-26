<script lang="ts">
  import { Check } from '@lucide/svelte'
  import type { VaultState } from '$lib/vault.svelte'
  import {
    inferMnemonicLength,
    isKnownBip39Word,
    isMnemonicValid,
    joinMnemonicWords,
    loadBip39Wordlist,
    parseMnemonicWords,
    suggestBip39Words,
    type MnemonicLength,
  } from '$lib/bip39-wordlist'
  import { validateBip39MnemonicChecksum } from '$lib/bip39-mnemonic'

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
  let focusedIndex = $state<number | null>(null)
  let suggestionIndex = $state(0)
  let inputRefs = $state<Array<HTMLInputElement | null>>([])
  let checksumValid = $state<boolean | null>(null)
  let checksumChecking = $state(false)

  const gridCols = $derived(wordCount === 12 ? 'grid-cols-3' : 'grid-cols-4')
  const activeCells = $derived(cells.slice(0, wordCount))
  const perWordValid = $derived(
    Boolean(wordlist && isMnemonicValid(value, wordlist, wordCount)),
  )
  const allWordsFilled = $derived(
    activeCells.every((word) => word.trim().length > 0),
  )
  const hasPhraseContent = $derived(
    activeCells.some((word) => word.trim().length > 0) ||
      value.trim().length > 0,
  )

  const suggestions = $derived.by(() => {
    if (readonly || focusedIndex === null || !wordlist) return []
    const prefix = cells[focusedIndex]?.trim().toLowerCase() ?? ''
    if (!prefix || prefix.includes(' ')) return []
    if (wordlist.has(prefix)) return []
    return suggestBip39Words(prefix, wordlist)
  })

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

  function applyPastedMnemonic(text: string, startIndex = 0) {
    const words = parseMnemonicWords(text)
    if (words.length === 0) return

    if (words.length === 24) {
      wordCount = 24
    } else if (words.length > 12) {
      wordCount = 24
    } else {
      wordCount = 12
    }

    const next = [...cells]
    for (let offset = 0; offset < words.length; offset += 1) {
      const targetIndex = startIndex + offset
      if (targetIndex >= wordCount) break
      next[targetIndex] = words[offset] ?? ''
    }
    cells = next
    syncValueFromCells()
    focusedIndex = null
    focusCell(Math.min(startIndex + words.length, wordCount - 1))
  }

  function setWordCount(count: MnemonicLength) {
    if (readonly) return
    wordCount = count
    syncValueFromCells()
  }

  function clearPhrase() {
    if (readonly) return
    cells = Array.from({ length: 24 }, () => '')
    wordCount = 12
    value = ''
    valid = false
    checksumValid = null
    checksumChecking = false
    focusedIndex = null
    suggestionIndex = 0
    focusCell(0)
  }

  function setCellValue(index: number, nextValue: string) {
    const next = [...cells]
    next[index] = nextValue.toLowerCase()
    cells = next
    syncValueFromCells()
  }

  function onCellInput(index: number, nextValue: string) {
    if (/\s/.test(nextValue)) {
      applyPastedMnemonic(nextValue, index)
      return
    }

    setCellValue(index, nextValue)
    suggestionIndex = 0
  }

  function onCellPaste(index: number, event: ClipboardEvent) {
    if (readonly) return
    const text = event.clipboardData?.getData('text')
    if (!text?.trim()) return
    event.preventDefault()
    applyPastedMnemonic(text, index)
  }

  function selectSuggestion(word: string, index: number) {
    setCellValue(index, word)
    focusedIndex = null
    suggestionIndex = 0
    focusCell(index + 1)
  }

  function focusCell(index: number) {
    if (index < 0 || index >= wordCount) return
    queueMicrotask(() => {
      inputRefs[index]?.focus()
    })
  }

  function onCellKeyDown(index: number, event: KeyboardEvent) {
    if (suggestions.length > 0 && focusedIndex === index) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        suggestionIndex = Math.min(suggestionIndex + 1, suggestions.length - 1)
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        suggestionIndex = Math.max(suggestionIndex - 1, 0)
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        selectSuggestion(suggestions[suggestionIndex] ?? suggestions[0]!, index)
        return
      }
      if (event.key === 'Tab' && !event.shiftKey) {
        event.preventDefault()
        selectSuggestion(suggestions[suggestionIndex] ?? suggestions[0]!, index)
        return
      }
    }

    if (event.key === 'Escape') {
      focusedIndex = null
      suggestionIndex = 0
    }
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
    if (readonly || !perWordValid || !allWordsFilled) {
      checksumValid = null
      checksumChecking = false
      valid = false
      return
    }

    const mnemonic = value
    let cancelled = false
    checksumChecking = true

    void validateBip39MnemonicChecksum(mnemonic)
      .then((ok) => {
        if (cancelled) return
        checksumValid = ok
        checksumChecking = false
        valid = ok
      })
      .catch(() => {
        if (cancelled) return
        checksumValid = false
        checksumChecking = false
        valid = false
      })

    return () => {
      cancelled = true
    }
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
    <div class="flex flex-wrap items-center gap-2">
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
      <button
        type="button"
        class="ml-auto rounded-md border border-border/50 px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
        data-testid="seed-phrase-clear-btn"
        disabled={!hasPhraseContent}
        onclick={clearPhrase}
      >
        {vault.t('add_secret.seed_phrase_clear')}
      </button>
    </div>
  {/if}

  <div class="grid gap-2 {gridCols}">
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
            bind:this={inputRefs[index]}
            type="text"
            value={word}
            autocomplete="off"
            spellcheck="false"
            inputmode="text"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={focusedIndex === index && suggestions.length > 0}
            aria-controls={focusedIndex === index && suggestions.length > 0
              ? `seed-word-suggestions-${index + 1}`
              : undefined}
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
            onpaste={(event) => onCellPaste(index, event)}
            onfocus={() => {
              focusedIndex = index
              suggestionIndex = 0
            }}
            onblur={() => {
              queueMicrotask(() => {
                if (
                  document.activeElement?.closest(
                    '[data-testid^="seed-word-suggestion-"]',
                  )
                ) {
                  return
                }
                if (focusedIndex === index) focusedIndex = null
              })
            }}
            onkeydown={(event) => onCellKeyDown(index, event)}
          />
          {#if focusedIndex === index && suggestions.length > 0}
            <ul
              id="seed-word-suggestions-{index + 1}"
              role="listbox"
              data-testid="seed-word-suggestions"
              class="absolute left-0 right-0 top-full z-20 mt-1 max-h-40 overflow-y-auto rounded-md border border-border/45 bg-popover py-1 shadow-md"
            >
              {#each suggestions as suggestion, suggestionIdx (suggestion)}
                <li role="presentation">
                  <button
                    type="button"
                    role="option"
                    aria-selected={suggestionIdx === suggestionIndex}
                    data-testid="seed-word-suggestion-{suggestion}"
                    class="block w-full px-2.5 py-1.5 text-left font-mono text-xs transition-colors {suggestionIdx ===
                    suggestionIndex
                      ? 'bg-accent text-accent-foreground'
                      : 'text-foreground hover:bg-accent/60'}"
                    onmousedown={(event) => event.preventDefault()}
                    onclick={() => selectSuggestion(suggestion, index)}
                  >
                    {suggestion}
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
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

  {#if !readonly && perWordValid && allWordsFilled && checksumValid === true}
    <p
      class="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-500"
      data-testid="seed-phrase-valid"
    >
      <Check class="size-3.5 shrink-0" aria-hidden="true" />
      {vault.t('add_secret.seed_phrase_valid')}
    </p>
  {:else if !readonly && perWordValid && allWordsFilled && checksumValid === false}
    <p
      class="text-xs text-destructive"
      data-testid="seed-phrase-checksum-error"
    >
      {vault.t('add_secret.seed_phrase_invalid')}
    </p>
  {:else if !readonly && checksumChecking}
    <p
      class="text-xs text-muted-foreground"
      data-testid="seed-phrase-checksum-checking"
    >
      {vault.t('add_secret.seed_phrase_checking')}
    </p>
  {/if}
</div>
