<!--
DIRECTION: The chain as a travel document. A data page for this browser with a
device sigil where the photo would be, a stamps page carrying one ink stamp per
vault this key has actually opened, and a machine-readable zone that spells out
the two identifiers Nook really holds.
-->
<script lang="ts">
  import { Stamp, IdCard } from '@lucide/svelte'
  import ExperimentBack from '$lib/components/ExperimentBack.svelte'
  import ScenarioSwitch from '../_shared/ScenarioSwitch.svelte'
  import {
    type AccessScenario,
    type Fact,
    FactKind,
    factText,
    isPrepared,
    known,
    ScenarioId,
    scenarioById,
    VaultTrust,
    verifiedVaults,
  } from '../_shared/keys-management-state'
  import type { ExperimentProps } from '../../index'
  import { PassportPage } from './passport-page'

  interface SigilCell {
    id: string
    filled: boolean
  }

  interface DataField {
    label: string
    fact: Fact
    machine: boolean
  }

  interface MrzLine {
    id: string
    text: string
  }

  const SIGIL_SIDE = 6

  const PAGE_TABS = [
    { id: PassportPage.Data, label: 'Data page', icon: IdCard },
    { id: PassportPage.Stamps, label: 'Stamps', icon: Stamp },
  ]

  let { navigate }: ExperimentProps = $props()
  let scenarioId = $state(ScenarioId.Unlocked)
  let page = $state(PassportPage.Data)
  const scenario = $derived(scenarioById(scenarioId))
  const prepared = $derived(isPrepared(scenario))
  const fields = $derived(dataFields(scenario))
  const sigil = $derived(sigilCells(factText(scenario.device.id)))
  const mrz = $derived(mrzLines(scenario))
  const stamped = $derived(verifiedVaults(scenario))
  const unstamped = $derived(
    scenario.vaults.filter((vault) => vault.trust === VaultTrust.Unverified),
  )

  function dataFields(access: AccessScenario): DataField[] {
    return [
      {
        label: 'Document type',
        fact: known('Browser custody record'),
        machine: false,
      },
      {
        label: 'Authority',
        fact: known(access.protectionLabel),
        machine: false,
      },
      { label: 'Held in', fact: access.passkey.savedIn, machine: false },
      { label: 'Bearer', fact: access.passkey.name, machine: false },
      { label: 'Issued', fact: access.device.preparedAt, machine: false },
      {
        label: 'Last presented',
        fact: access.passkey.lastUsedAt,
        machine: false,
      },
      {
        label: 'Attachment',
        fact: known(access.passkey.attachment),
        machine: false,
      },
      {
        label: 'Terminal',
        fact: known(`${access.device.browser} · ${access.device.platform}`),
        machine: false,
      },
      { label: 'Device key', fact: access.device.id, machine: true },
      {
        label: 'Passkey fingerprint',
        fact: access.passkey.fingerprint,
        machine: true,
      },
    ]
  }

  /** A deterministic mark drawn from the device key, so it changes with the key. */
  function sigilCells(seed: string): SigilCell[] {
    const cells: SigilCell[] = []
    for (let index = 0; index < SIGIL_SIDE * SIGIL_SIDE; index += 1) {
      const code = seed.charCodeAt(index % Math.max(seed.length, 1)) + index * 7
      cells.push({ id: `cell-${index}`, filled: code % 3 !== 0 })
    }
    return cells
  }

  function mrzField(value: string, width: number): string {
    const clean = value.toUpperCase().replace(/[^A-Z0-9]/g, '<')
    return clean.slice(0, width).padEnd(width, '<')
  }

  function mrzLines(access: AccessScenario): MrzLine[] {
    if (!isPrepared(access)) {
      return [
        { id: 'passkey', text: `NOOKP<${mrzField('NO PASSKEY', 26)}` },
        { id: 'device', text: `NOOKD<${mrzField('NO KEY', 18)}<V00<<<<<<` },
      ]
    }
    const vaults = verifiedVaults(access).length
    return [
      {
        id: 'passkey',
        text: `NOOKP<${mrzField(factText(access.passkey.fingerprint), 26)}`,
      },
      {
        id: 'device',
        text: `NOOKD<${mrzField(factText(access.device.id), 18)}<V${String(vaults).padStart(2, '0')}<${mrzField(factText(access.passkey.savedIn), 6)}`,
      },
    ]
  }

  function fieldInk(field: DataField): string {
    if (field.fact.kind === FactKind.NotObserved)
      return 'text-[#5c4a34]/70 italic'
    return field.machine ? 'font-mono break-all' : ''
  }

  function tilt(index: number): string {
    const angles = ['-rotate-3', 'rotate-2', '-rotate-1', 'rotate-3']
    return angles[index % angles.length]
  }

  function tabClass(target: PassportPage): string {
    return page === target
      ? 'border-[#6b4a2b] bg-[#6b4a2b] text-[#efe6d2]'
      : 'border-[#6b4a2b]/35 text-[#6b4a2b] hover:border-[#6b4a2b]/70'
  }
</script>

<main class="min-h-[100svh] bg-[#cdc1a8] py-20 text-[#2c231a]">
  <ExperimentBack {navigate} light />
  <ScenarioSwitch
    {scenario}
    light
    onScenario={(next) => {
      scenarioId = next
      page = PassportPage.Data
    }}
  />

  <section class="mx-auto max-w-3xl px-4 sm:px-8">
    <p
      class="text-center font-mono text-[10px] tracking-[0.32em] text-[#5c4a34] uppercase"
    >
      Devices &amp; access
    </p>

    <div
      class="mt-6 rounded-sm border border-[#2c231a]/20 bg-[#efe6d2] shadow-[0_24px_60px_rgb(44_35_26/0.35)]"
    >
      <header
        class="flex flex-wrap items-center justify-between gap-3 border-b border-[#2c231a]/15 px-5 py-4 sm:px-8"
      >
        <p class="font-mono text-[10px] tracking-[0.26em] uppercase">
          Nook · custody passport
        </p>
        <div role="tablist" aria-label="Passport page" class="flex gap-2">
          {#each PAGE_TABS as tab (tab.id)}
            {@const TabIcon = tab.icon}
            <button
              type="button"
              role="tab"
              id={`tab-${tab.id}`}
              aria-selected={page === tab.id}
              class={`flex items-center gap-1.5 rounded-sm border px-3 py-1.5 font-mono text-[10px] tracking-[0.16em] uppercase transition motion-reduce:transition-none ${tabClass(tab.id)}`}
              onclick={() => (page = tab.id)}
            >
              <TabIcon class="size-3" aria-hidden="true" />
              {tab.label}
            </button>
          {/each}
        </div>
      </header>

      <div role="tabpanel" aria-labelledby={`tab-${page}`}>
        {#if page === PassportPage.Data}
          <div class="grid gap-6 px-5 py-7 sm:grid-cols-[9rem_1fr] sm:px-8">
            <div>
              <div
                class={`grid aspect-[3/4] w-full grid-cols-6 grid-rows-6 gap-[2px] border p-2 ${prepared ? 'border-[#2c231a]/30 bg-[#e3d7bd]' : 'border-dashed border-[#2c231a]/30'}`}
                aria-hidden="true"
              >
                {#if prepared}
                  {#each sigil as cell (cell.id)}
                    <span
                      class={cell.filled ? 'bg-[#3d3122]' : 'bg-[#2c231a]/10'}
                    ></span>
                  {/each}
                {/if}
              </div>
              <p class="mt-2 font-mono text-[9px] tracking-[0.14em] uppercase">
                {prepared ? 'Device sigil' : 'No sigil yet'}
              </p>
            </div>

            <dl class="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
              {#each fields as field (field.label)}
                <div class="min-w-0">
                  <dt
                    class="font-mono text-[9px] tracking-[0.18em] text-[#5c4a34] uppercase"
                  >
                    {field.label}
                  </dt>
                  <dd class={`mt-1 text-sm leading-5 ${fieldInk(field)}`}>
                    {factText(field.fact)}
                  </dd>
                </div>
              {/each}
            </dl>
          </div>

          <p
            class="border-t border-[#2c231a]/10 px-5 py-4 text-[13px] leading-6 text-[#5c4a34] sm:px-8"
          >
            The passkey itself never leaves {factText(
              scenario.passkey.savedIn,
            )}. This page copies only the fingerprint Nook keeps to recognise
            it, and the device key that exists nowhere but this browser.
          </p>
        {:else}
          <div class="px-5 py-7 sm:px-8">
            <p
              class="font-mono text-[10px] tracking-[0.2em] text-[#5c4a34] uppercase"
            >
              Vaults this device key has opened
            </p>

            {#if stamped.length === 0}
              <div
                class="mt-5 border border-dashed border-[#2c231a]/30 px-5 py-10 text-center"
              >
                <p class="text-sm text-[#5c4a34]">
                  No stamps. A vault is only stamped once this device key has
                  actually opened it.
                </p>
              </div>
            {:else}
              <div class="mt-6 grid gap-5 sm:grid-cols-2">
                {#each stamped as vault, index (vault.id)}
                  <div
                    class={`border-2 border-[#8c3b2e]/70 px-4 py-4 text-[#8c3b2e] ${tilt(index)}`}
                  >
                    <p class="font-mono text-[9px] tracking-[0.2em] uppercase">
                      Opened here
                    </p>
                    <p class="mt-1.5 text-lg leading-6 break-words">
                      {vault.label}
                    </p>
                    <p class="mt-1 font-mono text-[11px]">
                      {factText(vault.verifiedAt)}
                    </p>
                    <p
                      class="mt-3 font-mono text-[9px] tracking-[0.14em] uppercase"
                    >
                      Devices {vault.enrolledDevices} · Backups {vault.backupPasswords}
                    </p>
                  </div>
                {/each}
              </div>
            {/if}

            {#if unstamped.length > 0}
              <ul class="mt-8 border-t border-[#2c231a]/15 pt-5">
                {#each unstamped as vault (vault.id)}
                  <li
                    class="flex flex-wrap items-baseline justify-between gap-3 py-2 text-sm"
                  >
                    <span class="text-[#5c4a34]">{vault.label}</span>
                    <span class="text-[13px] text-[#5c4a34]/70 italic">
                      {factText(vault.verifiedAt)}
                    </span>
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
        {/if}
      </div>

      <div
        class="border-t-2 border-[#2c231a]/25 bg-[#e6dcc2] px-5 py-4 sm:px-8"
      >
        <p
          class="font-mono text-[9px] tracking-[0.2em] text-[#5c4a34] uppercase"
        >
          Machine-readable zone
        </p>
        <div class="mt-2 space-y-1 font-mono text-[11px] break-all sm:text-xs">
          {#each mrz as line (line.id)}
            <p>{line.text}</p>
          {/each}
        </div>
      </div>
    </div>

    {#if !prepared}
      <div class="mx-auto mt-8 max-w-md text-center">
        <p class="text-sm leading-6 text-[#3d3122]">
          This document is blank. Preparing the browser issues it: a passkey you
          choose, a device key derived here, and stamps as vaults open.
        </p>
        <button
          class="mt-5 rounded-sm bg-[#3d3122] px-6 py-3 text-sm font-medium text-[#efe6d2] transition hover:bg-[#2c231a] motion-reduce:transition-none"
        >
          Prepare this browser
        </button>
      </div>
    {/if}
  </section>
</main>
