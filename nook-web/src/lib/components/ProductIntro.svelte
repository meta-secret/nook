<script lang="ts">
  import { BookOpen, ChevronDown, Info } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'

  let { onOpenHelp }: { onOpenHelp: () => void } = $props()
  let open = $state(false)
</script>

<aside
  class="overflow-hidden rounded-xl border border-border/60 bg-card/60 text-sm text-muted-foreground"
  data-testid="product-intro"
>
  <button
    type="button"
    class="flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-muted/30 {open
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
      <span class="block text-sm font-semibold text-foreground">
        Why Nook?
      </span>
      {#if !open}
        <span class="block truncate text-xs text-muted-foreground">
          Your device is the key
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
      class="space-y-2 border-t border-border/40 bg-background/50 px-3.5 py-3"
      data-testid="product-intro-panel"
    >
      <p class="text-base font-semibold leading-snug text-foreground">
        Your device is the key
      </p>
      <p class="text-pretty">
        No master password. Your devices unlock the vault.
      </p>
      <ul class="list-disc space-y-1 pl-5 text-pretty">
        <li>Passwordless access to your secrets.</li>
        <li>Your secrets. Your storage. Your keys.</li>
        <li>A decentralized vault for your secrets.</li>
      </ul>
      <Button
        type="button"
        variant="link"
        size="sm"
        class="h-auto px-0 pt-1 text-primary underline underline-offset-4 hover:text-primary/80 [&_svg]:size-4"
        data-testid="product-intro-help-link"
        onclick={onOpenHelp}
      >
        <BookOpen class="size-4" />
        How Nook works
      </Button>
    </div>
  {/if}
</aside>
