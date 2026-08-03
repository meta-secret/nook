<script lang="ts">
  import { ArrowRight, Plus, SquarePen } from '@lucide/svelte'
  import {
    hereDevices,
    type KeyGraph,
    NodeKind,
    type NodeRef,
    type Passkey,
    Reach,
    storeLabel,
    vaultsForPasskey,
  } from '../_shared/key-graph'
  import { CAPS, CARD, MONO, TITLE } from './console-ui'
  import StoreMark from './StoreMark.svelte'

  interface Props {
    graph: KeyGraph
    onPick: (node: NodeRef) => void
    onAdd: () => void
  }

  let { graph, onPick, onAdd }: Props = $props()

  /** One identity leads, the way one account leads on a sign-in screen. */
  const lead = $derived(graph.passkeys.find(usableHere))
  const rest = $derived(
    graph.passkeys.filter((passkey) => passkey.id !== lead?.id),
  )

  function usableHere(passkey: Passkey): boolean {
    return (
      passkey.reach === Reach.Here &&
      hereDevices(graph).some((device) =>
        device.passkeyIds.includes(passkey.id),
      )
    )
  }

  function vaultWord(passkey: Passkey): string {
    const count = vaultsForPasskey(graph, passkey.id).length
    return count === 1 ? '1 vault' : `${count} vaults`
  }

  function stateWord(passkey: Passkey): string {
    if (passkey.reach === Reach.Elsewhere) return 'not in this browser'
    return 'other devices only'
  }
</script>

<h1 class={TITLE}>Manage your identity</h1>
<p class="mt-2 text-[14px] text-white/45">
  An identity is a passkey. Nook holds as many as you enrol.
</p>

{#if lead}
  <div class="{CARD} mt-7 flex flex-wrap items-center gap-x-4 gap-y-3 p-3.5">
    <StoreMark store={lead.store} large />
    <span class="min-w-0 flex-1">
      <button
        type="button"
        class="block max-w-full truncate text-left text-[15px] hover:underline"
        onclick={() => onPick({ kind: NodeKind.Passkey, id: lead.id })}
      >
        {lead.label}
      </button>
      <span class="mt-0.5 flex items-center gap-2 text-[12px] text-white/45">
        {storeLabel(lead.store)}
        <span class={`${MONO} text-white/70`}>{lead.shortId}</span>
      </span>
    </span>
    <button
      type="button"
      class="flex items-center gap-2 rounded-lg bg-white px-4 py-2.5 text-[13px] font-medium text-black transition hover:bg-white/85 motion-reduce:transition-none"
    >
      Continue
      <ArrowRight class="size-4" aria-hidden="true" />
    </button>
  </div>
{:else}
  <div class="{CARD} mt-7 border-dashed p-5">
    <p class="text-[15px]">No identity works in this browser yet.</p>
    <p class="mt-1 text-[13px] text-white/45">
      Continue with one of the passkeys below, or enrol a new one.
    </p>
  </div>
{/if}

{#if rest.length > 0}
  <div class="mt-8 flex items-center justify-between">
    <p class="text-[13px] text-white/45">Or continue with another identity</p>
    <button
      type="button"
      class="rounded-md p-1.5 text-white/45 transition hover:bg-white/10 hover:text-white motion-reduce:transition-none"
      aria-label="Edit identities"
    >
      <SquarePen class="size-4" aria-hidden="true" />
    </button>
  </div>

  <ul class="mt-2 space-y-2.5">
    {#each rest as passkey (passkey.id)}
      <li>
        <button
          type="button"
          class="{CARD} flex w-full items-center gap-3.5 p-3.5 text-left transition hover:border-white/25 motion-reduce:transition-none"
          onclick={() => onPick({ kind: NodeKind.Passkey, id: passkey.id })}
        >
          <StoreMark store={passkey.store} />
          <span class="min-w-0 flex-1">
            <span class="block truncate text-[14px]">{passkey.label}</span>
            <span class="mt-0.5 flex items-center gap-2 text-[12px]">
              <span class="text-white/45">{storeLabel(passkey.store)}</span>
              <span class={`${MONO} text-white/60`}>{passkey.shortId}</span>
            </span>
          </span>
          {#if usableHere(passkey)}
            <span
              class="flex shrink-0 items-center gap-2 rounded-lg border border-white/20 px-3 py-2 text-[12px]"
            >
              Continue
              <ArrowRight class="size-3.5" aria-hidden="true" />
            </span>
          {:else}
            <span class="flex shrink-0 flex-col items-end gap-1">
              <span class="{CAPS} text-[9px] text-white/35">
                {stateWord(passkey)}
              </span>
              <span class="{CAPS} text-[9px] text-white/25">
                {vaultWord(passkey)}
              </span>
            </span>
          {/if}
        </button>
      </li>
    {/each}
  </ul>
{/if}

<button
  type="button"
  class="mt-6 flex items-center gap-2 rounded-lg border border-white/15 px-3.5 py-2.5 text-[13px] transition hover:border-white/35 motion-reduce:transition-none"
  onclick={onAdd}
>
  <Plus class="size-4" aria-hidden="true" />
  Add identity
</button>
