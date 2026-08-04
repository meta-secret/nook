<!--
THESIS: Start with the account model, not cryptography. A person owns or joins
several identities; selecting one reveals its physical devices and access
methods. Vault authorization is deliberately rendered in a second, detached
band where identities are the only subjects.
-->
<script lang="ts">
  import {
    Cloud,
    Fingerprint,
    KeyRound,
    Laptop,
    Smartphone,
    UserRound,
    Users,
    Vault as VaultIcon,
  } from '@lucide/svelte'
  import ExperimentBack from '$lib/components/ExperimentBack.svelte'
  import type { ExperimentProps } from '../../index'
  import {
    AccessAvailability,
    deviceKeysForPhysicalDevice,
    devicesForIdentity,
    DevicePresence,
    identities,
    identityById,
    IdentityKind,
    IdentityReplicationKind,
    passkeysForDeviceKey,
    PasskeyMobility,
    providerMountById,
    vaultGrants,
    type IdentityAccount,
  } from '../_shared/identity-model'

  const CAPS = 'font-mono text-[10px] tracking-[0.2em] uppercase'
  const PERSONAL = '#ff7651'
  const COLLECTIVE = '#9aa6ff'

  let { navigate }: ExperimentProps = $props()
  let selectedIdentityId = $state('identity-nora')

  const selectedIdentity = $derived(identityById(selectedIdentityId))
  const selectedDevices = $derived(devicesForIdentity(selectedIdentity))
  const vaultIds = $derived([
    ...new Set(vaultGrants.map((grant) => grant.vaultId)),
  ])

  function identityInk(identity: IdentityAccount): string {
    return identity.kind === IdentityKind.Collective ? COLLECTIVE : PERSONAL
  }

  function deviceCount(identity: IdentityAccount): string {
    const count = devicesForIdentity(identity).length
    return `${count} device${count === 1 ? '' : 's'}`
  }

  function keyCount(identity: IdentityAccount): string {
    const count = identity.deviceKeyIds.length
    return `${count} key${count === 1 ? '' : 's'}`
  }

  function providerNames(identity: IdentityAccount): string {
    if (identity.replication.kind === IdentityReplicationKind.LocalOnly) {
      return 'Local only'
    }
    return identity.replication.providerMountIds
      .map((mountId) => providerMountById(mountId).provider)
      .join(' + ')
  }

  function grantsForVault(vaultId: string) {
    return vaultGrants.filter((grant) => grant.vaultId === vaultId)
  }

  function vaultLabel(vaultId: string): string {
    const grants = grantsForVault(vaultId)
    const first = grants[0]
    if (first) return first.vaultLabel
    throw new Error(`Unknown fixture vault ${vaultId}`)
  }

  function availabilityLabel(availability: AccessAvailability): string {
    if (availability === AccessAvailability.Here) return 'Available here'
    if (availability === AccessAvailability.Elsewhere) return 'Elsewhere'
    return 'Availability unknown'
  }
</script>

<main class="min-h-[100svh] bg-[#090a0c] text-[#f4f4f5]">
  <ExperimentBack {navigate} />

  <section class="mx-auto max-w-6xl px-5 pt-24 pb-24 sm:px-8">
    <header class="max-w-2xl">
      <p class="{CAPS} text-white/40">Devices &amp; access</p>
      <h1 class="mt-3 text-3xl font-medium tracking-tight sm:text-4xl">Identity atlas</h1>
      <p class="mt-3 text-sm leading-6 text-white/55">
        Your identities are virtual accounts. Each one keeps its own device relationships and access methods.
      </p>
    </header>

    <section class="mt-12 border border-white/20 bg-[#111216]" aria-labelledby="identities-heading">
      <div class="border-b border-white/15 px-5 py-5 sm:px-7">
        <div class="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p class="{CAPS} text-white/40">Part one · independent</p>
            <h2 id="identities-heading" class="mt-2 flex items-center gap-2 text-xl">
              <UserRound class="size-5" aria-hidden="true" /> My identities
            </h2>
          </div>
          <div class="flex items-center gap-3 text-xs text-white/50">
            <span class="grid size-8 place-items-center rounded-full border border-white/25"><UserRound class="size-4" aria-hidden="true" /></span>
            <span><strong class="block font-medium text-white/80">You</strong>1 person · {identities.length} identities</span>
          </div>
        </div>
      </div>

      <div class="px-5 pt-7 sm:px-7">
        <div class="relative hidden h-7 sm:block" aria-hidden="true">
          <span class="absolute top-0 left-1/2 h-3 w-px bg-white/25"></span>
          <span class="absolute top-3 right-[16.66%] left-[16.66%] border-t border-white/20"></span>
          <span class="absolute top-3 right-[16.66%] h-4 w-px bg-white/20"></span>
          <span class="absolute top-3 left-1/2 h-4 w-px bg-white/20"></span>
          <span class="absolute top-3 left-[16.66%] h-4 w-px bg-white/20"></span>
        </div>

        <ul class="grid gap-3 sm:grid-cols-3">
          {#each identities as identity (identity.id)}
            {@const selected = identity.id === selectedIdentityId}
            <li>
              <button
                type="button"
                aria-pressed={selected}
                class={`group h-full w-full border px-4 py-4 text-left transition motion-reduce:transition-none ${selected ? 'border-white bg-white/[0.07]' : 'border-white/15 bg-[#0d0e11] hover:border-white/35'}`}
                onclick={() => (selectedIdentityId = identity.id)}
              >
                <span class="flex items-start gap-3">
                  <span
                    class="grid size-9 shrink-0 place-items-center rounded-full border"
                    style={`border-color:${identityInk(identity)};color:${identityInk(identity)};background:${identityInk(identity)}14`}
                  >
                    {#if identity.kind === IdentityKind.Collective}
                      <Users class="size-4" aria-hidden="true" />
                    {:else}
                      <UserRound class="size-4" aria-hidden="true" />
                    {/if}
                  </span>
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-sm font-medium">{identity.label}</span>
                    <span class="mt-1 block font-mono text-xs tracking-[0.08em] text-white/45">{identity.shortId}</span>
                  </span>
                </span>
                <span class="mt-5 flex items-center justify-between gap-3 text-[11px] text-white/55">
                  <span>{deviceCount(identity)}</span>
                  <span>{keyCount(identity)}</span>
                </span>
              </button>
            </li>
          {/each}
        </ul>
      </div>

      <article class="mt-7 border-t border-white/20 bg-[#0d0e11]">
        <header class="grid gap-5 border-b border-white/15 px-5 py-5 sm:grid-cols-[1fr_auto] sm:px-7">
          <div>
            <p class="{CAPS} text-white/40">Selected identity</p>
            <h3 class="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-2xl">
              {selectedIdentity.label}
              <span class="font-mono text-base tracking-[0.08em] text-white/45">{selectedIdentity.shortId}</span>
            </h3>
            <p class="mt-2 text-xs text-white/50">{selectedIdentity.role}</p>
          </div>
          <div class="sm:text-right">
            <p class="{CAPS} text-white/40">Identity record</p>
            <p class="mt-2 flex items-center gap-2 text-sm sm:justify-end">
              <Cloud class="size-4 text-white/45" aria-hidden="true" />
              {providerNames(selectedIdentity)}
            </p>
            <p class="mt-1 text-xs text-white/40">Replicates public keys and relationship events</p>
          </div>
        </header>

        <div class="px-5 py-2 sm:px-7">
          {#if selectedDevices.length === 0}
            <div class="py-12 text-center">
              <KeyRound class="mx-auto size-6 text-white/30" aria-hidden="true" />
              <p class="mt-3 text-sm text-white/70">No devices or device keys yet</p>
              <p class="mt-1 text-xs text-white/40">This identity exists, but cannot authorize anything yet.</p>
            </div>
          {:else}
            <ul class="divide-y divide-white/15">
              {#each selectedDevices as device (device.id)}
                {@const keys = deviceKeysForPhysicalDevice(selectedIdentity, device.id)}
                <li class="grid gap-5 py-6 lg:grid-cols-[15rem_1fr]">
                  <div>
                    <p class="flex items-center gap-2 text-base">
                      {#if device.platform.includes('iOS')}
                        <Smartphone class="size-4 text-white/60" aria-hidden="true" />
                      {:else}
                        <Laptop class="size-4 text-white/60" aria-hidden="true" />
                      {/if}
                      {device.label}
                    </p>
                    <p class="mt-1.5 text-xs leading-5 text-white/45">{device.platform}</p>
                    <p class="mt-3 {CAPS} {device.presence === DevicePresence.Here ? 'text-[#5fd39f]' : 'text-white/35'}">
                      {device.presence === DevicePresence.Here ? 'This physical device' : 'Physical device · elsewhere'}
                    </p>
                  </div>

                  <div class="space-y-3">
                    {#each keys as deviceKey (deviceKey.id)}
                      {@const methods = passkeysForDeviceKey(deviceKey.id)}
                      <div class="border-l border-white/35 pl-4">
                        <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                          <span class="{CAPS} text-white/35">Device key</span>
                          <span class="font-mono text-sm tracking-[0.08em]">{deviceKey.shortId}</span>
                          <span class="font-mono text-xs text-white/35">{deviceKey.publicKey}</span>
                          <span class="ml-auto text-[11px] text-white/35">{deviceKey.addedAt}</span>
                        </div>
                        {#if methods.length > 0}
                          <ul class="mt-3 space-y-2">
                            {#each methods as method (method.id)}
                              <li class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-white/55">
                                <Fingerprint class={`size-4 ${method.mobility === PasskeyMobility.Synced ? 'text-[#d7a654]' : 'text-[#5fd39f]'}`} aria-hidden="true" />
                                <span class="font-mono tracking-[0.08em] text-white/80">{method.shortId}</span>
                                <span>{method.providerLabel}</span>
                                <span class="ml-auto font-mono text-[10px] tracking-[0.1em] uppercase">{availabilityLabel(method.availability)}</span>
                              </li>
                            {/each}
                          </ul>
                        {:else}
                          <p class="mt-2 text-xs text-white/35">No passkey relationship recorded</p>
                        {/if}
                      </div>
                    {/each}
                  </div>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      </article>
    </section>

    <section class="mt-16 border-t-2 border-white/55 pt-8" aria-labelledby="vault-access-heading">
      <div class="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p class="{CAPS} text-white/40">Part two · authorization</p>
          <h2 id="vault-access-heading" class="mt-2 flex items-center gap-2 text-xl">
            <VaultIcon class="size-5" aria-hidden="true" /> Vaults ↔ identities
          </h2>
        </div>
        <p class="max-w-md text-xs leading-5 text-white/45">Vaults authorize identities. Device keys and passkeys stay inside identity management.</p>
      </div>

      <ul class="mt-6 space-y-3">
        {#each vaultIds as vaultId (vaultId)}
          {@const grants = grantsForVault(vaultId)}
          <li class="grid border border-white/20 bg-[#111216] sm:grid-cols-[16rem_1fr]">
            <div class="border-b border-white/15 px-5 py-5 sm:border-r sm:border-b-0">
              <p class="{CAPS} text-[#5fd39f]">Independent vault</p>
              <p class="mt-2 text-lg">{vaultLabel(vaultId)}</p>
              <p class="mt-1 font-mono text-xs tracking-[0.08em] text-white/40">{vaultId}</p>
            </div>
            <div class="px-5 py-5">
              <p class="{CAPS} text-white/35">Authorized identities</p>
              <div class="mt-3 flex flex-wrap gap-2">
                {#each grants as grant (grant.id)}
                  {@const identity = identityById(grant.identityId)}
                  <button
                    type="button"
                    class={`flex items-center gap-2 rounded-full border px-3 py-2 text-left transition motion-reduce:transition-none ${identity.id === selectedIdentityId ? 'border-white bg-white/[0.07]' : 'border-white/20 hover:border-white/40'}`}
                    onclick={() => (selectedIdentityId = identity.id)}
                  >
                    <span class="size-2 rounded-full" style={`background:${identityInk(identity)}`}></span>
                    <span class="text-xs">{identity.label}</span>
                    <span class="font-mono text-[10px] tracking-[0.08em] text-white/40">{grant.capability}</span>
                  </button>
                {/each}
              </div>
            </div>
          </li>
        {/each}
      </ul>
    </section>
  </section>
</main>
