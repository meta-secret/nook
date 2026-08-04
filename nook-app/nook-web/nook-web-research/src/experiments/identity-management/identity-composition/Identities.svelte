<script lang="ts">
  import {
    Cloud,
    Fingerprint,
    KeyRound,
    Laptop,
    UserRound,
    Users,
  } from '@lucide/svelte'
  import {
    AccessAvailability,
    deviceKeys,
    deviceKeysForPhysicalDevice,
    devicesForIdentity,
    DevicePresence,
    identities,
    identityById,
    IdentityKind,
    IdentityReplicationKind,
    passkeysForDeviceKey,
    PasskeyMobility,
    physicalDevices,
    providerMountById,
    type IdentityAccount,
  } from '../_shared/identity-model'

  interface Props {
    activeIdentityId: string
    onselectidentity: (identityId: string) => void
  }

  const CAPS = 'font-mono text-[10px] tracking-[0.22em] uppercase'

  let { activeIdentityId, onselectidentity }: Props = $props()

  const activeIdentity = $derived(identityById(activeIdentityId))
  const activeDevices = $derived(devicesForIdentity(activeIdentity))
  const currentDevice = $derived(
    physicalDevices.filter(
      (device) => device.presence === DevicePresence.Here,
    )[0],
  )
  const currentDeviceKeys = $derived(
    currentDevice
      ? deviceKeys.filter((deviceKey) => deviceKey.deviceId === currentDevice.id)
      : [],
  )
  const activeMounts = $derived(
    activeIdentity.replication.kind === IdentityReplicationKind.Mounted
      ? activeIdentity.replication.providerMountIds.map(providerMountById)
      : [],
  )

  function identityInk(kind: IdentityKind): string {
    return kind === IdentityKind.Collective ? '#9aa6ff' : '#ff7651'
  }

  function providerLabel(identity: IdentityAccount): string {
    if (identity.replication.kind === IdentityReplicationKind.LocalOnly) {
      return 'record · local only'
    }
    const mounts = identity.replication.providerMountIds.map(providerMountById)
    if (mounts.length !== 1) return `record · ${mounts.length} mounts`
    const mount = mounts[0]
    if (!mount) return 'record · mounted'
    return `record · ${mount.provider.replace('Google ', '')}`
  }

  function keyCount(identity: IdentityAccount): string {
    const count = identity.deviceKeyIds.length
    return `${count} key${count === 1 ? '' : 's'}`
  }

  function deviceCount(identity: IdentityAccount): string {
    const count = devicesForIdentity(identity).length
    return `${count} device${count === 1 ? '' : 's'}`
  }

  function presenceLabel(presence: DevicePresence): string {
    return presence === DevicePresence.Here ? 'here' : 'elsewhere'
  }

  function availabilityLabel(availability: AccessAvailability): string {
    if (availability === AccessAvailability.Here) return 'available here'
    if (availability === AccessAvailability.Elsewhere) return 'elsewhere'
    return 'availability unknown'
  }
</script>

<section aria-labelledby="identities-title">
  {#if currentDevice}
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
          {@const identity = identities.find((candidate) => candidate.deviceKeyIds.includes(deviceKey.id))}
          {#if identity}
            <button
              type="button"
              aria-pressed={identity.id === activeIdentityId}
              aria-label={`Select identity ${identity.label} through local device key ${deviceKey.shortId}`}
              class={`flex items-center gap-1.5 border px-2 py-1 transition motion-reduce:transition-none ${identity.id === activeIdentityId ? 'border-white' : 'border-white/20'}`}
              onclick={() => onselectidentity(identity.id)}
            >
              <KeyRound class="size-3 shrink-0 text-white/55" aria-hidden="true" />
              <span class="font-mono text-[13px] tracking-[0.06em]">{deviceKey.shortId}</span>
              <span class="text-[11px] text-white/50">{identity.label}</span>
            </button>
          {/if}
        {/each}
      </div>
    </article>
  {/if}

  <p id="identities-title" class="{CAPS} mt-10 flex items-center gap-1.5 text-white/45">
    <UserRound class="size-3" aria-hidden="true" />
    My identities
  </p>

  <ul class="mt-3 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
    {#each identities as identity (identity.id)}
      {@const selected = identity.id === activeIdentityId}
      <li class={selected ? 'opacity-100' : 'opacity-55'}>
        <button
          type="button"
          aria-pressed={selected}
          aria-label={`Identity ${identity.label}, ${identity.shortId}, ${deviceCount(identity)}, ${keyCount(identity)}, ${providerLabel(identity)}`}
          class={`grid h-full w-full grid-cols-[2rem_minmax(0,1fr)_5rem] items-center gap-2.5 rounded-r-md rounded-l-full border bg-[#121316] py-2 pr-3 pl-2 text-left transition motion-reduce:transition-none ${selected ? 'border-white' : 'border-white/20 hover:border-white/45'}`}
          onclick={() => onselectidentity(identity.id)}
        >
          <span
            class="grid size-8 shrink-0 place-items-center rounded-full border-2"
            style={`border-color:${identityInk(identity.kind)};background:${identityInk(identity.kind)}18`}
            aria-hidden="true"
          >
            {#if identity.kind === IdentityKind.Collective}
              <Users class="size-3.5" style={`color:${identityInk(identity.kind)}`} />
            {:else}
              <UserRound class="size-3.5" style={`color:${identityInk(identity.kind)}`} />
            {/if}
          </span>
          <span class="min-w-0 flex-1">
            <span class="block truncate text-[11px] text-white/55">{identity.label}</span>
            <span class="mt-0.5 block font-mono text-[15px] tracking-[0.08em]">{identity.shortId}</span>
          </span>
          <span class="flex min-w-0 flex-col items-end gap-1 text-right">
            <span class="flex items-center gap-1 text-[9px] tracking-[0.08em] text-white/65 uppercase">
              <Cloud class="size-2.5" aria-hidden="true" />
              {providerLabel(identity)}
            </span>
            <span class="{CAPS} text-[9px] text-white/60">{deviceCount(identity)} · {keyCount(identity)}</span>
          </span>
        </button>
      </li>
    {/each}
  </ul>

  <div class="mt-4 border-y border-white/20 bg-[#121316]/55">
    <header class="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-white/15 px-4 py-3">
      <span class="font-mono text-[15px] tracking-[0.08em]">{activeIdentity.shortId}</span>
      <span class="text-[12px] text-white/75">{activeIdentity.label}</span>
      <span class="font-mono text-[9px] tracking-[0.12em] text-white/45 uppercase">contains</span>
      <span class="ml-auto text-[10px] text-white/55">{activeIdentity.role}</span>
    </header>

    {#if activeMounts.length > 0}
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-white/15 px-4 py-2 text-[11px] text-white/55">
        <Cloud class="size-3 shrink-0" aria-hidden="true" />
        <span class="{CAPS} text-white/45">Identity record</span>
        {#each activeMounts as mount (mount.id)}
          <span>{mount.provider} · {mount.target}</span>
        {/each}
      </div>
    {:else}
      <div class="flex items-center gap-2 border-b border-white/15 px-4 py-2 text-[11px] text-white/55">
        <Cloud class="size-3 shrink-0" aria-hidden="true" />
        <span>Local-only identity record · no provider mounted</span>
      </div>
    {/if}

    <ul>
      {#each activeDevices as device (device.id)}
        {@const keys = deviceKeysForPhysicalDevice(activeIdentity, device.id)}
        <li class="flex flex-col border-b border-white/15 last:border-b-0 sm:flex-row">
          <div class="flex min-w-0 items-start gap-2.5 px-4 py-3 sm:w-52 sm:shrink-0 sm:border-r sm:border-white/15">
            <Laptop class="mt-0.5 size-4 shrink-0 text-white/60" aria-hidden="true" />
            <span class="min-w-0">
              <span class="block truncate text-[12px]">{device.label}</span>
              <span class="mt-0.5 block text-[10px] text-white/45">{device.platform}</span>
              <span class={`mt-1 block font-mono text-[9px] tracking-[0.12em] uppercase ${device.presence === DevicePresence.Here ? 'text-[#5fd39f]' : 'text-white/45'}`}>
                physical device · {presenceLabel(device.presence)}
              </span>
            </span>
          </div>

          <div class="min-w-0 flex-1 py-2">
            {#each keys as deviceKey (deviceKey.id)}
              {@const passkeys = passkeysForDeviceKey(deviceKey.id)}
              <div class="flex min-w-0 items-center gap-2 overflow-x-auto px-4 py-1.5 [scrollbar-width:none] lg:overflow-visible">
                <span class="w-4 shrink-0 border-t border-white/35" aria-hidden="true"></span>
                <KeyRound class="size-3 shrink-0 text-white/55" aria-hidden="true" />
                <span class="{CAPS} shrink-0 text-white/45">Device key</span>
                <span class="shrink-0 font-mono text-[13px] tracking-[0.06em]">{deviceKey.shortId}</span>
                <span class="shrink-0 font-mono text-[10px] text-white/45">{deviceKey.publicKey}</span>
              </div>
              {#each passkeys as passkey (passkey.id)}
                <div class="flex min-w-0 items-center gap-2 overflow-x-auto px-4 py-1.5 pl-10 [scrollbar-width:none] lg:overflow-visible">
                  <span class="w-4 shrink-0 border-t border-white/20" aria-hidden="true"></span>
                  <Fingerprint class={`size-3 shrink-0 ${passkey.mobility === PasskeyMobility.Synced ? 'text-[#d7a654]' : 'text-[#5fd39f]'}`} aria-hidden="true" />
                  <span class="{CAPS} shrink-0 text-white/45">Passkey</span>
                  <span class="shrink-0 font-mono text-[13px] tracking-[0.06em]">{passkey.shortId}</span>
                  <span class="shrink-0 text-[11px] text-white/60">{passkey.providerLabel}</span>
                  <span class={`ml-auto shrink-0 font-mono text-[9px] tracking-[0.1em] uppercase ${passkey.availability === AccessAvailability.Here ? 'text-[#5fd39f]' : 'text-white/45'}`}>
                    {passkey.mobility} · {availabilityLabel(passkey.availability)}
                  </span>
                </div>
              {/each}
            {/each}
          </div>
        </li>
      {:else}
        <li class="px-4 py-6 text-[12px] text-white/55">
          This identity contains no physical devices, device keys, or passkeys yet.
        </li>
      {/each}
    </ul>
  </div>

  <p class="mt-5 flex items-start gap-2 border-t border-white/15 pt-4 text-[11px] leading-5 text-white/45">
    <Fingerprint class="mt-0.5 size-3.5 shrink-0 text-[#d7a654]" aria-hidden="true" />
    <span><strong class="font-medium text-white/70">Passkeys describe availability, not physical ownership.</strong> Every Nook device key remains local to its own installation.</span>
  </p>
</section>
