<script lang="ts">
  import {
    type Device,
    devicesForVault,
    type Highlight,
    isHere,
    type KeyGraph,
    NodeKind,
    type NodeRef,
    openableHere,
    type Passkey,
    passkeysForVault,
    Reach,
    storeLabel,
    type Vault,
  } from '../_shared/key-graph'
  import { ACCENT, CAPS, MONO, RULE, STATEMENT } from './console-ui'

  interface Props {
    graph: KeyGraph
    selected: NodeRef
    highlight: Highlight
    onPick: (node: NodeRef) => void
  }

  let { graph, selected, highlight, onPick }: Props = $props()

  function carriers(vault: Vault, passkey: Passkey): Device[] {
    return devicesForVault(graph, vault).filter((device) =>
      device.passkeyIds.includes(passkey.id),
    )
  }

  /** This browser's own device key carries the passkey into this vault. */
  function worksHere(vault: Vault, passkey: Passkey): boolean {
    return (
      passkey.reach === Reach.Here &&
      carriers(vault, passkey).some((device) => isHere(graph, device))
    )
  }

  /** The route, named by the device in the middle rather than described. */
  function routeWord(vault: Vault, passkey: Passkey): string {
    const devices = carriers(vault, passkey)
    const mine = devices.find((device) => isHere(graph, device))
    if (mine && passkey.reach === Reach.Here) return 'via this browser'
    return devices.map((device) => `via ${device.shortId}`).join(' · ')
  }

  function isChosen(kind: NodeKind, id: string): boolean {
    return selected.kind === kind && selected.id === id
  }

  function nameInk(lit: boolean, chosen: boolean): string {
    if (chosen) return 'text-[#f4f3f0] underline underline-offset-4'
    return lit ? 'text-[#f4f3f0]' : 'text-[#9d9c98]'
  }
</script>

<h1 class={STATEMENT}>Which identity opens what.</h1>

<ul class="mt-12 max-w-3xl">
  {#each graph.vaults as vault (vault.id)}
    {@const here = openableHere(graph, vault)}
    {@const lit = highlight.vaultIds.includes(vault.id)}
    {@const chosen = isChosen(NodeKind.Vault, vault.id)}
    <li class="border-t {RULE} py-6">
      <button
        type="button"
        aria-pressed={chosen}
        class="flex w-full flex-wrap items-baseline gap-x-5 gap-y-1 text-left"
        onclick={() => onPick({ kind: NodeKind.Vault, id: vault.id })}
      >
        <span
          class={`min-w-0 basis-full text-lg transition motion-reduce:transition-none sm:flex-1 sm:basis-0 sm:text-xl ${nameInk(lit, chosen)}`}
        >
          {vault.label}
        </span>
        <span class="{MONO} shrink-0 text-sm text-[#c9c8c4]">
          {vault.shortId}
        </span>
        <span
          class="{CAPS} shrink-0 sm:w-28 sm:text-right"
          style={here ? `color:${ACCENT}` : 'color:#6d6d6a'}
        >
          {here ? 'opens here' : 'not here'}
        </span>
      </button>

      <p class="{CAPS} mt-2 text-[#6d6d6a]">{vault.secrets} secrets</p>

      <ul
        class={`mt-5 space-y-3 border-l-2 pl-5 ${lit ? 'border-[#6d6d6a]' : 'border-[#3a3b3d]'}`}
      >
        {#each passkeysForVault(graph, vault) as passkey (passkey.id)}
          {@const keyLit = highlight.passkeyIds.includes(passkey.id)}
          <li>
            <button
              type="button"
              aria-pressed={isChosen(NodeKind.Passkey, passkey.id)}
              aria-label={`Passkey ${passkey.shortId} in ${storeLabel(passkey.store)}`}
              class="flex w-full flex-wrap items-baseline gap-x-4 gap-y-0.5 text-left"
              onclick={() => onPick({ kind: NodeKind.Passkey, id: passkey.id })}
            >
              <span
                class={`${MONO} shrink-0 text-sm ${keyLit ? 'text-[#f4f3f0]' : 'text-[#9d9c98]'}`}
              >
                {passkey.shortId}
              </span>
              <span
                class={`min-w-0 flex-1 text-sm ${keyLit ? 'text-[#dcdbd7]' : 'text-[#6d6d6a]'}`}
              >
                {storeLabel(passkey.store)}
              </span>
              <span
                class="{CAPS} shrink-0"
                style={worksHere(vault, passkey)
                  ? `color:${ACCENT}`
                  : 'color:#6d6d6a'}
              >
                {routeWord(vault, passkey)}
              </span>
            </button>
          </li>
        {:else}
          <li class="text-sm text-[#9d9c98]">No passkey reaches this vault.</li>
        {/each}
      </ul>
    </li>
  {/each}
</ul>
