<!-- A task that sits over home: the home stays dimmed behind it, and closing
the sheet returns to it. -->
<script lang="ts">
  import { X } from '@lucide/svelte'
  import type { Snippet } from 'svelte'
  import { fade, fly } from 'svelte/transition'

  let { title, onClose, children }: { title: string; onClose: () => void; children: Snippet } = $props()
</script>

<div class="absolute inset-0 z-10 bg-[#060708]/70" transition:fade={{ duration: 160 }}>
  <button type="button" class="absolute inset-0 cursor-default" aria-label="Close" onclick={onClose}></button>
</div>
<section
  class="absolute inset-x-0 bottom-0 z-20 max-h-[86%] overflow-y-auto bg-[#16191c] px-5 pt-5 pb-7"
  transition:fly={{ y: 48, duration: 220 }}
  aria-label={title}
>
  <header class="mb-5 flex items-center justify-between gap-4">
    <h2 class="text-[20px] font-semibold tracking-tight">{title}</h2>
    <button type="button" class="grid size-8 place-items-center text-[#80858c] transition hover:text-[#e9e8e4]" aria-label="Close" onclick={onClose}>
      <X class="size-4" aria-hidden="true" />
    </button>
  </header>
  {@render children()}
</section>
