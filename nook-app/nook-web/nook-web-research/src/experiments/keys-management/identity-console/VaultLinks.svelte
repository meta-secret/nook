<script lang="ts">
  import { Laptop, Vault as VaultIcon } from '@lucide/svelte'
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
  import { CAPS, CARD, MONO, TITLE } from './console-ui'
  import StoreMark from './StoreMark.svelte'

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

  function isChosen(kind: NodeKind, id: string): boolean {
    return selected.kind === kind && selected.id === id
  }

  function dim(lit: boolean): string {
    return lit ? 'opacity-100' : 'opacity-70'
  }
</script>

<h1 class={TITLE}>Vaults</h1>
<p class="mt-2 text-[14px] text-white/45">
  Which identity opens what, and from where.
</p>

<ul class="mt-7 grid gap-3 lg:grid-cols-2">
  {#each graph.vaults as vault (vault.id)}
    {@const here = openableHere(graph, vault)}
    {@const chosen = isChosen(NodeKind.Vault, vault.id)}
    <li
      class={`${CARD} flex flex-col p-4 ${chosen ? 'border-white/45' : ''} ${dim(highlight.vaultIds.includes(vault.id))}`}
    >
      <button
        type="button"
        aria-pressed={chosen}
        class="flex w-full items-center gap-2 text-left"
        onclick={() => onPick({ kind: NodeKind.Vault, id: vault.id })}
      >
        <VaultIcon class="size-4 shrink-0 text-white/55" aria-hidden="true" />
        <span class="min-w-0 flex-1 truncate text-[15px]">{vault.label}</span>
        <span class="flex shrink-0 items-center gap-1.5">
          <span
            class={`size-1.5 rounded-full ${here ? 'bg-[#3fb984]' : 'border border-white/35'}`}
            aria-hidden="true"
          ></span>
          <span
            class={`${CAPS} text-[9px] ${here ? 'text-[#3fb984]' : 'text-white/40'}`}
          >
            {here ? 'opens here' : 'not here'}
          </span>
        </span>
      </button>

      <p class={`mt-2.5 ${MONO} text-[20px]`}>{vault.shortId}</p>
      <p class="{CAPS} mt-1 text-[9px] text-white/45">
        {vault.secrets} secrets
      </p>

      <ul class="mt-3.5 space-y-2 border-t border-white/10 pt-3">
        {#each passkeysForVault(graph, vault) as passkey (passkey.id)}
          {@const vaultLit = highlight.vaultIds.includes(vault.id)}
          <li
            class={dim(!vaultLit || highlight.passkeyIds.includes(passkey.id))}
          >
            <button
              type="button"
              aria-pressed={isChosen(NodeKind.Passkey, passkey.id)}
              aria-label={`Passkey ${passkey.shortId} in ${storeLabel(passkey.store)}`}
              class="flex w-full items-center gap-2.5 text-left"
              onclick={() => onPick({ kind: NodeKind.Passkey, id: passkey.id })}
            >
              <StoreMark store={passkey.store} />
              <span class="min-w-0 flex-1">
                <span class="flex items-center gap-2 text-[12px]">
                  <span class={`${MONO} text-white/75`}>
                    {passkey.shortId}
                  </span>
                  <span class="truncate text-white/45">
                    {storeLabel(passkey.store)}
                  </span>
                </span>
                <span class="mt-1 flex flex-wrap items-center gap-1">
                  {#each carriers(vault, passkey) as device (device.id)}
                    <span
                      class={`flex items-center gap-1 rounded-full border px-1.5 py-0.5 ${CAPS} text-[8px] ${
                        isHere(graph, device)
                          ? 'border-transparent bg-white text-black'
                          : 'border-white/20 text-white/50'
                      }`}
                    >
                      <Laptop class="size-2.5" aria-hidden="true" />
                      {isHere(graph, device) ? 'this browser' : device.shortId}
                    </span>
                  {/each}
                </span>
              </span>
              <span
                class={`size-2 shrink-0 rounded-full ${
                  worksHere(vault, passkey)
                    ? 'bg-[#3fb984]'
                    : 'border border-white/30'
                }`}
                aria-hidden="true"
              ></span>
            </button>
          </li>
        {:else}
          <li class="text-[12px] text-[#e07a5f]">
            No passkey reaches this vault.
          </li>
        {/each}
      </ul>
    </li>
  {/each}
</ul>
