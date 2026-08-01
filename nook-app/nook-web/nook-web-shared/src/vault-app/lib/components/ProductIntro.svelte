<script lang="ts">
  import { I18N_KEYS } from '../../../generated/i18n-keys'
  import { BookOpen, ChevronDown, Info } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import type { VaultState } from '$lib/vault.svelte'

  let {
    vault,
    onOpenHelp,
  }: {
    vault: VaultState
    onOpenHelp: () => void
  } = $props()

  let open = $state(false)
</script>

<aside
  class="overflow-hidden rounded-xl border border-border/60 bg-card/60 font-sans text-sm text-muted-foreground"
  data-testid="product-intro"
>
  <button
    type="button"
    class="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/30 {open
      ? 'bg-muted/20'
      : ''}"
    aria-expanded={open}
    data-testid="product-intro-toggle"
    onclick={() => {
      open = !open
    }}
  >
    <Info class="size-5 shrink-0 text-muted-foreground" />
    <span class="min-w-0 flex-1">
      <span class="block text-sm font-medium text-foreground">
        {vault.t(I18N_KEYS.ProductIntroWhyNook)}
      </span>
      {#if !open}
        <span class="block truncate text-xs leading-5 text-muted-foreground">
          {vault.t(I18N_KEYS.ProductIntroDeviceIsKey)}
        </span>
      {/if}
    </span>
    <ChevronDown
      class="size-5 shrink-0 text-muted-foreground transition-transform duration-200 {open
        ? 'rotate-180'
        : ''}"
    />
  </button>

  {#if open}
    <div
      class="space-y-2 border-t border-border/40 bg-background/40 px-4 py-4"
      data-testid="product-intro-panel"
    >
      <p class="text-sm font-medium text-foreground">
        {vault.t(I18N_KEYS.ProductIntroDeviceIsKey)}
      </p>
      <p class="text-pretty text-sm leading-normal">
        {vault.t(I18N_KEYS.ProductIntroNoMasterPw)}
      </p>
      <ul
        class="list-disc space-y-0.5 pl-5 text-pretty text-sm leading-normal marker:text-muted-foreground/60"
      >
        <li>{vault.t(I18N_KEYS.ProductIntroBullet1)}</li>
        <li>{vault.t(I18N_KEYS.ProductIntroBullet2)}</li>
        <li>{vault.t(I18N_KEYS.ProductIntroBullet3)}</li>
      </ul>
      <Button
        type="button"
        variant="link"
        size="sm"
        class="h-auto px-0 pt-0.5 text-sm font-medium text-foreground/80 hover:text-foreground [&_svg]:size-4"
        data-testid="product-intro-help-link"
        onclick={onOpenHelp}
      >
        <BookOpen class="size-4" />
        {vault.t(I18N_KEYS.ProductIntroHowWorks)}
      </Button>
    </div>
  {/if}
</aside>
