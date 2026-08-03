<script lang="ts">
  import { Laptop, Plus } from '@lucide/svelte'
  import {
    type Device,
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
  import { CAPS, CARD, MONO, TITLE, storeNote } from './console-ui'
  import StoreMark from './StoreMark.svelte'

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
    return count === 1 ? '1 vault' : `${count} vaults`
  }

  function isChosen(kind: NodeKind, id: string): boolean {
    return selected.kind === kind && selected.id === id
  }

  function edge(chosen: boolean): string {
    return chosen ? 'border-white/45' : 'border-white/10 hover:border-white/25'
  }

  function dim(lit: boolean): string {
    return lit ? 'opacity-100' : 'opacity-70'
  }

  function deviceLabel(device: Device): string {
    return isHere(graph, device) ? 'This browser' : device.label
  }
</script>

<h1 class={TITLE}>Access methods</h1>
<p class="mt-2 text-[14px] text-white/45">
  Every passkey that can sign in as you, and where it is kept.
</p>

<ul class="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
  <li>
    <button
      type="button"
      class="flex h-full min-h-44 w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 text-white/55 transition hover:border-white/35 hover:text-white motion-reduce:transition-none"
      onclick={onAdd}
    >
      <Plus class="size-5" aria-hidden="true" />
      <span class="text-[13px]">Add new</span>
    </button>
  </li>

  {#each graph.passkeys as passkey (passkey.id)}
    {@const chosen = isChosen(NodeKind.Passkey, passkey.id)}
    <li class={dim(highlight.passkeyIds.includes(passkey.id))}>
      <button
        type="button"
        aria-pressed={chosen}
        class={`flex h-full w-full flex-col rounded-xl border bg-[#151517] p-4 text-left transition motion-reduce:transition-none ${edge(chosen)}`}
        onclick={() => onPick({ kind: NodeKind.Passkey, id: passkey.id })}
      >
        <span class="flex w-full items-start gap-2">
          <StoreMark store={passkey.store} />
          <span class="ml-auto flex shrink-0 items-center gap-1.5">
            <span
              class={`size-1.5 rounded-full ${usableHere(passkey) ? 'bg-[#3fb984]' : 'border border-white/35'}`}
              aria-hidden="true"
            ></span>
            <span
              class={`${CAPS} text-[9px] ${usableHere(passkey) ? 'text-[#3fb984]' : 'text-white/40'}`}
            >
              {stateWord(passkey)}
            </span>
          </span>
        </span>

        <span class="mt-3 block text-[15px]">{storeLabel(passkey.store)}</span>
        <span class="mt-0.5 flex items-center gap-2 text-[12px] text-white/45">
          Passkey
          <span class={`${MONO} text-white/70`}>{passkey.shortId}</span>
        </span>

        <span class="mt-3.5 block border-t border-white/10 pt-3">
          <span class="{CAPS} block text-[9px] text-white/35">Last used</span>
          <span class="mt-1 block text-[12px] text-white/70">
            {passkey.lastUsedAt}
          </span>
        </span>

        <span class="mt-3 block text-[12px] leading-relaxed text-white/50">
          {storeNote(passkey.store)}
        </span>

        <span class="{CAPS} mt-3 block text-[9px] text-white/45">
          Opens {vaultWord(vaultsForPasskey(graph, passkey.id).length)}
        </span>
      </button>
    </li>
  {/each}
</ul>

<p class="{CAPS} mt-10 text-white/35">This browser</p>

{#each hereDevices(graph) as device (device.id)}
  {@const chosen = isChosen(NodeKind.Device, device.id)}
  <div class={`${CARD} mt-3 p-4 ${chosen ? 'border-white/45' : ''}`}>
    <div class="flex flex-wrap items-start gap-x-4 gap-y-3">
      <div class="min-w-0 flex-1">
        <button
          type="button"
          aria-pressed={chosen}
          aria-label={`Device key ${device.shortId}, this browser`}
          class={`flex items-center gap-2 ${MONO} text-[20px]`}
          onclick={() => onPick({ kind: NodeKind.Device, id: device.id })}
        >
          <Laptop class="size-4 shrink-0 text-white/55" aria-hidden="true" />
          {device.shortId}
        </button>
        <p class="mt-1 text-[12px] text-white/45">{device.platform}</p>
      </div>
      <div class="flex items-center gap-2">
        <button
          type="button"
          class="rounded-lg border border-white/15 px-3 py-1.5 text-[12px] transition hover:border-white/35 motion-reduce:transition-none"
        >
          Rename
        </button>
        <button
          type="button"
          class="rounded-lg border border-[#e07a5f]/35 px-3 py-1.5 text-[12px] text-[#e07a5f] transition hover:border-[#e07a5f] motion-reduce:transition-none"
        >
          Sign out
        </button>
      </div>
    </div>

    <div class="mt-4 grid gap-3 sm:grid-cols-2">
      <div>
        <p class="{CAPS} text-[9px] text-white/35">Unlocked by</p>
        <ul class="mt-1.5 space-y-1">
          {#each passkeysForDevice(graph, device) as passkey (passkey.id)}
            <li class="flex items-center gap-2 text-[12px]">
              <span class={`${MONO} text-white/70`}>{passkey.shortId}</span>
              <span class="truncate text-white/45">
                {storeLabel(passkey.store)}
              </span>
            </li>
          {:else}
            <li class="text-[12px] text-[#e07a5f]">No passkey enrolled</li>
          {/each}
        </ul>
      </div>
      <div>
        <p class="{CAPS} text-[9px] text-white/35">Opens</p>
        <ul class="mt-1.5 space-y-1">
          {#each vaultsForDevice(graph, device.id) as vault (vault.id)}
            <li class="flex items-center gap-2 text-[12px]">
              <span class={`${MONO} text-white/70`}>{vault.shortId}</span>
              <span class="truncate text-white/45">{vault.label}</span>
            </li>
          {:else}
            <li class="text-[12px] text-white/40">No vault yet</li>
          {/each}
        </ul>
      </div>
    </div>
  </div>
{:else}
  <div class="{CARD} mt-3 border-dashed p-4">
    <p class="text-[15px] text-[#e07a5f]">This browser holds no device key.</p>
    <p class="mt-1 text-[12px] text-white/45">
      Sign in with one of your identities to give it one.
    </p>
  </div>
{/each}

{#if others.length > 0}
  <p class="{CAPS} mt-8 text-white/35">Other devices</p>
  <ul class="mt-3 space-y-1.5">
    {#each others as device (device.id)}
      <li class={dim(highlight.deviceIds.includes(device.id))}>
        <button
          type="button"
          aria-pressed={isChosen(NodeKind.Device, device.id)}
          class="flex w-full items-center gap-3 py-1 text-left text-[12px]"
          onclick={() => onPick({ kind: NodeKind.Device, id: device.id })}
        >
          <span class={`${MONO} text-white/60`}>{device.shortId}</span>
          <span class="text-white/45">{deviceLabel(device)}</span>
          <span class="ml-auto text-white/35">{device.platform}</span>
        </button>
      </li>
    {/each}
  </ul>
{/if}
