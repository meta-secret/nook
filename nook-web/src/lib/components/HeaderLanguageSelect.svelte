<script lang="ts">
  import type { VaultState } from '$lib/vault.svelte'

  const LOCALES = [
    { value: 'en' as const, label: 'English' },
    { value: 'ru' as const, label: 'Русский' },
  ]

  let { vault }: { vault: VaultState } = $props()

  let open = $state(false)
  let root = $state<HTMLDivElement | undefined>(undefined)

  function selectLocale(locale: 'en' | 'ru') {
    void vault.updateLocale(locale)
    open = false
  }

  function handleDocumentClick(event: MouseEvent) {
    if (!open || !root) return
    if (!root.contains(event.target as Node)) open = false
  }

  function handleDocumentKeydown(event: KeyboardEvent) {
    if (open && event.key === 'Escape') open = false
  }

  $effect(() => {
    if (!open) return
    document.addEventListener('click', handleDocumentClick)
    document.addEventListener('keydown', handleDocumentKeydown)
    return () => {
      document.removeEventListener('click', handleDocumentClick)
      document.removeEventListener('keydown', handleDocumentKeydown)
    }
  })
</script>

<div bind:this={root} class="relative" id="header-language-container">
  <button
    type="button"
    aria-label={vault.t('settings.select_language')}
    aria-haspopup="listbox"
    aria-expanded={open}
    data-testid="header-language-select"
    class="inline-flex size-10 items-center justify-center rounded-lg border border-border/40 bg-background/60 text-xs font-bold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:bg-background/70"
    onclick={() => {
      open = !open
    }}
  >
    {vault.locale.toUpperCase()}
  </button>

  {#if open}
    <ul
      role="listbox"
      aria-label={vault.t('settings.select_language')}
      class="absolute right-0 top-full z-50 mt-1.5 min-w-[6.75rem] overflow-hidden rounded-lg border border-border/60 bg-popover p-1 shadow-md"
    >
      {#each LOCALES as locale (locale.value)}
        <li role="presentation">
          <button
            type="button"
            role="option"
            aria-selected={vault.locale === locale.value}
            data-testid="header-language-option-{locale.value}"
            class="flex w-full items-center rounded-md px-3 py-1.5 text-left text-xs font-medium transition-colors {vault.locale ===
            locale.value
              ? 'bg-accent text-foreground'
              : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'}"
            onclick={() => selectLocale(locale.value)}
          >
            {locale.label}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>
