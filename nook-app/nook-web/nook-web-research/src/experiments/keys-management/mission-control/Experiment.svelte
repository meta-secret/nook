<!--
DIRECTION: Three regions, never mixed. My device key is its own object at the
top — identifier, what unlocks it, what it opens, and the two things a person
can actually do from here. Beneath it a scannable status line per vault: how
many passkeys open it, how many work from this browser, one severity colour.
Other device keys get a flat strip at the bottom that only reports existence.
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
    type Passkey,
    passkeysForDevice,
    passkeysForVault,
    Reach,
    storeLabel,
    type Vault,
    vaultsForDevice,
  } from '../_shared/key-graph'
  import type { ExperimentProps } from '../../index'
  import { BoardStatus, type Row, RowKind } from './board-status'
  import { DeviceAction } from './device-action'

  interface Line {
    vault: Vault
    passkeys: Passkey[]
    usableIds: string[]
    devices: Device[]
    status: BoardStatus
  }

  const CAPTION =
    'font-mono text-[9px] tracking-[0.2em] text-[#6f7a6a] uppercase'
  const UNIT = 'font-mono text-[9px] tracking-[0.14em] text-[#6f7a6a] uppercase'
  const CHIP = 'rounded-sm border px-1.5 py-0.5 font-mono text-[11px]'
  const CHIP_LIVE = `${CHIP} border-[#a6e22e] bg-[#1c2a10] text-[#d7f59a]`
  const CHIP_PLAIN = `${CHIP} border-[#2a3038] text-[#9aa694]`
  const CHIP_GONE = `${CHIP} border-dashed border-[#4a525c] text-[#94a08c]`

  let { navigate }: ExperimentProps = $props()
  let graphId = $state(GraphId.Tangle)
  let row = $state<Row>({ kind: RowKind.Closed })
  let action = $state(DeviceAction.None)

  const graph = $derived(graphById(graphId))
  const others = $derived(
    graph.devices.filter((device) => !isHere(graph, device)),
  )
  const lines = $derived(graph.vaults.map((vault) => lineFor(graph, vault)))
  /** Passkeys this browser's key does not carry yet. */
  const unenrolled = $derived(
    graph.passkeys.filter(
      (passkey) =>
        !hereDevices(graph).some((device) =>
          device.passkeyIds.includes(passkey.id),
        ),
    ),
  )
  /** Vaults whose only enrolled device key is the one in this browser. */
  const orphaned = $derived(
    graph.vaults.filter(
      (vault) =>
        vault.deviceIds.length === 1 &&
        hereDevices(graph).some((device) =>
          vault.deviceIds.includes(device.id),
        ),
    ),
  )

  /** Usable now means: presentable here, and carried by this browser's key. */
  function lineFor(source: KeyGraph, vault: Vault): Line {
    const passkeys = passkeysForVault(source, vault)
    const local = hereDevices(source).filter((device) =>
      vault.deviceIds.includes(device.id),
    )
    const usableIds = passkeys
      .filter(
        (passkey) =>
          passkey.reach === Reach.Here &&
          local.some((device) => device.passkeyIds.includes(passkey.id)),
      )
      .map((passkey) => passkey.id)
    return {
      vault,
      passkeys,
      usableIds,
      devices: devicesForVault(source, vault),
      status: statusOf(passkeys.length, usableIds.length),
    }
  }

  function statusOf(total: number, usable: number): BoardStatus {
    if (total === 0) return BoardStatus.Severed
    if (usable === 0) return BoardStatus.Locked
    return usable === 1 ? BoardStatus.Single : BoardStatus.Ready
  }

  function statusLabel(status: BoardStatus): string {
    if (status === BoardStatus.Ready) return 'Ready'
    if (status === BoardStatus.Single) return 'One key here'
    return status === BoardStatus.Locked ? 'Not from here' : 'No passkey'
  }

  function statusInk(status: BoardStatus): string {
    if (status === BoardStatus.Ready) return 'text-[#a6e22e]'
    if (status === BoardStatus.Single) return 'text-[#e0a33b]'
    return 'text-[#e2603f]'
  }

  function statusEdge(status: BoardStatus): string {
    if (status === BoardStatus.Ready) return 'border-l-[#a6e22e]'
    if (status === BoardStatus.Single) return 'border-l-[#e0a33b]'
    return 'border-l-[#e2603f]'
  }

  function passkeyChip(usableIds: string[], passkey: Passkey): string {
    if (passkey.reach === Reach.Elsewhere) return CHIP_GONE
    return usableIds.includes(passkey.id) ? CHIP_LIVE : CHIP_PLAIN
  }

  function actionTone(target: DeviceAction): string {
    const base =
      'rounded-sm border px-2.5 py-1 font-mono text-[10px] tracking-[0.14em] uppercase transition motion-reduce:transition-none'
    return action === target
      ? `${base} border-[#a6e22e] bg-[#1c2a10] text-[#d7f59a]`
      : `${base} border-[#2a3038] text-[#9aa694] hover:border-[#57634f]`
  }

  function lineLabel(line: Line): string {
    return `Vault ${line.vault.shortId} ${line.vault.label}. ${line.passkeys.length} passkeys, ${line.usableIds.length} usable from this browser, ${line.devices.length} device keys. ${statusLabel(line.status)}.`
  }

  function arm(target: DeviceAction) {
    action = action === target ? DeviceAction.None : target
  }

  function toggle(id: string) {
    const same = row.kind === RowKind.Open && row.vaultId === id
    row = same ? { kind: RowKind.Closed } : { kind: RowKind.Open, vaultId: id }
  }
</script>

<main class="min-h-[100svh] bg-[#08090b] text-[#dfe4dc]">
  <ExperimentBack {navigate} />
  <GraphSwitch
    {graph}
    onGraph={(next) => {
      graphId = next
      row = { kind: RowKind.Closed }
      action = DeviceAction.None
    }}
  />

  <section class="mx-auto max-w-3xl px-4 pt-28 pb-20 sm:px-6 sm:pt-24">
    <p class={CAPTION}>My device</p>

    {#each hereDevices(graph) as device (device.id)}
      <div
        class="mt-2 rounded-md border-2 border-[#a6e22e] bg-[#0e1409] px-3 py-4 sm:px-5"
      >
        <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <Laptop
            class="size-5 shrink-0 self-center text-[#a6e22e]"
            aria-hidden="true"
          />
          <span
            class="font-mono text-[26px] leading-none tracking-[0.14em] text-[#d7f59a]"
          >
            {device.shortId}
          </span>
          <span
            class="font-mono text-[10px] tracking-[0.16em] text-[#8fae5e] uppercase"
          >
            {device.platform}
          </span>
        </div>

        <div class="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <p class="flex items-center gap-1.5 {CAPTION}">
              <Fingerprint class="size-3 shrink-0" aria-hidden="true" />
              Unlocked by
            </p>
            <ul class="mt-1.5 flex flex-wrap gap-x-3 gap-y-1.5">
              {#each passkeysForDevice(graph, device) as passkey (passkey.id)}
                <li class="flex items-center gap-1.5">
                  <span
                    class={passkey.reach === Reach.Here ? CHIP_LIVE : CHIP_GONE}
                  >
                    {passkey.shortId}
                  </span>
                  <span class="text-[11px] text-[#8b968a]">
                    {storeLabel(passkey.store)}
                  </span>
                </li>
              {:else}
                <li class={UNIT}>none</li>
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
                <li class={CHIP_LIVE}>{vault.shortId}</li>
              {:else}
                <li class={UNIT}>none</li>
              {/each}
            </ul>
          </div>
        </div>

        <div class="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-pressed={action === DeviceAction.Enrol}
            class={actionTone(DeviceAction.Enrol)}
            onclick={() => arm(DeviceAction.Enrol)}
          >
            Add passkey
          </button>
          <button
            type="button"
            aria-pressed={action === DeviceAction.Revoke}
            class={actionTone(DeviceAction.Revoke)}
            onclick={() => arm(DeviceAction.Revoke)}
          >
            Revoke key
          </button>
        </div>

        {#if action === DeviceAction.Enrol}
          <div class="mt-3 rounded-sm border border-[#2a3038] px-3 py-2.5">
            <p class={CAPTION}>Not enrolled</p>
            <ul class="mt-1.5 flex flex-wrap gap-x-3 gap-y-1.5">
              {#each unenrolled as passkey (passkey.id)}
                <li class="flex items-center gap-1.5">
                  <span
                    class={passkey.reach === Reach.Here
                      ? CHIP_PLAIN
                      : CHIP_GONE}
                  >
                    {passkey.shortId}
                  </span>
                  <span class="text-[11px] text-[#8b968a]">
                    {storeLabel(passkey.store)}
                  </span>
                </li>
              {:else}
                <li class={UNIT}>none</li>
              {/each}
            </ul>
          </div>
        {/if}

        {#if action === DeviceAction.Revoke}
          <div class="mt-3 rounded-sm border border-[#4a2a1f] px-3 py-2.5">
            <p
              class="font-mono text-[9px] tracking-[0.2em] text-[#e2603f] uppercase"
            >
              Would lose their last key
            </p>
            <ul class="mt-1.5 flex flex-wrap gap-1.5">
              {#each orphaned as vault (vault.id)}
                <li class="{CHIP} border-[#e2603f] text-[#e2603f]">
                  {vault.shortId}
                </li>
              {:else}
                <li class={UNIT}>none</li>
              {/each}
            </ul>
          </div>
        {/if}
      </div>
    {:else}
      <div
        class="mt-2 rounded-md border-2 border-dashed border-[#e2603f] bg-[#120b09] px-3 py-5 sm:px-5"
      >
        <p
          class="font-mono text-[18px] tracking-[0.16em] text-[#e2603f] uppercase"
        >
          No device key
        </p>
        <p class="mt-1.5 {UNIT}">nothing opens from this browser</p>
      </div>
    {/each}

    <p class="mt-8 {CAPTION}">Vaults</p>

    <ul class="mt-2 space-y-2">
      {#each lines as line (line.vault.id)}
        {@const open =
          row.kind === RowKind.Open && row.vaultId === line.vault.id}
        <li
          class={`overflow-hidden rounded-sm border border-y-[#1b1f24] border-r-[#1b1f24] border-l-2 bg-[#0d1013] ${statusEdge(line.status)}`}
        >
          <button
            type="button"
            aria-expanded={open}
            aria-controls={`detail-${line.vault.id}`}
            aria-label={lineLabel(line)}
            class="block w-full px-3 py-3 text-left transition hover:bg-[#11151a] motion-reduce:transition-none sm:px-4"
            onclick={() => toggle(line.vault.id)}
          >
            <span class="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span
                class="flex min-w-0 flex-1 basis-full items-baseline gap-2.5 sm:basis-auto"
              >
                <span
                  class="font-mono text-[16px] tracking-[0.12em] text-[#eef2ec]"
                >
                  {line.vault.shortId}
                </span>
                <span class="truncate text-[12px] text-[#8b968a]">
                  {line.vault.label}
                </span>
              </span>

              <span class="flex items-baseline gap-1">
                <span class="font-mono text-[14px] leading-none text-[#eef2ec]">
                  {line.passkeys.length}
                </span>
                <span class={UNIT}>pk</span>
              </span>
              <span class="flex items-baseline gap-1">
                <span
                  class={`font-mono text-[14px] leading-none ${statusInk(line.status)}`}
                >
                  {line.usableIds.length}
                </span>
                <span class={UNIT}>here</span>
              </span>
              <span class="flex items-baseline gap-1">
                <span class="font-mono text-[14px] leading-none text-[#eef2ec]">
                  {line.devices.length}
                </span>
                <span class={UNIT}>dev</span>
              </span>

              <span
                class={`ml-auto shrink-0 font-mono text-[9px] tracking-[0.16em] uppercase ${statusInk(line.status)}`}
              >
                {statusLabel(line.status)}
              </span>
            </span>

            <span class="mt-2.5 flex flex-wrap items-center gap-1.5">
              {#each line.passkeys as passkey (passkey.id)}
                <span class={passkeyChip(line.usableIds, passkey)}>
                  {passkey.shortId}
                </span>
              {:else}
                <span
                  class="{CHIP} border-dashed border-[#e2603f] text-[#e2603f]"
                >
                  ······
                </span>
              {/each}
            </span>
          </button>

          {#if open}
            <div
              id={`detail-${line.vault.id}`}
              class="border-t border-[#1b1f24] bg-[#0b0e11] px-3 py-3 sm:px-4"
            >
              <p class="flex items-center gap-1.5 {CAPTION}">
                <Fingerprint class="size-3 shrink-0" aria-hidden="true" />
                Passkeys
              </p>
              <ul class="mt-2 flex flex-wrap gap-x-4 gap-y-2">
                {#each line.passkeys as passkey (passkey.id)}
                  <li class="flex items-center gap-1.5">
                    <span class={passkeyChip(line.usableIds, passkey)}>
                      {passkey.shortId}
                    </span>
                    <span class="text-[11px] text-[#8b968a]">
                      {storeLabel(passkey.store)}
                    </span>
                    {#if passkey.reach === Reach.Elsewhere}
                      <span
                        class="font-mono text-[9px] tracking-[0.14em] text-[#e2603f] uppercase"
                      >
                        elsewhere
                      </span>
                    {/if}
                  </li>
                {:else}
                  <li class={UNIT}>none</li>
                {/each}
              </ul>
            </div>
          {/if}
        </li>
      {/each}
    </ul>

    <p class="mt-8 {CAPTION}">Other devices</p>
    <ul class="mt-2 space-y-1.5">
      {#each others as device (device.id)}
        <li class="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-0.5">
          <span class="font-mono text-[12px] text-[#7f8a7b]">
            {device.shortId}
          </span>
          <span class="truncate text-[11px] text-[#6f7a6a]">
            {device.label}
          </span>
          <span class="flex flex-wrap items-baseline gap-1.5">
            {#each vaultsForDevice(graph, device.id) as vault (vault.id)}
              <span class="font-mono text-[11px] text-[#4f5a4c]">
                {vault.shortId}
              </span>
            {/each}
          </span>
        </li>
      {:else}
        <li class={UNIT}>none</li>
      {/each}
    </ul>
  </section>
</main>
