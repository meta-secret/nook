<!--
DIRECTION: Possession drawn as containment, one onion at a time. My device key
sits apart at the top as its own object. Under it a single row of vault cards
is the only selector, and under that a single nested frame: the outer band is
every passkey that opens the chosen vault, the frame inside holds the device
keys — mine in its own accent slot, everyone else's in a quiet cluster — and
the core is the vault.
-->
<script lang="ts">
  import { Fingerprint, Laptop, Vault as VaultIcon } from '@lucide/svelte'
  import ExperimentBack from '$lib/components/ExperimentBack.svelte'
  import GraphSwitch from '../_shared/GraphSwitch.svelte'
  import {
    type Device,
    devicesForVault,
    GraphId,
    graphById,
    hereDevices,
    isHere,
    type KeyGraph,
    KeyStore,
    openableHere,
    passkeysForDevice,
    passkeysForVault,
    Reach,
    storeLabel,
    type Vault,
    vaultsForDevice,
  } from '../_shared/key-graph'
  import type { ExperimentProps } from '../../index'

  const STORE_INK: Record<KeyStore, string> = {
    [KeyStore.ApplePasswords]: '#b9c4cf',
    [KeyStore.Bitwarden]: '#5b8cff',
    [KeyStore.OnePassword]: '#37c493',
    [KeyStore.SecurityKey]: '#e6ad48',
  }

  const CAPTION =
    'font-mono text-[9px] tracking-[0.2em] text-[#5c6772] uppercase'
  const STATE =
    'rounded px-1.5 py-0.5 font-mono text-[9px] tracking-[0.14em] uppercase'
  const CHIP =
    'flex min-w-0 items-center gap-1.5 rounded-md border px-2 py-1.5 text-left'
  const CHIP_QUIET = `${CHIP} border-[#232a33] bg-[#0a0d11]`
  const CHIP_GONE = `${CHIP} border-dashed border-[#39424e] bg-[#0a0d11]`
  const MONO_ID = 'font-mono text-[12px]'
  const MONO_STRUCK = 'font-mono text-[12px] text-[#8d97a3]'
  const DASHED =
    'rounded-md border border-dashed border-[#2b2118] px-2 py-1.5 font-mono text-[10px] tracking-[0.14em] text-[#e0a33b] uppercase'

  let { navigate }: ExperimentProps = $props()
  let graphId = $state(GraphId.Tangle)
  let vaultId = $state(firstVaultId(graphById(GraphId.Tangle)))

  const graph = $derived(graphById(graphId))
  /** Exactly the chosen vault, so the diagram renders from one list. */
  const chosen = $derived(graph.vaults.filter((vault) => vault.id === vaultId))

  function firstVaultId(source: KeyGraph): string {
    const [first] = source.vaults
    return first ? first.id : ''
  }

  function localFor(vault: Vault): Device[] {
    return devicesForVault(graph, vault).filter((device) =>
      isHere(graph, device),
    )
  }

  function outsiders(vault: Vault): Device[] {
    return devicesForVault(graph, vault).filter(
      (device) => !isHere(graph, device),
    )
  }

  function cardTone(vault: Vault): string {
    const base =
      'w-[10.5rem] shrink-0 rounded-xl border p-3 text-left transition duration-200 motion-reduce:transition-none'
    if (vault.id === vaultId) return `${base} border-[#7ce0c0] bg-[#0f1f1b]`
    return `${base} border-[#232a33] bg-[#0a0d11] opacity-60 hover:opacity-100`
  }
</script>

<main class="min-h-[100svh] bg-[#07080b] text-[#e2e7ec]">
  <ExperimentBack {navigate} />
  <GraphSwitch
    {graph}
    onGraph={(next) => {
      graphId = next
      vaultId = firstVaultId(graphById(next))
    }}
  />

  <section class="mx-auto max-w-3xl px-4 pt-28 pb-20 sm:px-8 sm:pt-24">
    <p class={CAPTION}>My device</p>

    {#each hereDevices(graph) as device (device.id)}
      <div
        class="mt-2 rounded-2xl border-2 border-[#4ad6a8] bg-[#0a1714] px-4 py-4 sm:px-5"
      >
        <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <Laptop
            class="size-5 shrink-0 self-center text-[#4ad6a8]"
            aria-hidden="true"
          />
          <span
            class="font-mono text-[26px] leading-none tracking-[0.12em] text-[#7ce0c0]"
          >
            {device.shortId}
          </span>
          <span class="{STATE} text-[#6f8d84]">{device.platform}</span>
        </div>

        <div class="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <p class="flex items-center gap-1.5 {CAPTION}">
              <Fingerprint class="size-3 shrink-0" aria-hidden="true" />
              Unlocked by
            </p>
            <ul class="mt-1.5 flex flex-wrap gap-1.5">
              {#each passkeysForDevice(graph, device) as passkey (passkey.id)}
                <li
                  class={passkey.reach === Reach.Here ? CHIP_QUIET : CHIP_GONE}
                >
                  <span
                    class="size-2 shrink-0 rounded-full"
                    style={`background:${STORE_INK[passkey.store]}`}
                    aria-hidden="true"
                  ></span>
                  <span
                    class={passkey.reach === Reach.Here ? MONO_ID : MONO_STRUCK}
                  >
                    {passkey.shortId}
                  </span>
                  <span class="truncate text-[10px] text-[#8b96a1]">
                    {storeLabel(passkey.store)}
                  </span>
                  {#if passkey.reach === Reach.Elsewhere}
                    <span class="shrink-0 {STATE} text-[#6d7782]">
                      Elsewhere
                    </span>
                  {/if}
                </li>
              {:else}
                <li class={DASHED}>No passkey</li>
              {/each}
            </ul>
          </div>

          <div>
            <p class="flex items-center gap-1.5 {CAPTION}">
              <VaultIcon class="size-3 shrink-0" aria-hidden="true" />
              Opens
            </p>
            <ul class="mt-1.5 flex flex-wrap gap-1.5">
              {#each vaultsForDevice(graph, device.id) as vault (vault.id)}
                <li class={CHIP_QUIET}>
                  <span class="font-mono text-[12px] text-[#7ce0c0]">
                    {vault.shortId}
                  </span>
                  <span class="truncate text-[10px] text-[#8b96a1]">
                    {vault.label}
                  </span>
                </li>
              {:else}
                <li class={DASHED}>No vault</li>
              {/each}
            </ul>
          </div>
        </div>
      </div>
    {:else}
      <div
        class="mt-2 rounded-2xl border-2 border-dashed border-[#e0a33b] bg-[#140f08] px-4 py-5 sm:px-5"
      >
        <p
          class="font-mono text-[18px] tracking-[0.16em] text-[#e0a33b] uppercase"
        >
          No device key
        </p>
      </div>
    {/each}

    <p class="mt-8 {CAPTION}">Vaults</p>
    <div class="mt-2 flex flex-wrap gap-2">
      {#each graph.vaults as vault (vault.id)}
        {@const openable = openableHere(graph, vault)}
        <button
          type="button"
          aria-pressed={vault.id === vaultId}
          class={cardTone(vault)}
          onclick={() => (vaultId = vault.id)}
        >
          <span class="flex items-center gap-2">
            <span
              class="size-2.5 shrink-0 rounded-full"
              style={`background:${openable ? '#4ad6a8' : '#3a434d'}`}
              aria-hidden="true"
            ></span>
            <span class="font-mono text-[13px] tracking-wide text-[#7ce0c0]">
              {vault.shortId}
            </span>
          </span>
          <span class="mt-1.5 block truncate text-[11px] text-[#98a2ac]">
            {vault.label}
          </span>
          <span class="mt-2 flex flex-wrap items-center gap-1">
            {#if openable}
              <span class="{STATE} bg-[#12261f] text-[#4ad6a8]">Opens here</span
              >
            {:else}
              <span class="{STATE} bg-[#1b1f25] text-[#8b96a1]">
                Not from here
              </span>
            {/if}
            <span class="{STATE} text-[#5a636d]">
              ×{passkeysForVault(graph, vault).length}
            </span>
          </span>
        </button>
      {/each}
    </div>

    {#each chosen as vault (vault.id)}
      <div
        class="mt-6 rounded-3xl border border-[#2a333d] bg-[#0b0e13] p-4 sm:p-5"
      >
        <p class="flex items-center gap-1.5 {CAPTION}">
          <Fingerprint class="size-3 shrink-0" aria-hidden="true" />
          Passkeys ×{passkeysForVault(graph, vault).length}
        </p>
        <ul class="mt-2 flex flex-wrap gap-1.5">
          {#each passkeysForVault(graph, vault) as passkey (passkey.id)}
            <li class={passkey.reach === Reach.Here ? CHIP_QUIET : CHIP_GONE}>
              <span
                class="size-2 shrink-0 rounded-full"
                style={`background:${STORE_INK[passkey.store]}`}
                aria-hidden="true"
              ></span>
              <span
                class={passkey.reach === Reach.Here ? MONO_ID : MONO_STRUCK}
              >
                {passkey.shortId}
              </span>
              <span class="truncate text-[10px] text-[#8b96a1]">
                {storeLabel(passkey.store)}
              </span>
              {#if passkey.reach === Reach.Elsewhere}
                <span class="shrink-0 {STATE} text-[#6d7782]">Elsewhere</span>
              {/if}
            </li>
          {:else}
            <li class={DASHED}>No passkey</li>
          {/each}
        </ul>

        <div
          class="mt-4 rounded-2xl border border-[#1e252d] bg-[#080a0e] p-3 sm:p-4"
        >
          <p class="flex items-center gap-1.5 {CAPTION}">
            <Laptop class="size-3 shrink-0" aria-hidden="true" />
            Device keys ×{devicesForVault(graph, vault).length}
          </p>

          {#each localFor(vault) as device (device.id)}
            <div
              class="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-lg border-2 border-[#4ad6a8] bg-[#0a1714] px-3 py-2"
            >
              <Laptop
                class="size-3.5 shrink-0 text-[#4ad6a8]"
                aria-hidden="true"
              />
              <span
                class="font-mono text-[15px] tracking-[0.1em] text-[#7ce0c0]"
              >
                {device.shortId}
              </span>
              <span class="{STATE} bg-[#12261f] text-[#4ad6a8]">My device</span>
            </div>
          {:else}
            <div
              class="mt-2 rounded-lg border border-dashed border-[#3a2c18] px-3 py-2"
            >
              <span
                class="font-mono text-[11px] tracking-[0.16em] text-[#e0a33b] uppercase"
              >
                My device · not enrolled
              </span>
            </div>
          {/each}

          <div
            class="mt-2 rounded-lg border border-dashed border-[#242a32] px-3 py-2"
          >
            <p class={CAPTION}>Other</p>
            <ul class="mt-1.5 flex flex-wrap gap-x-3 gap-y-1.5">
              {#each outsiders(vault) as device (device.id)}
                <li class="flex items-baseline gap-1.5">
                  <span class="font-mono text-[12px] text-[#78838e]">
                    {device.shortId}
                  </span>
                  <span class="truncate text-[10px] text-[#5c6772]">
                    {device.label}
                  </span>
                </li>
              {:else}
                <li class="{STATE} text-[#5a636d]">none</li>
              {/each}
            </ul>
          </div>

          <div
            class="mt-4 rounded-xl border-2 border-[#2c3a44] bg-[#11161c] px-4 py-4"
          >
            <p class="flex items-center gap-1.5 {CAPTION}">
              <VaultIcon class="size-3 shrink-0" aria-hidden="true" />
              Vault
            </p>
            <p class="mt-1.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
              <span
                class="font-mono text-[24px] leading-none tracking-[0.1em] text-[#7ce0c0]"
              >
                {vault.shortId}
              </span>
              <span class="truncate text-[13px] text-[#c6cdd4]">
                {vault.label}
              </span>
            </p>
            <p class="mt-2.5 flex flex-wrap items-center gap-1.5">
              <span class="{STATE} bg-[#151a20] text-[#8b96a1]">
                {vault.secrets} secrets
              </span>
              {#if openableHere(graph, vault)}
                <span class="{STATE} bg-[#12261f] text-[#4ad6a8]">
                  Opens here
                </span>
              {:else}
                <span class="{STATE} bg-[#261c12] text-[#e0a33b]">
                  Not from here
                </span>
              {/if}
            </p>
          </div>
        </div>
      </div>
    {/each}
  </section>
</main>
