<script lang="ts">
  import { Plus } from '@lucide/svelte'
  import {
    type Highlight,
    hereDevices,
    isHere,
    type KeyGraph,
    NodeKind,
    type NodeRef,
    type Passkey,
    passkeysForDevice,
    Reach,
    storeLabel,
    vaultsForDevice,
    vaultsForPasskey,
  } from '../_shared/key-graph'
  import {
    ACCENT,
    CAPS,
    MONO,
    QUOTE,
    RULE,
    STATEMENT,
    storeNote,
  } from './console-ui'

  interface Props {
    graph: KeyGraph
    selected: NodeRef
    highlight: Highlight
    onPick: (node: NodeRef) => void
    onAdd: () => void
  }

  let { graph, selected, highlight, onPick, onAdd }: Props = $props()

  const others = $derived(
    graph.devices.filter((device) => !isHere(graph, device)),
  )

  function usableHere(passkey: Passkey): boolean {
    return (
      passkey.reach === Reach.Here &&
      hereDevices(graph).some((device) =>
        device.passkeyIds.includes(passkey.id),
      )
    )
  }

  function stateWord(passkey: Passkey): string {
    if (usableHere(passkey)) return 'active here'
    if (passkey.reach === Reach.Elsewhere) return 'not in this browser'
    return 'other devices only'
  }

  function vaultWord(count: number): string {
    return count === 1 ? 'opens 1 vault' : `opens ${count} vaults`
  }

  function isChosen(kind: NodeKind, id: string): boolean {
    return selected.kind === kind && selected.id === id
  }

  function nameInk(lit: boolean, chosen: boolean): string {
    if (chosen) return 'text-[#f4f3f0] underline underline-offset-4'
    return lit ? 'text-[#f4f3f0]' : 'text-[#9d9c98]'
  }
</script>

<h1 class={STATEMENT}>Every passkey Nook has seen sign in as you.</h1>

<ul class="mt-12 max-w-3xl">
  {#each graph.passkeys as passkey (passkey.id)}
    {@const lit = highlight.passkeyIds.includes(passkey.id)}
    {@const chosen = isChosen(NodeKind.Passkey, passkey.id)}
    <li class="border-t {RULE}">
      <button
        type="button"
        aria-pressed={chosen}
        class="w-full py-6 text-left"
        onclick={() => onPick({ kind: NodeKind.Passkey, id: passkey.id })}
      >
        <span class="flex flex-wrap items-baseline gap-x-5 gap-y-1">
          <span
            class={`min-w-0 basis-full text-lg transition motion-reduce:transition-none sm:flex-1 sm:basis-0 sm:text-xl ${nameInk(lit, chosen)}`}
          >
            {storeLabel(passkey.store)}
          </span>
          <span class="{MONO} shrink-0 text-sm text-[#c9c8c4]">
            {passkey.shortId}
          </span>
          <span
            class="{CAPS} shrink-0 sm:w-44 sm:text-right"
            style={usableHere(passkey) ? `color:${ACCENT}` : 'color:#6d6d6a'}
          >
            {stateWord(passkey)}
          </span>
        </span>

        <span class="mt-4 grid gap-x-8 gap-y-4 sm:grid-cols-2">
          <span class="block">
            <span class="{CAPS} block text-[#6d6d6a]">Last used</span>
            <span class="mt-1.5 block text-sm text-[#dcdbd7]">
              {passkey.lastUsedAt}
            </span>
          </span>
          <span class="block">
            <span class="{CAPS} block text-[#6d6d6a]">Kept</span>
            <span class="mt-1.5 block text-sm leading-6 text-[#9d9c98]">
              {storeNote(passkey.store)}
            </span>
          </span>
        </span>

        <span class="{CAPS} mt-4 block text-[#6d6d6a]">
          {vaultWord(vaultsForPasskey(graph, passkey.id).length)}
        </span>
      </button>
    </li>
  {:else}
    <li class="border-t {RULE} py-6 text-base text-[#9d9c98]">
      You hold no passkey yet.
    </li>
  {/each}
</ul>

<button
  type="button"
  class="{CAPS} mt-8 flex items-center gap-3 self-start text-[#6d6d6a] transition hover:text-[#f4f3f0] motion-reduce:transition-none"
  onclick={onAdd}
>
  <Plus class="size-4" aria-hidden="true" />
  Add access method
</button>

<p class="{CAPS} mt-16 text-[#6d6d6a]">This browser</p>

{#each hereDevices(graph) as device (device.id)}
  <div class="{QUOTE} mt-4 max-w-3xl">
    <button
      type="button"
      aria-pressed={isChosen(NodeKind.Device, device.id)}
      aria-label={`Device key ${device.shortId}, this browser`}
      class="{MONO} block text-lg text-[#f4f3f0] sm:text-xl"
      onclick={() => onPick({ kind: NodeKind.Device, id: device.id })}
    >
      {device.shortId}
    </button>
    <p class="mt-1.5 text-sm text-[#6d6d6a]">{device.platform}</p>

    <dl class="mt-6 grid gap-x-8 gap-y-5 sm:grid-cols-2">
      <div>
        <dt class="{CAPS} text-[#6d6d6a]">Unlocked by</dt>
        <dd class="mt-2 space-y-1.5">
          {#each passkeysForDevice(graph, device) as passkey (passkey.id)}
            <p class="flex items-baseline gap-2.5 text-sm">
              <span class="{MONO} text-[#c9c8c4]">{passkey.shortId}</span>
              <span class="text-[#9d9c98]">{storeLabel(passkey.store)}</span>
            </p>
          {:else}
            <p class="text-sm text-[#9d9c98]">Nothing yet.</p>
          {/each}
        </dd>
      </div>
      <div>
        <dt class="{CAPS} text-[#6d6d6a]">Opens</dt>
        <dd class="mt-2 space-y-1.5">
          {#each vaultsForDevice(graph, device.id) as vault (vault.id)}
            <p class="flex items-baseline gap-2.5 text-sm">
              <span class="{MONO} text-[#c9c8c4]">{vault.shortId}</span>
              <span class="text-[#9d9c98]">{vault.label}</span>
            </p>
          {:else}
            <p class="text-sm text-[#9d9c98]">No vault yet.</p>
          {/each}
        </dd>
      </div>
    </dl>

    <div class="mt-6 flex flex-wrap items-center gap-6">
      <button
        type="button"
        class="{CAPS} text-[#6d6d6a] transition hover:text-[#f4f3f0] motion-reduce:transition-none"
      >
        Rename
      </button>
      <button
        type="button"
        class="{CAPS} text-[#6d6d6a] transition hover:text-[#ff6b3d] motion-reduce:transition-none"
      >
        Sign out
      </button>
    </div>
  </div>
{:else}
  <p
    class="{QUOTE} mt-4 max-w-xl border-dashed text-base leading-7 text-[#9d9c98]"
  >
    This browser holds no device key, so it decrypts nothing. Presenting an
    identity gives it one.
  </p>
{/each}

{#if others.length > 0}
  <p class="{CAPS} mt-14 text-[#6d6d6a]">Other devices</p>
  <ul class="mt-1 max-w-3xl">
    {#each others as device (device.id)}
      {@const lit = highlight.deviceIds.includes(device.id)}
      <li class="border-t {RULE}">
        <button
          type="button"
          aria-pressed={isChosen(NodeKind.Device, device.id)}
          class="flex w-full flex-wrap items-baseline gap-x-5 gap-y-1 py-3.5 text-left"
          onclick={() => onPick({ kind: NodeKind.Device, id: device.id })}
        >
          <span
            class={`${MONO} shrink-0 text-sm ${lit ? 'text-[#c9c8c4]' : 'text-[#6d6d6a]'}`}
          >
            {device.shortId}
          </span>
          <span class="min-w-0 flex-1 text-sm text-[#9d9c98]">
            {device.label}
          </span>
          <span class="{CAPS} shrink-0 text-[#6d6d6a]">{device.platform}</span>
        </button>
      </li>
    {/each}
  </ul>
{/if}
