<script lang="ts">
  import { ArrowRight, Plus } from '@lucide/svelte'
  import {
    type KeyGraph,
    NodeKind,
    type NodeRef,
    type Passkey,
    Reach,
    storeLabel,
    vaultsForPasskey,
  } from '../_shared/key-graph'
  import { ACCENT, CAPS, MONO, QUOTE, RULE, STATEMENT } from './console-ui'
  import { type Lead, leadFor, leadId, LeadKind, usableHere } from './lead'

  interface Props {
    graph: KeyGraph
    selected: NodeRef
    onPick: (node: NodeRef) => void
    onAdd: () => void
  }

  let { graph, selected, onPick, onAdd }: Props = $props()

  /** One identity leads, the way one account leads on a sign-in screen. */
  const lead: Lead = $derived(leadFor(graph, selected))
  const rest = $derived(
    graph.passkeys.filter((passkey) => passkey.id !== leadId(lead)),
  )

  function stateWord(passkey: Passkey): string {
    if (usableHere(graph, passkey)) return 'ready here'
    if (passkey.reach === Reach.Elsewhere) return 'not in this browser'
    return 'other devices only'
  }

  function vaultWord(passkey: Passkey): string {
    const count = vaultsForPasskey(graph, passkey.id).length
    return count === 1 ? '1 vault' : `${count} vaults`
  }
</script>

<h1 class={STATEMENT}>
  {#if lead.kind === LeadKind.Ready}
    Continue as {lead.passkey.label}.
  {:else if lead.kind === LeadKind.Away}
    {lead.passkey.label} is not in this browser.
  {:else}
    No identity works in this browser yet.
  {/if}
</h1>

{#if lead.kind === LeadKind.None}
  <p
    class="{QUOTE} mt-10 max-w-xl border-dashed text-base leading-7 text-[#9d9c98]"
  >
    Every passkey you hold lives somewhere else right now. Present one, or enrol
    a new one for this browser.
  </p>
{:else}
  <div class="{QUOTE} mt-10 max-w-xl">
    <p class="text-lg leading-7 sm:text-xl">{storeLabel(lead.passkey.store)}</p>
    <p class="{CAPS} mt-4 text-[#6d6d6a]">Passkey Nook compares</p>
    <p class="{MONO} mt-1.5 text-sm text-[#c9c8c4]">{lead.passkey.shortId}</p>
  </div>

  {#if lead.kind === LeadKind.Ready}
    <button
      type="button"
      class="mt-10 flex items-center gap-3 self-start rounded-full px-6 py-3 text-sm font-medium text-[#08090a] transition hover:opacity-90 motion-reduce:transition-none"
      style={`background:${ACCENT}`}
    >
      Continue
      <ArrowRight class="size-4" aria-hidden="true" />
    </button>
  {:else}
    <p class="{CAPS} mt-8 text-[#6d6d6a]">
      Open it where {storeLabel(lead.passkey.store)} is unlocked
    </p>
  {/if}
{/if}

{#if rest.length > 0}
  <p class="{CAPS} mt-14 text-[#6d6d6a]">Other identities</p>

  <ul class="mt-1 max-w-3xl">
    {#each rest as passkey (passkey.id)}
      <li class="border-t {RULE}">
        <button
          type="button"
          class="group flex w-full flex-wrap items-baseline gap-x-5 gap-y-1 py-4 text-left"
          aria-label={`Continue as ${passkey.label}, passkey ${passkey.shortId} in ${storeLabel(passkey.store)}`}
          onclick={() => onPick({ kind: NodeKind.Passkey, id: passkey.id })}
        >
          <span class="min-w-0 basis-full sm:flex-1 sm:basis-0">
            <span
              class="block text-base transition group-hover:text-[#f4f3f0] motion-reduce:transition-none"
            >
              {passkey.label}
            </span>
            <span class="mt-1 block text-sm text-[#6d6d6a]">
              {storeLabel(passkey.store)}
            </span>
          </span>
          <span class="{MONO} shrink-0 text-sm text-[#c9c8c4]">
            {passkey.shortId}
          </span>
          <span class="{CAPS} shrink-0 text-[#6d6d6a] sm:w-44 sm:text-right">
            {stateWord(passkey)}
          </span>
          <span class="{CAPS} shrink-0 text-[#6d6d6a] sm:w-20 sm:text-right">
            {vaultWord(passkey)}
          </span>
        </button>
      </li>
    {/each}
  </ul>
{/if}

<button
  type="button"
  class="{CAPS} mt-10 flex items-center gap-3 self-start text-[#6d6d6a] transition hover:text-[#f4f3f0] motion-reduce:transition-none"
  onclick={onAdd}
>
  <Plus class="size-4" aria-hidden="true" />
  Add identity
</button>
