<!-- The keys that open an identity, this browser's key set apart. -->
<script lang="ts">
  import { KeyRound, Smartphone } from '@lucide/svelte'
  import type { IdentityFixture } from './machine'

  let { identity }: { identity: IdentityFixture } = $props()
</script>

<span class="block border-t border-[#24272b] pt-3">
  {#if identity.name}
    <span class="mb-2 block font-mono text-[12px] text-[#80858c]">{identity.words}</span>
  {/if}
  <span class="block space-y-1">
    {#each identity.keys as key (key.id)}
      <span class="flex items-center gap-2 font-mono text-[12px] {key.here ? 'text-[#e9e8e4]' : 'text-[#80858c]'}">
        {#if key.kind === 'passkey'}<KeyRound class="size-3.5 shrink-0" aria-hidden="true" />{:else}<Smartphone class="size-3.5 shrink-0" aria-hidden="true" />{/if}
        {key.label}
      </span>
    {/each}
  </span>
</span>
