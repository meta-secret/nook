<script lang="ts">
  import { CircleCheck } from '@lucide/svelte'

  let { label }: { label: string } = $props()
</script>

<p
  class="flex items-center gap-2 text-sm font-medium text-muted-foreground"
  data-testid="first-run-milestone"
>
  <CircleCheck class="size-4 shrink-0 text-success" aria-hidden="true" />
  {label}
</p>
