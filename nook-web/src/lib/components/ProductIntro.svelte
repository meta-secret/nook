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
    Decentralized secret manager
  </p>
  <ul class="list-disc space-y-1 pl-4 text-pretty">
    <li>
      No nook account — encrypt here, store the vault file on <em>your</em>
      provider (GitHub or this device).
    </li>
    <li>
      Enroll more browsers over time; each device gets keys so you have more
      ways to unlock and recover access.
    </li>
  </ul>
  <Button
    type="button"
    variant="link"
    size="sm"
    class="mt-2 h-auto px-0 text-primary"
    data-testid="product-intro-help-link"
    onclick={onOpenHelp}
  >
    Read architecture & join guide
  </Button>
</aside>
