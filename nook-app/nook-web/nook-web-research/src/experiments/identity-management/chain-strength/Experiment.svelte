<!--
THESIS: Use the actual chain-strength page: one physical-device anchor, one
rounded identity band, then one rope row per independent vault. Every strand
reads identity → device key → passkey. The palette changes to dark; the
template, density, braces, identifiers, and selection grammar stay intact.
-->
<script lang="ts">
  import {
    Cloud,
    Fingerprint,
    KeyRound,
    Laptop,
    UserRound,
    Users,
    Vault as VaultIcon,
  } from '@lucide/svelte'
  import ExperimentBack from '$lib/components/ExperimentBack.svelte'
  import type { ExperimentProps } from '../../index'
  import {
    AccessAvailability,
    deviceById,
    deviceKeys,
    deviceKeysForIdentity,
    DevicePresence,
    identities,
    identityById,
    IdentityKind,
    IdentityReplicationKind,
    passkeysForDeviceKey,
    PasskeyMobility,
    physicalDevices,
    providerMountById,
    SelectionKind,
    vaultGrants,
    type DeviceKey,
    type IdentityAccount,
    type PasskeyAccessMethod,
    type Selection,
    type VaultGrant,
  } from '../_shared/identity-model'

  interface Strand {
    key: string
    grant: VaultGrant
    identity: IdentityAccount
    deviceKey: DeviceKey
    deviceLabel: string
    mine: boolean
    usableNow: boolean
    passkey: PasskeyAccessMethod | undefined
  }

  interface VaultRead {
    vaultId: string
    vaultLabel: string
    strands: readonly Strand[]
    identityIds: ReadonlySet<string>
    localWays: number
    pips: readonly boolean[]
  }

  const CAPS = 'font-mono text-[10px] tracking-[0.22em] uppercase'
  const IDENTITY_INK: Record<IdentityKind, string> = {
    [IdentityKind.Personal]: '#ff7651',
    [IdentityKind.Collective]: '#9aa6ff',
  }

  let { navigate }: ExperimentProps = $props()
  let activeIdentityId = $state('identity-nora')
  let selected = $state<Selection>({
    kind: SelectionKind.Identity,
    id: activeIdentityId,
  })

  const currentDevice = $derived(
    physicalDevices.find((device) => device.presence === DevicePresence.Here),
  )
  const currentDeviceKeys = $derived(
    currentDevice === undefined
      ? []
      : deviceKeys.filter((deviceKey) => deviceKey.deviceId === currentDevice.id),
  )
  const otherDevices = $derived(
    physicalDevices.filter((device) => device.presence !== DevicePresence.Here),
  )
  const vaultIds = $derived([
    ...new Set(vaultGrants.map((grant) => grant.vaultId)),
  ])
  const reads = $derived(vaultIds.map(readForVault))

  function selectIdentity(id: string): void {
    activeIdentityId = id
    selected = { kind: SelectionKind.Identity, id }
  }

  function pick(
    kind:
      | SelectionKind.DeviceKey
      | SelectionKind.Passkey
      | SelectionKind.Vault,
    id: string,
  ): void {
    if (kind === SelectionKind.DeviceKey) {
      selected = { kind: SelectionKind.DeviceKey, id }
    } else if (kind === SelectionKind.Passkey) {
      selected = { kind: SelectionKind.Passkey, id }
    } else {
      selected = { kind: SelectionKind.Vault, id }
    }
  }

  function isSelected(kind: SelectionKind, id: string): boolean {
    return selected.kind === kind && selected.id === id
  }

  function providerLabel(identity: IdentityAccount): string {
    if (identity.replication.kind === IdentityReplicationKind.LocalOnly) {
      return 'local-only record'
    }
    return identity.replication.providerMountIds
      .map((mountId) => providerMountById(mountId).provider)
      .join(' + ')
  }

  function providerCompactLabel(identity: IdentityAccount): string {
    if (identity.replication.kind === IdentityReplicationKind.LocalOnly) {
      return 'record · local only'
    }
    const mounts = identity.replication.providerMountIds.map(providerMountById)
    if (mounts.length !== 1) return `record · ${mounts.length} mounts`
    const provider = mounts[0]?.provider.replace('Google ', '') ?? 'mounted'
    return `record · ${provider}`
  }

  function grantCount(identity: IdentityAccount): string {
    const count = identity.vaultGrantIds.length
    return `${count} vault${count === 1 ? '' : 's'}`
  }

  function keyCount(identity: IdentityAccount): string {
    const count = identity.deviceKeyIds.length
    return `${count} key${count === 1 ? '' : 's'}`
  }

  function identityForDeviceKey(deviceKeyId: string): IdentityAccount {
    const match = identities.find((identity) =>
      identity.deviceKeyIds.includes(deviceKeyId),
    )
    if (match) return match
    throw new Error(`No identity owns fixture device key ${deviceKeyId}`)
  }

  function strandsForGrant(grant: VaultGrant): readonly Strand[] {
    const identity = identityById(grant.identityId)
    return deviceKeysForIdentity(identity).flatMap((deviceKey) => {
      const device = deviceById(deviceKey.deviceId)
      const methods = passkeysForDeviceKey(deviceKey.id)
      const base = {
        grant,
        identity,
        deviceKey,
        deviceLabel: device.label,
        mine: device.presence === DevicePresence.Here,
      }
      if (methods.length === 0) {
        return [{
          ...base,
          key: `${grant.id}-${deviceKey.id}-local`,
          passkey: undefined,
          usableNow: false,
        }]
      }
      return methods.map((passkey) => ({
        ...base,
        key: `${grant.id}-${deviceKey.id}-${passkey.id}`,
        passkey,
        usableNow:
          device.presence === DevicePresence.Here &&
          passkey.availability === AccessAvailability.Here,
      }))
    })
  }

  function readForVault(vaultId: string): VaultRead {
    const grants = vaultGrants.filter((grant) => grant.vaultId === vaultId)
    const first = grants[0]
    if (first === undefined) throw new Error(`Unknown fixture vault ${vaultId}`)
    const strands = grants.flatMap(strandsForGrant).sort((left, right) =>
      Number(right.mine) - Number(left.mine),
    )
    const identityIds = new Set(grants.map((grant) => grant.identityId))
    return {
      vaultId,
      vaultLabel: first.vaultLabel,
      strands,
      identityIds,
      localWays: strands.filter((strand) => strand.usableNow).length,
      pips: identities.map((identity) => identityIds.has(identity.id)),
    }
  }

  function rowLit(read: VaultRead): boolean {
    if (selected.kind === SelectionKind.None) return true
    if (selected.kind === SelectionKind.Vault) return selected.id === read.vaultId
    return read.strands.some(strandLit)
  }

  function identityLit(identity: IdentityAccount): boolean {
    if (selected.kind === SelectionKind.None) return true
    if (selected.kind === SelectionKind.Identity) return selected.id === identity.id
    if (selected.kind === SelectionKind.DeviceKey) {
      return identity.deviceKeyIds.includes(selected.id)
    }
    if (selected.kind === SelectionKind.Passkey) {
      return identity.deviceKeyIds.some((deviceKeyId) =>
        passkeysForDeviceKey(deviceKeyId).some(
          (passkey) => passkey.id === selected.id,
        ),
      )
    }
    return identity.vaultGrantIds
      .map((grantId) => vaultGrants.find((grant) => grant.id === grantId))
      .some((grant) => grant?.vaultId === selected.id)
  }

  function strandLit(strand: Strand): boolean {
    if (selected.kind === SelectionKind.None) return true
    if (selected.kind === SelectionKind.Identity) {
      return strand.identity.id === selected.id
    }
    if (selected.kind === SelectionKind.DeviceKey) {
      return strand.deviceKey.id === selected.id
    }
    if (selected.kind === SelectionKind.Passkey) {
      return strand.passkey?.id === selected.id
    }
    return strand.grant.vaultId === selected.id
  }

  function chosenEdge(chosen: boolean): string {
    return chosen ? 'border-[#f4f4f5]' : 'border-white/20'
  }

  function dim(lit: boolean): string {
    return lit ? 'opacity-100' : 'opacity-35'
  }

  function dimRow(lit: boolean): string {
    return lit ? 'opacity-100' : 'opacity-55'
  }

  function braceY(count: number, index: number): number {
    return ((index + 0.5) / count) * 100
  }

  function strandRule(usableNow: boolean): string {
    return usableNow ? 'border-white/45' : 'border-dashed border-white/20'
  }

  function reachWord(strand: Strand): string {
    if (strand.usableNow) return 'Usable from this browser now'
    if (!strand.mine) return `Runs through ${strand.deviceLabel}`
    if (strand.passkey === undefined) return 'Local protector availability unknown'
    if (strand.passkey.availability === AccessAvailability.Elsewhere) {
      return 'Passkey is not available on this browser'
    }
    return 'Passkey availability is unknown on this browser'
  }

  function vaultName(read: VaultRead): string {
    const identityWord = read.identityIds.size === 1 ? 'identity' : 'identities'
    return `Vault ${read.vaultLabel}, ${read.vaultId}, granted to ${read.identityIds.size} ${identityWord} through ${read.strands.length} device-key paths`
  }

  function vaultGradeLabel(read: VaultRead): string {
    const identityWord = read.identityIds.size === 1 ? 'identity' : 'identities'
    return `${read.identityIds.size} ${identityWord} · ${read.strands.length} paths`
  }
</script>

<main class="min-h-[100svh] bg-[#090a0c] text-[#f4f4f5]">
  <ExperimentBack {navigate} />

  <div
    class="fixed top-[4.25rem] right-3 z-50 flex items-center gap-1 rounded-full border border-white/15 bg-black/55 p-1 text-[11px] font-semibold tracking-wide text-white backdrop-blur-md sm:top-5 sm:right-5"
    role="group"
    aria-label="Highlight identity"
  >
    {#each identities as identity (identity.id)}
      <button
        type="button"
        class={`rounded-full px-3 py-1.5 transition motion-reduce:transition-none ${identity.id === activeIdentityId ? 'bg-white text-black' : 'opacity-60 hover:opacity-100'}`}
        aria-pressed={identity.id === activeIdentityId}
        onclick={() => selectIdentity(identity.id)}
      >
        {identity.label}
      </button>
    {/each}
  </div>

  <section class="mx-auto max-w-3xl px-5 pt-28 pb-20 sm:px-8 sm:pt-24">
    {#if currentDevice !== undefined}
      <article class="border-2 border-white/65 bg-[#121316] px-4 py-4 sm:px-5">
        <div class="flex flex-wrap items-start gap-x-4 gap-y-3">
          <div class="min-w-0 flex-1">
            <p class="{CAPS} text-white/50">My physical device</p>
            <p class="mt-1 flex items-center gap-2 text-[22px] leading-none">
              <Laptop class="size-5 shrink-0" aria-hidden="true" />
              {currentDevice.label}
            </p>
            <p class="mt-1.5 text-[12px] text-white/55">
              {currentDevice.platform}
            </p>
          </div>
          <p class="{CAPS} text-white/60">
            {currentDeviceKeys.length} local identity keys
          </p>
        </div>

        <div class="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-2">
          <span class="{CAPS} w-24 shrink-0 text-white/55">Device keys</span>
          {#each currentDeviceKeys as deviceKey (deviceKey.id)}
            {@const identity = identityForDeviceKey(deviceKey.id)}
            <button
              type="button"
              aria-pressed={isSelected(SelectionKind.DeviceKey, deviceKey.id)}
              aria-label={`Local device key ${deviceKey.shortId} for identity ${identity.label}`}
              class={`flex items-center gap-1.5 border px-2 py-1 transition motion-reduce:transition-none ${chosenEdge(isSelected(SelectionKind.DeviceKey, deviceKey.id))}`}
              onclick={() => pick(SelectionKind.DeviceKey, deviceKey.id)}
            >
              <KeyRound class="size-3 shrink-0 text-white/55" aria-hidden="true" />
              <span class="font-mono text-[13px] tracking-[0.06em]">{deviceKey.shortId}</span>
              <span class="text-[11px] text-white/50">{identity.label}</span>
            </button>
          {/each}
        </div>
      </article>
    {/if}

    <p class="{CAPS} mt-10 flex items-center gap-1.5 text-white/45">
      <UserRound class="size-3" aria-hidden="true" />
      My identities
    </p>

    <ul class="mt-3 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
      {#each identities as identity (identity.id)}
        {@const chosen = isSelected(SelectionKind.Identity, identity.id)}
        <li class={dimRow(identityLit(identity))}>
          <button
            type="button"
            aria-pressed={chosen}
            aria-label={`Identity ${identity.label}, ${identity.shortId}, ${keyCount(identity)}, ${providerLabel(identity)}, ${grantCount(identity)}`}
            class={`grid h-full w-full grid-cols-[2rem_minmax(0,1fr)_5rem] items-center gap-2.5 rounded-r-md rounded-l-full border bg-[#121316] py-2 pr-3 pl-2 text-left transition motion-reduce:transition-none ${chosenEdge(chosen)}`}
            onclick={() => selectIdentity(identity.id)}
          >
            <span
              class="grid size-8 shrink-0 place-items-center rounded-full border-2"
              style={`border-color:${IDENTITY_INK[identity.kind]};background:${IDENTITY_INK[identity.kind]}18`}
              aria-hidden="true"
            >
              {#if identity.kind === IdentityKind.Collective}
                <Users class="size-3.5" style={`color:${IDENTITY_INK[identity.kind]}`} />
              {:else}
                <UserRound class="size-3.5" style={`color:${IDENTITY_INK[identity.kind]}`} />
              {/if}
            </span>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-[11px] text-white/55">{identity.label}</span>
              <span class="mt-0.5 block font-mono text-[15px] tracking-[0.08em]">{identity.shortId}</span>
            </span>
            <span class="flex min-w-0 flex-col items-end gap-1 text-right">
              <span class="flex items-center gap-1 text-[9px] tracking-[0.08em] text-white/65 uppercase">
                <Cloud class="size-2.5" aria-hidden="true" />
                {providerCompactLabel(identity)}
              </span>
              <span class="{CAPS} text-[9px] text-white/60">{keyCount(identity)} · {grantCount(identity)}</span>
            </span>
          </button>
        </li>
      {/each}
    </ul>

    <p class="{CAPS} mt-10 flex items-center gap-1.5 text-white/45">
      <VaultIcon class="size-3" aria-hidden="true" />
      Vault grants
    </p>

    <ul class="mt-3 space-y-3">
      {#each reads as read (read.vaultId)}
        {@const lit = rowLit(read)}
        {@const chosen = isSelected(SelectionKind.Vault, read.vaultId)}
        <li class={`border border-l-2 border-l-[#5fd39f] transition motion-reduce:transition-none ${chosen ? 'border-y-white border-r-white' : 'border-y-white/20 border-r-white/20'} ${dimRow(lit)}`}>
          <div class="flex flex-col sm:flex-row sm:items-stretch">
            <button
              type="button"
              aria-pressed={chosen}
              aria-label={vaultName(read)}
              class="flex shrink-0 flex-col justify-center gap-1.5 border-b border-white/15 bg-[#121316] px-4 py-3 text-left sm:w-56 sm:border-r sm:border-b-0"
              onclick={() => pick(SelectionKind.Vault, read.vaultId)}
            >
              <span class="flex items-center gap-2">
                <VaultIcon class="size-3.5 shrink-0 text-white/55" aria-hidden="true" />
                <span class="truncate text-[13px]">{read.vaultLabel}</span>
                <span class={`ml-auto shrink-0 font-mono text-[9px] tracking-[0.14em] uppercase ${read.localWays > 0 ? 'text-[#5fd39f]' : 'text-white/40'}`}>
                  {read.localWays > 0 ? 'opens here' : 'not here'}
                </span>
              </span>
              <span class="font-mono text-xl tracking-[0.08em]">{read.vaultId}</span>
              <span class="flex items-center gap-1.5">
                <span class="flex items-center gap-1" aria-hidden="true">
                  {#each read.pips as filled, index (index)}
                    <span class={`size-2 rounded-full ${filled ? 'bg-[#5fd39f]' : 'border border-white/25'}`}></span>
                  {/each}
                </span>
                <span class="font-mono text-[10px] tracking-[0.1em] text-[#5fd39f] uppercase">
                  {vaultGradeLabel(read)}
                </span>
              </span>
              <span class="font-mono text-[10px] text-white/60">independent encrypted DEK</span>
            </button>

            <div class="relative hidden w-8 shrink-0 sm:block">
              <svg viewBox="0 0 24 100" preserveAspectRatio="none" class="absolute inset-0 h-full w-full" aria-hidden="true" focusable="false">
                {#each read.strands as strand, index (strand.key)}
                  <path
                    d={`M24 ${braceY(read.strands.length, index)} H17 C9 ${braceY(read.strands.length, index)} 9 50 0 50`}
                    fill="none"
                    vector-effect="non-scaling-stroke"
                    stroke-width={strand.usableNow ? 1.5 : 1}
                    class={strand.usableNow ? 'stroke-white/65' : 'stroke-white/20'}
                  />
                {/each}
              </svg>
            </div>

            <div class="grid min-w-0 flex-1" style={`grid-template-rows: repeat(${read.strands.length}, minmax(0, 1fr))`}>
              {#each read.strands as strand (strand.key)}
                <div class={`flex min-w-0 items-center gap-x-2 overflow-x-auto py-2 pr-4 transition [scrollbar-width:none] motion-reduce:transition-none lg:overflow-visible ${lit ? dim(strandLit(strand)) : ''} ${strand.usableNow ? 'bg-[#5fd39f]/8' : ''}`}>
                  <span class="sr-only">{reachWord(strand)}</span>
                  <span class={`w-4 shrink-0 border-t ${strandRule(strand.usableNow)}`} aria-hidden="true"></span>
                  <button
                    type="button"
                    aria-pressed={isSelected(SelectionKind.Identity, strand.identity.id)}
                    aria-label={`Through identity ${strand.identity.label}, ${strand.identity.shortId}`}
                    class={`flex w-[6.5rem] shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[10px] tracking-[0.12em] uppercase transition motion-reduce:transition-none ${strand.usableNow ? 'bg-white text-black' : `border text-white/65 ${chosenEdge(isSelected(SelectionKind.Identity, strand.identity.id))}`}`}
                    onclick={() => selectIdentity(strand.identity.id)}
                  >
                    <UserRound class="size-3 shrink-0" aria-hidden="true" />
                    {strand.identity.shortId}
                  </button>
                  <span class={`w-4 shrink-0 border-t ${strandRule(strand.usableNow)}`} aria-hidden="true"></span>
                  <button
                    type="button"
                    aria-pressed={isSelected(SelectionKind.DeviceKey, strand.deviceKey.id)}
                    aria-label={`Device key ${strand.deviceKey.shortId} on ${strand.deviceLabel}`}
                    class={`shrink-0 border-b font-mono text-[12px] tracking-[0.06em] transition motion-reduce:transition-none ${isSelected(SelectionKind.DeviceKey, strand.deviceKey.id) ? 'border-b-white' : 'border-b-transparent'}`}
                    onclick={() => pick(SelectionKind.DeviceKey, strand.deviceKey.id)}
                  >
                    {strand.deviceKey.shortId}
                  </button>
                  <span class={`w-4 shrink-0 border-t ${strandRule(strand.usableNow)}`} aria-hidden="true"></span>
                  {#if strand.passkey === undefined}
                    <span class="shrink-0 text-[11px] text-white/60">local fallback · unknown</span>
                  {:else}
                    <span class={`size-2 shrink-0 rounded-full ${strand.passkey.mobility === PasskeyMobility.Synced ? 'bg-[#d7a654]' : 'bg-[#5fd39f]'}`} aria-hidden="true"></span>
                    <button
                      type="button"
                      aria-pressed={isSelected(SelectionKind.Passkey, strand.passkey.id)}
                      aria-label={`Passkey ${strand.passkey.shortId}, ${strand.passkey.mobility}, ${strand.passkey.providerLabel}, protects ${strand.deviceKey.shortId}`}
                      class={`shrink-0 border-b font-mono text-[12px] tracking-[0.06em] transition motion-reduce:transition-none ${isSelected(SelectionKind.Passkey, strand.passkey.id) ? 'border-b-white' : 'border-b-transparent'}`}
                      onclick={() => pick(SelectionKind.Passkey, strand.passkey.id)}
                    >
                      {strand.passkey.shortId}
                    </button>
                    <span class="shrink-0 text-[11px] text-white/65 sm:min-w-0 sm:shrink sm:truncate">{strand.passkey.providerLabel}</span>
                  {/if}
                  <span class="flex-1" aria-hidden="true"></span>
                  {#if strand.usableNow}
                    <span class="hidden shrink-0 rounded-full bg-[#5fd39f] px-1.5 py-0.5 font-mono text-[9px] tracking-[0.14em] text-black uppercase sm:inline" aria-hidden="true">now</span>
                  {/if}
                </div>
              {/each}
            </div>
          </div>
        </li>
      {/each}
    </ul>

    <div class="mt-10 flex flex-wrap items-baseline gap-x-3 gap-y-2">
      <span class="{CAPS} text-white/55">Other physical devices</span>
      {#each otherDevices as device (device.id)}
        {@const keys = deviceKeys.filter((deviceKey) => deviceKey.deviceId === device.id)}
        {#each keys as deviceKey (deviceKey.id)}
          <button
            type="button"
            aria-pressed={isSelected(SelectionKind.DeviceKey, deviceKey.id)}
            aria-label={`Device key ${deviceKey.shortId}, ${device.label}`}
            class={`flex items-center gap-1.5 border-b transition motion-reduce:transition-none ${isSelected(SelectionKind.DeviceKey, deviceKey.id) ? 'border-b-white/50' : 'border-b-transparent'}`}
            onclick={() => pick(SelectionKind.DeviceKey, deviceKey.id)}
          >
            <span class="font-mono text-[12px] text-white/55">{deviceKey.shortId}</span>
            <span class="text-[11px] text-white/60">{device.label}</span>
          </button>
        {/each}
      {/each}
    </div>

    <div class="mt-8 border-t border-white/15 pt-5 text-[12px] leading-5 text-white/50">
      <p class="flex items-start gap-2"><Fingerprint class="mt-0.5 size-3.5 shrink-0 text-[#d7a654]" aria-hidden="true" /><span><strong class="font-medium text-white/75">Passkeys describe availability, not physical ownership.</strong> BE=1 credentials may be synced by their provider; BE=0 credentials are device-bound. Every Nook device key above remains local to its own installation.</span></p>
    </div>
  </section>
</main>
