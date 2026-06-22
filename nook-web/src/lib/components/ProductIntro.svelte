<script lang="ts">
  import { Info } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'

  let { onOpenHelp }: { onOpenHelp: () => void } = $props()
</script>

<aside
  class="rounded-lg border border-border/80 bg-muted/25 px-4 py-3 text-sm text-muted-foreground"
  data-testid="product-intro"
>
  <p class="mb-2 font-medium text-foreground inline-flex items-center gap-1.5">
    <Info class="size-3.5 shrink-0" />
    Why Nook?
  </p>
  <p class="text-pretty">Learn how device keys, storage, and recovery work.</p>
  <Button
    type="button"
    variant="link"
    size="sm"
    class="mt-2 h-auto px-0 text-primary"
    data-testid="product-intro-help-link"
    onclick={onOpenHelp}
  >
    How Nook works
  </Button>
</aside>
