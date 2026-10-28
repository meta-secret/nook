<!-- One identity: its name (or three words), its words, and the facts its
public log tells. Nothing about single vaults. -->
<script lang="ts">
  import { Lock, UserRound } from '@lucide/svelte'
  import type { Snippet } from 'svelte'
  import type { IdentityFixture } from './flow'
  import { ui } from './ui'

  let {
    identity,
    opens = true,
    tag = '',
    children,
  }: {
    identity: IdentityFixture
    opens?: boolean
    tag?: string
    children?: Snippet
  } = $props()
</script>

<article class="{ui.plate} space-y-3">
  <div class="flex items-start gap-4">
    <span class={ui.choiceIcon} aria-hidden="true">
      {#if opens}<UserRound class="size-4" />{:else}<Lock class="size-4" />{/if}
    </span>
    <div class="min-w-0 flex-1">
      <div class="flex flex-wrap items-baseline justify-between gap-x-3">
        <p class="text-[17px] font-semibold">
          {identity.name || identity.words}
        </p>
        {#if tag}<span class={opens ? ui.tagOk : ui.tag}>{tag}</span>{/if}
      </div>
      <p class="mt-1 font-mono text-[12px] text-[#80858c]">
        {#if identity.name}{identity.words} · {/if}{identity.devices}
        {identity.devices === 1 ? 'device' : 'devices'} · {identity.vaults}
        {identity.vaults === 1 ? 'vault' : 'vaults'}
      </p>
    </div>
  </div>
  {@render children?.()}
</article>
