<!--
The "Create a new identity" option under the identities a sync provider
holds. Setup names a fresh identity from it; the Sync page saves the
identity in use there as a new one.
-->
<script lang="ts">
  import { Plus, RefreshCw } from '@lucide/svelte'

  let {
    title,
    detail,
    testId,
    disabled,
    busy = false,
    onCreate,
  }: {
    title: string
    detail: string
    testId: string
    disabled: boolean
    /** The option's own action runs. */
    busy?: boolean
    onCreate: () => void
  } = $props()
</script>

<button
  type="button"
  class="group flex w-full items-center gap-3 bg-foreground/[0.04] p-4 text-left transition-colors hover:bg-foreground/[0.08] disabled:opacity-60"
  data-testid={testId}
  {disabled}
  onclick={onCreate}
>
  <span class="nk-tile shrink-0" aria-hidden="true">
    {#if busy}
      <RefreshCw class="size-4 animate-spin" />
    {:else}
      <Plus class="size-4" />
    {/if}
  </span>
  <span class="min-w-0 flex-1">
    <span class="block text-sm font-semibold text-foreground">{title}</span>
    <span class="block text-xs text-pretty text-muted-foreground">{detail}</span>
  </span>
</button>
