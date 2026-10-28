<!-- An identity as key management sees it: its name or words, and the keys
that open it. The key of this browser is set apart. -->
<script lang="ts">
  import { KeyRound, Lock, Smartphone, UserRound } from '@lucide/svelte'
  import type { IdentityFixture } from './machine'
  import { ui } from '../identity-first/ui'

  let {
    identity,
    tag = '',
    opens = true,
  }: { identity: IdentityFixture; tag?: string; opens?: boolean } = $props()
</script>

<article class="{ui.plate} space-y-3">
  <div class="flex items-start gap-4">
    <span class={ui.choiceIcon} aria-hidden="true">
      {#if opens}<UserRound class="size-4" />{:else}<Lock class="size-4" />{/if}
    </span>
    <div class="min-w-0 flex-1">
      <div class="flex flex-wrap items-baseline justify-between gap-x-3">
        <p class="text-[17px] font-semibold">{identity.name || identity.words}</p>
        {#if tag}<span class={opens ? ui.tagOk : ui.tag}>{tag}</span>{/if}
      </div>
      {#if identity.name}
        <p class="mt-0.5 font-mono text-[12px] text-[#80858c]">{identity.words}</p>
      {/if}
    </div>
  </div>
  <ul class="space-y-1 pl-14">
    {#each identity.keys as key (key.id)}
      <li class="flex items-center gap-2 font-mono text-[12px] {key.here ? 'text-[#e9e8e4]' : 'text-[#80858c]'}">
        {#if key.kind === 'passkey'}<KeyRound class="size-3.5" aria-hidden="true" />{:else}<Smartphone class="size-3.5" aria-hidden="true" />{/if}
        {key.label}
      </li>
    {/each}
  </ul>
</article>
