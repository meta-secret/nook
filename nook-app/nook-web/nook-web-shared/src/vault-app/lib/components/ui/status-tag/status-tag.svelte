<script lang="ts">
  import type { Snippet } from 'svelte'
  import { cn } from '$lib/utils'
  import { StatusMark, StatusTone, StatusToneClass } from './status-tag-state'

  let {
    tone = StatusTone.Neutral,
    mark = StatusMark.Dot,
    label,
    title = '',
    class: className = '',
    icon,
    testId = '',
  }: {
    tone?: StatusTone
    mark?: StatusMark
    label: string
    title?: string
    class?: string
    icon?: Snippet
    testId?: string
  } = $props()

  const toneClass = $derived(new StatusToneClass(tone).name)
</script>

<span
  class={cn('nk-tag', toneClass, className)}
  title={title || undefined}
  data-testid={testId || undefined}
  data-tone={tone}
>
  {#if mark === StatusMark.Dot}
    <i class="nk-tag-dot" aria-hidden="true"></i>
  {:else if mark === StatusMark.Icon}
    {@render icon?.()}
  {/if}
  {label}
</span>
