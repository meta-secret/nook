<!-- Where identities are, drawn as a small map: this browser, and once one
is connected, the sync provider's folder beside it with what links them. A
caption names the map, and a legend lists only the symbols on it. Nothing is
drawn before there is something to show. -->
<script lang="ts">
  import {
    ArrowLeftRight,
    Cloud,
    KeyRound,
    Lock,
    LockOpen,
    Monitor,
    Send,
  } from '@lucide/svelte'
  import IdentityToken from './IdentityToken.svelte'
  import { SceneLink, TokenStatus, type Token } from './machine'

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

  const zone =
    'flex min-h-[120px] flex-col gap-2 border border-[#24272b] bg-[#0f1113] bg-[radial-gradient(#1c1f23_1px,transparent_1px)] [background-size:14px_14px] p-3'
  const head =
    'mb-1 flex items-center gap-2 font-mono text-[11px] tracking-[0.14em] text-[#80858c] uppercase'

  const tokens = $derived([...browser, ...remote])
  const has = (status: TokenStatus) => tokens.some((token) => token.status === status)
</script>

{#if provider || browser.length > 0}
  <figure class="space-y-2">
    <figcaption class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 font-mono text-[11px] text-[#80858c]">
      <span class="tracking-[0.14em] uppercase">Where your identities are</span>
      <span class="flex flex-wrap items-center gap-x-3 gap-y-1 text-[#5d6268]">
        {#if tokens.some((token) => token.keys > 0)}
          <span class="inline-flex items-center gap-1"><KeyRound class="size-3" aria-hidden="true" /> key</span>
        {/if}
        {#if has(TokenStatus.Sealed)}
          <span class="inline-flex items-center gap-1"><Lock class="size-3" aria-hidden="true" /> sealed</span>
        {/if}
        {#if has(TokenStatus.Opened)}
          <span class="inline-flex items-center gap-1 text-[#9cc3a4]"><LockOpen class="size-3" aria-hidden="true" /> opened</span>
        {/if}
        {#if has(TokenStatus.Pending)}
          <span class="inline-flex items-center gap-1 text-[#d2b07a]"><Send class="size-3" aria-hidden="true" /> request</span>
        {/if}
        {#if link === SceneLink.Sync}
          <span class="inline-flex items-center gap-1"><ArrowLeftRight class="size-3" aria-hidden="true" /> synced</span>
        {/if}
      </span>
    </figcaption>

    {#if provider}
      <div class="grid grid-cols-[minmax(0,1fr)_44px_minmax(0,1fr)] items-stretch">
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

        <div class={zone}>
          <p class={head}><Cloud class="size-3.5" aria-hidden="true" /> {provider}</p>
          {#each remote as token (token.id)}
            <IdentityToken {token} />
          {:else}
            <span class="m-auto font-mono text-[12px] text-[#4a5058]">empty</span>
          {/each}
        </div>
      </div>
    {:else}
      <div class="max-w-[320px] {zone} min-h-0">
        <p class={head}><Monitor class="size-3.5" aria-hidden="true" /> This browser</p>
        {#each browser as token (token.id)}
          <IdentityToken {token} />
        {/each}
      </div>
    {/if}
  </figure>
{/if}
