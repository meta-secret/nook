<!-- Where identities are, drawn: this browser on the left, the sync
provider's folder on the right, and what links them. -->
<script lang="ts">
  import { ArrowLeftRight, Cloud, KeyRound, Monitor, Plus, Send } from '@lucide/svelte'
  import IdentityToken from './IdentityToken.svelte'
  import { SceneLink, type Token } from './machine'

  let {
    browser,
    provider = '',
    remote = [],
    link = SceneLink.None,
  }: {
    browser: readonly Token[]
    /** The provider's name; empty when none is connected. */
    provider?: string
    remote?: readonly Token[]
    link?: SceneLink
  } = $props()

  const zone = 'flex min-h-[132px] flex-col gap-2 border border-[#24272b] bg-[#0f1113] p-3'
  const head = 'mb-1 flex items-center gap-2 font-mono text-[11px] tracking-[0.14em] text-[#80858c] uppercase'
</script>

<div class="grid grid-cols-[minmax(0,1fr)_44px_minmax(0,1fr)] items-stretch" aria-label="Where your identities are">
  <div class={zone}>
    <p class={head}><Monitor class="size-3.5" aria-hidden="true" /> This browser</p>
    {#each browser as token (token.id)}
      <IdentityToken {token} />
    {:else}
      <span class="m-auto font-mono text-[12px] text-[#4a5058]">empty</span>
    {/each}
  </div>

  <div class="flex items-center justify-center text-[#5d6268]" aria-hidden="true">
    {#if link === SceneLink.Sync}
      <ArrowLeftRight class="size-4 text-[#a4a8ae]" />
    {:else if link === SceneLink.Request}
      <Send class="size-4 text-[#d2b07a]" />
    {:else if link === SceneLink.Passkey}
      <KeyRound class="size-4 text-[#9cc3a4]" />
    {:else}
      <span class="h-px w-6 bg-[#2c3035]"></span>
    {/if}
  </div>

  {#if provider}
    <div class={zone}>
      <p class={head}><Cloud class="size-3.5" aria-hidden="true" /> {provider}</p>
      {#each remote as token (token.id)}
        <IdentityToken {token} />
      {:else}
        <span class="m-auto font-mono text-[12px] text-[#4a5058]">empty</span>
      {/each}
    </div>
  {:else}
    <div class="{zone} items-center justify-center border-dashed text-[#4a5058]">
      <Plus class="size-5" aria-hidden="true" />
      <span class="font-mono text-[11px] tracking-[0.14em] uppercase">sync</span>
    </div>
  {/if}
</div>
