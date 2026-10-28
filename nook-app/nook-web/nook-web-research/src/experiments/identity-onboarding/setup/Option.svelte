<!-- A choice the user clicks as a whole: a leading mark, a title and one
short line, and its state on the right — an arrow, a spinner while it works,
a check once done. A titanium edge lights on hover and once picked. -->
<script lang="ts">
  import { ArrowRight, Check, LoaderCircle } from '@lucide/svelte'
  import type { Snippet } from 'svelte'
  import { OptionState } from './option-state'

  let {
    title,
    hint = '',
    action = '',
    state = OptionState.Idle,
    disabled = false,
    onPick,
    lead,
    badge,
  }: {
    title: string
    hint?: string
    /** The verb on the right, when the arrow alone would be unclear. */
    action?: string
    state?: OptionState
    disabled?: boolean
    onPick: () => void
    lead: Snippet
    badge?: Snippet
  } = $props()

  const busy = $derived(state !== OptionState.Idle)
</script>

<button
  type="button"
  class="group relative flex w-full items-center gap-4 bg-[#181b1e] py-4 pr-4 pl-5 text-left transition before:absolute before:inset-y-0 before:left-0 before:w-[2px] before:transition hover:bg-[#1d2124] disabled:cursor-not-allowed disabled:opacity-40 {state === OptionState.Done ? 'before:bg-[#9cc3a4]' : state === OptionState.Working ? 'before:bg-[#8fa3c0]' : 'before:bg-transparent hover:before:bg-[#8fa3c0]'}"
  disabled={disabled || busy}
  onclick={onPick}
>
  {@render lead()}
  <span class="min-w-0 flex-1">
    <span class="block truncate text-[15px] font-semibold text-[#e9e8e4]">{title}</span>
    {#if hint || badge}
      <span class="mt-1 flex min-w-0 items-center gap-2.5">
        {@render badge?.()}
        {#if hint}<span class="truncate text-[13px] text-[#80858c]">{hint}</span>{/if}
      </span>
    {/if}
  </span>
  {#if state === OptionState.Working}
    <LoaderCircle class="size-4 shrink-0 animate-spin text-[#8fa3c0]" aria-label="Working" />
  {:else if state === OptionState.Done}
    <Check class="size-4 shrink-0 text-[#9cc3a4]" aria-label="Done" />
  {:else}
    <span class="flex shrink-0 items-center gap-1.5 text-[13px] font-medium text-[#a4a8ae] transition group-hover:text-[#e9e8e4]">
      {action}
      <ArrowRight class="size-4 transition group-hover:translate-x-0.5" aria-hidden="true" />
    </span>
  {/if}
</button>
