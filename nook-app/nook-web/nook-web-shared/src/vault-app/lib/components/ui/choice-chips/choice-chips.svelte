<!--
A short list of choices shown at once as square chips, one of them picked:
the visible replacement for a native dropdown. Arrow keys move the pick, as
in any radio group.
-->
<script lang="ts">
  import type { ChoiceChip } from './choice-chip'

  let {
    label,
    choices,
    value,
    disabled,
    testid,
    onpick,
  }: {
    /** What the group chooses, for screen readers. */
    label: string
    choices: readonly ChoiceChip[]
    value: string
    disabled: boolean
    /** The group's test id; each chip adds `-<value>`. */
    testid: string
    onpick: (value: string) => void
  } = $props()

  /** How far an arrow key moves the pick; any other key moves nothing. */
  function offset(key: string): number {
    switch (key) {
      case 'ArrowRight':
      case 'ArrowDown':
        return 1
      case 'ArrowLeft':
      case 'ArrowUp':
        return choices.length - 1
      default:
        return 0
    }
  }

  function step(event: KeyboardEvent): void {
    const moved = offset(event.key)
    if (moved === 0) return
    event.preventDefault()
    const at = choices.findIndex((choice) => choice.value === value)
    const next = (at + moved) % choices.length
    for (const [index, choice] of choices.entries()) {
      if (index === next) onpick(choice.value)
    }
    const group = event.currentTarget
    if (!(group instanceof HTMLElement)) return
    for (const [index, button] of group.querySelectorAll('button').entries()) {
      if (index === next) button.focus()
    }
  }
</script>

<div
  class="flex flex-wrap gap-1.5"
  role="radiogroup"
  aria-label={label}
  data-testid={testid}
  tabindex="-1"
  onkeydown={step}
>
  {#each choices as choice (choice.value)}
    {@const picked = choice.value === value}
    <button
      type="button"
      role="radio"
      aria-checked={picked}
      tabindex={picked ? 0 : -1}
      class="inline-flex h-8 items-center border px-2.5 text-xs transition-colors disabled:opacity-50 {picked
        ? 'border-foreground/70 bg-accent text-foreground'
        : 'border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground'}"
      data-testid="{testid}-{choice.value}"
      {disabled}
      onclick={() => onpick(choice.value)}
    >
      {choice.label}
    </button>
  {/each}
</div>
