<!--
THESIS: Treat identity management like an account access console. Select an
identity, then scan its devices, device keys, passkeys, and replicated record
as evidence cards. A separate switchboard below draws vault grants strictly
between identities and vaults.
-->
<script lang="ts">
  import {
    Cloud,
    Fingerprint,
    KeyRound,
    Laptop,
    Radio,
    Smartphone,
    UserRound,
    Users,
    Vault as VaultIcon,
  } from '@lucide/svelte'
  import ExperimentBack from '$lib/components/ExperimentBack.svelte'
  import type { ExperimentProps } from '../../index'
  import {
    AccessAvailability,
    deviceKeysForIdentity,
    deviceKeysForPhysicalDevice,
    devicesForIdentity,
    DevicePresence,
    identities,
    identityById,
    IdentityKind,
    IdentityReplicationKind,
    passkeysForIdentity,
    providerMountById,
    vaultGrants,
    type IdentityAccount,
    type VaultGrant,
  } from '../_shared/identity-model'

  interface VaultRead {
    id: string
    label: string
    grants: readonly VaultGrant[]
  }

  const CAPS = 'font-mono text-[10px] tracking-[0.2em] uppercase'
  const ACCENT = '#f0703a'

  let { navigate }: ExperimentProps = $props()
  let selectedIdentityId = $state('identity-nora')
  let selectedVaultId = $state('store_2ae6')

  const selectedIdentity = $derived(identityById(selectedIdentityId))
  const selectedDevices = $derived(devicesForIdentity(selectedIdentity))
  const selectedKeys = $derived(deviceKeysForIdentity(selectedIdentity))
  const selectedPasskeys = $derived(passkeysForIdentity(selectedIdentity))
  const vaults = $derived(buildVaults())
  const selectedVault = $derived(vaultById(selectedVaultId))

  function buildVaults(): readonly VaultRead[] {
    const ids = [...new Set(vaultGrants.map((grant) => grant.vaultId))]
    return ids.map((id) => {
      const grants = vaultGrants.filter((grant) => grant.vaultId === id)
      const first = grants[0]
      if (first) return { id, label: first.vaultLabel, grants }
      throw new Error(`Unknown fixture vault ${id}`)
    })
  }

  function vaultById(id: string): VaultRead {
    const match = vaults.find((vault) => vault.id === id)
    if (match) return match
    throw new Error(`Unknown fixture vault ${id}`)
  }

  function identityHasGrant(identity: IdentityAccount): boolean {
    return selectedVault.grants.some((grant) => grant.identityId === identity.id)
  }

  function grantForIdentity(identity: IdentityAccount): readonly VaultGrant[] {
    return selectedVault.grants.filter((grant) => grant.identityId === identity.id)
  }

  function grantLabel(identity: IdentityAccount): string {
    const grants = grantForIdentity(identity)
    const first = grants[0]
    return first ? first.capability : 'No grant'
  }

  function providerSummary(identity: IdentityAccount): string {
    if (identity.replication.kind === IdentityReplicationKind.LocalOnly) return 'Local-only identity record'
    return identity.replication.providerMountIds
      .map((mountId) => providerMountById(mountId).provider)
      .join(' + ')
  }

  function providerDetail(identity: IdentityAccount): string {
    if (identity.replication.kind === IdentityReplicationKind.LocalOnly) return 'No provider mount'
    return identity.replication.providerMountIds
      .map((mountId) => {
        const mount = providerMountById(mountId)
        return `${mount.accountLabel} · ${mount.target}`
      })
      .join(' · ')
  }

  function identityIcon(identity: IdentityAccount): IdentityKind {
    return identity.kind
  }

  function availabilityLabel(method: { availability: AccessAvailability }): string {
    if (method.availability === AccessAvailability.Here) return 'Ready here'
    if (method.availability === AccessAvailability.Elsewhere) return 'Elsewhere'
    return 'Unknown here'
  }
</script>

<main class="min-h-[100svh] bg-[#08090a] text-[#f5f5f4]">
  <ExperimentBack {navigate} />

  <section class="mx-auto max-w-6xl px-5 pt-24 pb-24 sm:px-8">
    <header class="max-w-2xl">
      <p class="{CAPS}" style={`color:${ACCENT}`}>Devices &amp; access</p>
      <h1 class="mt-3 text-3xl font-medium tracking-tight sm:text-4xl">Identity switchboard</h1>
      <p class="mt-3 text-sm leading-6 text-white/55">Choose an identity to inspect how it is present on devices. Vault permissions live in a separate control plane below.</p>
    </header>

    <section class="mt-12 grid border border-white/15 bg-[#111214] lg:grid-cols-[15rem_1fr]" aria-labelledby="access-methods-heading">
      <aside class="border-b border-white/15 p-3 lg:border-r lg:border-b-0">
        <p class="px-3 pt-2 pb-3 {CAPS} text-white/35">My identities</p>
        <nav aria-label="Choose identity">
          <ul class="space-y-1">
            {#each identities as identity (identity.id)}
              {@const active = identity.id === selectedIdentityId}
              <li>
                <button
                  type="button"
                  aria-current={active ? 'page' : 'false'}
                  class={`flex min-h-12 w-full items-center gap-3 border px-3 py-2 text-left transition motion-reduce:transition-none ${active ? 'border-white/45 bg-white/[0.07]' : 'border-transparent text-white/55 hover:bg-white/[0.035] hover:text-white'}`}
                  onclick={() => (selectedIdentityId = identity.id)}
                >
                  {#if identityIcon(identity) === IdentityKind.Collective}
                    <Users class="size-4 shrink-0" aria-hidden="true" />
                  {:else}
                    <UserRound class="size-4 shrink-0" aria-hidden="true" />
                  {/if}
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-sm">{identity.label}</span>
                    <span class="mt-0.5 block font-mono text-[10px] tracking-[0.08em] text-white/35">{identity.shortId}</span>
                  </span>
                  <span class="font-mono text-[10px] text-white/35">{identity.deviceKeyIds.length}</span>
                </button>
              </li>
            {/each}
          </ul>
        </nav>
      </aside>

      <div class="min-w-0 p-5 sm:p-7">
        <header class="flex flex-wrap items-start justify-between gap-4 border-b border-white/15 pb-5">
          <div>
            <p class="{CAPS} text-white/35">Identity access methods</p>
            <h2 id="access-methods-heading" class="mt-2 text-2xl">{selectedIdentity.label}</h2>
            <p class="mt-1 text-xs text-white/45">{selectedIdentity.role} · {selectedIdentity.shortId}</p>
          </div>
          <div class="max-w-sm border-l pl-4" style={`border-color:${ACCENT}`}>
            <p class="flex items-center gap-2 text-xs"><Cloud class="size-4" style={`color:${ACCENT}`} aria-hidden="true" />{providerSummary(selectedIdentity)}</p>
            <p class="mt-1 text-[11px] leading-4 text-white/35">{providerDetail(selectedIdentity)}</p>
          </div>
        </header>

        {#if selectedKeys.length === 0}
          <div class="grid min-h-64 place-items-center border border-dashed border-white/20 text-center">
            <div>
              <KeyRound class="mx-auto size-7 text-white/25" aria-hidden="true" />
              <p class="mt-3 text-sm">No access methods</p>
              <p class="mt-1 text-xs text-white/40">This identity has no device keys yet.</p>
            </div>
          </div>
        {:else}
          <div class="mt-6 grid gap-3 md:grid-cols-2">
            {#each selectedDevices as device (device.id)}
              {@const keys = deviceKeysForPhysicalDevice(selectedIdentity, device.id)}
              <article class={`border p-4 ${device.presence === DevicePresence.Here ? 'border-white/50 bg-white/[0.045]' : 'border-white/15'}`}>
                <div class="flex items-start gap-3">
                  <span class="grid size-9 shrink-0 place-items-center border border-white/20">
                    {#if device.platform.includes('iOS')}
                      <Smartphone class="size-4" aria-hidden="true" />
                    {:else}
                      <Laptop class="size-4" aria-hidden="true" />
                    {/if}
                  </span>
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-sm font-medium">{device.label}</p>
                    <p class="mt-1 text-[11px] leading-4 text-white/40">{device.platform}</p>
                  </div>
                  <span class={`font-mono text-[9px] tracking-[0.1em] uppercase ${device.presence === DevicePresence.Here ? 'text-[#5fd39f]' : 'text-white/35'}`}>{device.presence}</span>
                </div>

                <div class="mt-5 space-y-4">
                  {#each keys as key (key.id)}
                    <div>
                      <p class="flex items-center gap-2"><KeyRound class="size-3.5 text-white/45" aria-hidden="true" /><span class="font-mono text-sm tracking-[0.08em]">{key.shortId}</span><span class="ml-auto text-[10px] text-white/35">{key.addedAt}</span></p>
                      <p class="mt-1 pl-[1.375rem] font-mono text-[10px] text-white/30">{key.publicKey}</p>
                    </div>
                  {/each}
                </div>
              </article>
            {/each}

            {#each selectedPasskeys as passkey (passkey.id)}
              <article class="border border-white/15 p-4">
                <div class="flex items-start gap-3">
                  <span class="grid size-9 shrink-0 place-items-center border border-white/20"><Fingerprint class="size-4" style={`color:${ACCENT}`} aria-hidden="true" /></span>
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-sm font-medium">{passkey.providerLabel}</p>
                    <p class="mt-1 font-mono text-[11px] tracking-[0.08em] text-white/40">{passkey.shortId} · passkey</p>
                  </div>
                  <span class={`font-mono text-[9px] tracking-[0.1em] uppercase ${passkey.availability === AccessAvailability.Here ? 'text-[#5fd39f]' : 'text-white/35'}`}>{availabilityLabel(passkey)}</span>
                </div>
                <p class="mt-5 border-t border-white/10 pt-3 text-[11px] leading-4 text-white/40">{passkey.evidence}</p>
              </article>
            {/each}
          </div>
        {/if}
      </div>
    </section>

    <section class="mt-16 border border-white/15 bg-[#0d0e10]" aria-labelledby="grant-map-heading">
      <header class="flex flex-wrap items-end justify-between gap-4 border-b border-white/15 px-5 py-5 sm:px-7">
        <div>
          <p class="{CAPS} text-white/35">Separate authorization plane</p>
          <h2 id="grant-map-heading" class="mt-2 flex items-center gap-2 text-xl"><Radio class="size-5" style={`color:${ACCENT}`} aria-hidden="true" /> Vault grant switchboard</h2>
        </div>
        <p class="max-w-md text-xs leading-5 text-white/40">Only identities cross this boundary. Their internal devices, keys, passkeys, and sync mounts do not.</p>
      </header>

      <div class="px-5 py-7 sm:px-7 sm:py-9">
        <div class="grid gap-3 sm:grid-cols-3">
          {#each identities as identity (identity.id)}
            {@const connected = identityHasGrant(identity)}
            <button
              type="button"
              class={`relative border px-4 py-4 text-left transition motion-reduce:transition-none ${connected ? 'border-[#f0703a]/70 bg-[#f0703a]/[0.045]' : 'border-white/10 text-white/35 hover:border-white/25'}`}
              onclick={() => (selectedIdentityId = identity.id)}
            >
              <span class="flex items-center gap-2">
                {#if identity.kind === IdentityKind.Collective}
                  <Users class="size-4" aria-hidden="true" />
                {:else}
                  <UserRound class="size-4" aria-hidden="true" />
                {/if}
                <span class="min-w-0 flex-1 truncate text-sm">{identity.label}</span>
              </span>
              <span class="mt-2 flex items-center justify-between gap-2 font-mono text-[10px] tracking-[0.08em]">
                <span>{identity.shortId}</span>
                <span>{grantLabel(identity)}</span>
              </span>
              {#if connected}
                <span class="absolute -bottom-5 left-1/2 hidden h-5 w-px -translate-x-1/2 bg-[#f0703a]/70 sm:block" aria-hidden="true"></span>
              {/if}
            </button>
          {/each}
        </div>

        <svg
          viewBox="0 0 300 44"
          preserveAspectRatio="none"
          class="mt-5 hidden h-11 w-full sm:block"
          aria-hidden="true"
          focusable="false"
        >
          {#each identities as identity, index (identity.id)}
            {#if identityHasGrant(identity)}
              <path
                d={`M ${50 + index * 100} 0 V14 C ${50 + index * 100} 28 150 24 150 44`}
                fill="none"
                stroke={ACCENT}
                stroke-opacity="0.58"
                stroke-width="1"
                vector-effect="non-scaling-stroke"
              />
            {/if}
          {/each}
        </svg>

        <article class="mx-auto border px-5 py-6 text-center sm:max-w-2xl sm:px-8" style={`border-color:${ACCENT}`}>
          <VaultIcon class="mx-auto size-6" style={`color:${ACCENT}`} aria-hidden="true" />
          <p class="mt-3 {CAPS}" style={`color:${ACCENT}`}>Independent vault</p>
          <h3 class="mt-2 text-2xl">{selectedVault.label}</h3>
          <p class="mt-1 font-mono text-xs tracking-[0.08em] text-white/40">{selectedVault.id}</p>
          <p class="mt-4 text-xs text-white/45">{selectedVault.grants.length} identity grant{selectedVault.grants.length === 1 ? '' : 's'} · encrypted DEK remains vault-owned</p>
        </article>

        <div class="mt-5 flex flex-wrap justify-center gap-2" role="group" aria-label="Choose vault">
          {#each vaults as vault (vault.id)}
            <button
              type="button"
              aria-pressed={vault.id === selectedVaultId}
              class={`min-h-11 border px-4 py-2 text-left transition motion-reduce:transition-none ${vault.id === selectedVaultId ? 'border-white bg-white text-black' : 'border-white/20 hover:border-white/45'}`}
              onclick={() => (selectedVaultId = vault.id)}
            >
              <span class="block text-xs">{vault.label}</span>
              <span class="mt-0.5 block font-mono text-[9px] tracking-[0.08em] opacity-55">{vault.id}</span>
            </button>
          {/each}
        </div>
      </div>
    </section>
  </section>
</main>
