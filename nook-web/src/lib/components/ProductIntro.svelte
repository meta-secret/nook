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
    Passwordless by design
  </p>
  <ul class="list-disc space-y-1 pl-4 text-pretty">
    <li>No master password. Your approved devices unlock the vault.</li>
    <li>Your secrets are encrypted here and stored where you choose.</li>
  </ul>
  <Button
    type="button"
    variant="link"
    size="sm"
    class="mt-2 h-auto px-0 text-primary"
    data-testid="product-intro-help-link"
    onclick={onOpenHelp}
  >
    Why Nook and how it works
  </Button>
</aside>
