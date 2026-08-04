<!--
SKETCH 03: IDENTITY CHAIN LEDGER
Editorial cryptographic ledger layout adapting the chain-strength design system.
Section I (My Identities): Independent Inscribed Identity Register + attached devices & key slots drawer.
Section II (Vault Quorum Ledger): Visually separate Vault Quorum Ledger (K-of-N threshold agreements).
-->
<script lang="ts">
  import {
    Check,
    Cpu,
    Feather,
    Fingerprint,
    HardDrive,
    KeyRound,
    Laptop,
    Lock,
    Shield,
    Smartphone,
    Stamp,
    UserCheck,
    Vault as VaultIcon,
  } from '@lucide/svelte'
  import ExperimentBack from '$lib/components/ExperimentBack.svelte'
  import type { ExperimentProps } from '../../index'
  import {
    DeviceType,
    KeyType,
    MOCK_IDENTITIES,
    MOCK_VAULTS,
    VaultRole,
  } from '../_shared/identity-mock-data'
  import type { IdentityItem, KeyItem, VaultItem } from '../_shared/identity-mock-data'

  let { navigate }: ExperimentProps = $props()

  let selectedId = $state<string>('id-main')
  let selectedVaultId = $state<string>('vault-sentinel-core')

  const currentIdentity = $derived(
    MOCK_IDENTITIES.find((i) => i.id === selectedId) || MOCK_IDENTITIES[0],
  )
  const currentVault = $derived(
    MOCK_VAULTS.find((v) => v.id === selectedVaultId) || MOCK_VAULTS[0],
  )

  function getDeviceIcon(type: DeviceType) {
    switch (type) {
      case DeviceType.Workstation:
        return Laptop
      case DeviceType.SecurityKey:
        return KeyRound
      case DeviceType.MobileEnclave:
        return Smartphone
      case DeviceType.HardwareSigner:
        return HardDrive
    }
  }
</script>

<main class="min-h-screen bg-[#f6f3ec] text-[#1a1815] font-serif">
  <ExperimentBack {navigate} light />

  <div class="mx-auto max-w-5xl px-6 py-20 sm:px-10 space-y-12">
    <!-- Header -->
    <header class="border-y-2 border-[#1a1815] py-8">
      <p class="font-mono text-xs tracking-[0.2em] uppercase text-[#1a1815]/60">
        Chain-Strength Iteration 03 · Ledger Folio
      </p>
      <h1 class="mt-2 text-5xl tracking-tight sm:text-7xl font-normal">
        Identity Chain Ledger
      </h1>
      <p class="mt-3 max-w-2xl font-serif text-lg italic text-[#1a1815]/70">
        An editorial cryptographic ledger. Section I inscribes independent identities and device key slots; Section II records multi-party vault quorum agreements.
      </p>
    </header>

    <!-- PART 1: MY IDENTITIES (INDEPENDENT FOLIO SECTION I) -->
    <section class="border-2 border-[#1a1815] bg-[#fffdf7] p-8 space-y-6">
      <div class="flex items-center justify-between border-b-2 border-[#1a1815] pb-4">
        <div>
          <p class="font-mono text-xs tracking-[0.18em] uppercase text-[#1f5c44] font-semibold">
            Section I · Independent Identity Register
          </p>
          <h2 class="text-3xl tracking-tight mt-1 font-normal">
            My Identities & Device Key Inventory
          </h2>
        </div>
        <Feather class="size-6 text-[#1a1815]" />
      </div>

      <!-- Identity Selector Row -->
      <div class="grid gap-4 sm:grid-cols-3">
        {#each MOCK_IDENTITIES as identity (identity.id)}
          {@const isSelected = identity.id === selectedId}
          <button
            type="button"
            onclick={() => (selectedId = identity.id)}
            class={`border-2 p-4 text-left transition ${
              isSelected
                ? 'border-[#1a1815] bg-[#1a1815] text-[#f6f3ec]'
                : 'border-[#1a1815]/40 bg-[#f6f3ec] hover:border-[#1a1815]'
            }`}
          >
            <div class="font-mono text-xs uppercase tracking-wider mb-1 opacity-80">
              {identity.handle}
            </div>
            <div class="font-serif text-xl">{identity.name}</div>
            <div class="mt-3 border-t border-current/20 pt-2 font-mono text-[10px] flex justify-between">
              <span>{identity.devices.length} Devices</span>
              <span>Strength: {identity.chainStrengthScore}%</span>
            </div>
          </button>
        {/each}
      </div>

      <!-- Inscribed Identity Device Register -->
      <div class="border-t-2 border-[#1a1815] pt-6">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-2xl font-normal">
            Inscribed Roster for <span class="underline underline-offset-4">{currentIdentity.name}</span>
          </h3>
          <span class="font-mono text-xs border border-[#1a1815] px-2.5 py-1 rounded">
            STATUS: {currentIdentity.status.toUpperCase()}
          </span>
        </div>

        <div class="space-y-4">
          <p class="font-mono text-xs tracking-[0.16em] uppercase text-[#1a1815]/60">
            Attached Devices & Contained Key Slots
          </p>

          <div class="space-y-4">
            {#each currentIdentity.devices as device (device.id)}
              {@const DevIcon = getDeviceIcon(device.deviceType)}
              <div class="border-2 border-[#1a1815] bg-[#f6f3ec] p-4">
                <div class="flex items-center justify-between border-b border-[#1a1815]/30 pb-3 mb-3">
                  <div class="flex items-center gap-3">
                    <DevIcon class="size-5 text-[#1a1815]" />
                    <div>
                      <div class="font-mono text-sm font-bold">{device.name}</div>
                      <div class="font-mono text-xs text-[#1a1815]/60">{device.os}</div>
                    </div>
                  </div>
                  <span class="font-mono text-xs font-bold text-[#1f5c44]">TRUST SCORE: {device.trustScore}%</span>
                </div>

                <div class="grid gap-3 sm:grid-cols-2">
                  {#each device.keys as key (key.id)}
                    <div class="border border-[#1a1815]/40 bg-[#fffdf7] p-3 font-mono text-xs">
                      <div class="flex justify-between font-bold mb-1">
                        <span>{key.name}</span>
                        <span class="text-[10px] text-[#1d5084]">{key.keyType}</span>
                      </div>
                      <div class="text-[11px] text-[#1a1815]/60 truncate">{key.fingerprint}</div>
                    </div>
                  {/each}
                </div>
              </div>
            {/each}
          </div>
        </div>
      </div>
    </section>

    <!-- PART 2: VAULT QUORUM REGISTER (VISUALLY SEPARATE FOLIO SECTION II) -->
    <section class="border-2 border-[#1a1815] bg-[#fffdf7] p-8 space-y-6">
      <div class="flex items-center justify-between border-b-2 border-[#1a1815] pb-4">
        <div>
          <p class="font-mono text-xs tracking-[0.18em] uppercase text-[#1d5084] font-semibold">
            Section II · Visually Separate Vault Quorum Register
          </p>
          <h2 class="text-3xl tracking-tight mt-1 font-normal">
            Vault & Identity Quorum Relationships
          </h2>
          <p class="mt-1 font-serif text-sm italic text-[#1a1815]/60">
            Records multi-party identity quorums directly. Zero key-level clutter in vault agreements.
          </p>
        </div>
        <Stamp class="size-6 text-[#1a1815]" />
      </div>

      <!-- Vault Folio Cards -->
      <div class="space-y-4">
        {#each MOCK_VAULTS as vault (vault.id)}
          {@const isSelected = vault.id === selectedVaultId}
          {@const relatesToActiveIdentity = vault.associatedIdentityIds.includes(selectedId)}
          <div
            class={`border-2 p-5 transition ${
              isSelected
                ? 'border-[#1a1815] bg-[#1a1815] text-[#f6f3ec]'
                : relatesToActiveIdentity
                  ? 'border-[#1a1815] bg-[#f6f3ec]'
                  : 'border-[#1a1815]/40 bg-[#fffdf7] opacity-70'
            }`}
          >
            <div class="flex flex-wrap items-center justify-between gap-4 border-b border-current/20 pb-3">
              <div>
                <button
                  type="button"
                  onclick={() => (selectedVaultId = vault.id)}
                  class="font-serif text-2xl hover:underline text-left font-bold"
                >
                  {vault.name}
                </button>
                <p class="text-xs italic opacity-80 mt-0.5 font-sans">{vault.description}</p>
              </div>

              <div class="font-mono text-xs font-bold border border-current px-3 py-1">
                POLICY: {vault.thresholdK}-OF-{vault.totalN} QUORUM
              </div>
            </div>

            <!-- Authorized Identities -->
            <div class="mt-4">
              <div class="font-mono text-xs uppercase tracking-wider opacity-70 mb-2">
                Authorized Identity Participants ({vault.associatedIdentityIds.length})
              </div>

              <div class="flex flex-wrap items-center gap-3">
                {#each vault.associatedIdentityIds as identityId (identityId)}
                  {@const idObj = MOCK_IDENTITIES.find((i) => i.id === identityId)}
                  {@const role = vault.identityRoles[identityId]}
                  {#if idObj}
                    <div
                      class={`border px-3 py-1 font-mono text-xs flex items-center gap-2 rounded ${
                        identityId === selectedId
                          ? 'border-[#f6f3ec] bg-[#f6f3ec] text-[#1a1815] font-bold'
                          : 'border-current/40 bg-transparent'
                      }`}
                    >
                      <Check class="size-3.5" />
                      <span>{idObj.name}</span>
                      <span class="opacity-60">[{role}]</span>
                    </div>
                  {/if}
                {/each}
              </div>
            </div>
          </div>
        {/each}
      </div>
    </section>
  </div>
</main>
