<!--
SKETCH 03: IDENTITY SPECTRUM
Swiss typography & grid layout. Part 1 lists master identities and device key slots; Part 2 visually separates vault entitlement ledgers.
-->
<script lang="ts">
  import {
    Cpu,
    Fingerprint,
    HardDrive,
    KeyRound,
    Laptop,
    Lock,
    Shield,
    Smartphone,
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

  let activeId = $state<string>('id-main')
  let activeVaultId = $state<string>('vault-sentinel-core')

  const currentIdentity = $derived(
    MOCK_IDENTITIES.find((i) => i.id === activeId) || MOCK_IDENTITIES[0],
  )
  const currentVault = $derived(
    MOCK_VAULTS.find((v) => v.id === activeVaultId) || MOCK_VAULTS[0],
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

<main class="min-h-screen bg-[#faf8f5] text-[#1c1917] font-sans">
  <ExperimentBack {navigate} light />

  <div class="mx-auto max-w-5xl px-6 py-16 sm:px-10 space-y-12">
    <!-- Header -->
    <header class="border-b-2 border-[#1c1917] pb-6">
      <div class="font-mono text-xs text-[#84796e] tracking-widest uppercase mb-2">
        Spectrum // Concept 03
      </div>
      <h1 class="text-4xl font-light tracking-tight text-[#1c1917] sm:text-5xl">
        Identity Spectrum
      </h1>
      <p class="mt-3 text-sm text-[#78716c] max-w-2xl leading-relaxed">
        Swiss typography & grid. Section 1 holds independent identity device key rosters; Section 2 presents a clean, visually separated vault-identity entitlement ledger.
      </p>
    </header>

    <!-- PART 1: MY IDENTITIES -->
    <section class="border-2 border-[#1c1917] bg-white p-6 sm:p-8 space-y-6">
      <div class="flex items-center justify-between border-b border-[#1c1917]/20 pb-4">
        <div>
          <span class="font-mono text-xs text-[#059669] font-bold uppercase tracking-wider">
            Section 01 // Independent Registry
          </span>
          <h2 class="text-2xl font-normal text-[#1c1917] mt-1">
            My Identities & Device Keys
          </h2>
        </div>
        <span class="font-mono text-xs text-[#78716c]">Click to inspect key slots</span>
      </div>

      <!-- Identity Grid -->
      <div class="grid gap-4 sm:grid-cols-3">
        {#each MOCK_IDENTITIES as identity (identity.id)}
          {@const isSelected = identity.id === activeId}
          <button
            type="button"
            onclick={() => (activeId = identity.id)}
            class={`border-2 p-4 text-left transition ${
              isSelected
                ? 'border-[#1c1917] bg-[#1c1917] text-[#faf8f5]'
                : 'border-[#1c1917]/30 bg-[#faf8f5] hover:border-[#1c1917]'
            }`}
          >
            <div class="font-mono text-xs uppercase opacity-70 mb-1">{identity.handle}</div>
            <div class="font-medium text-lg mb-3">{identity.name}</div>
            <div class="flex items-center justify-between border-t border-current/20 pt-2 font-mono text-[11px]">
              <span>{identity.devices.length} Devices</span>
              <span class="font-bold">{identity.chainStrengthScore}%</span>
            </div>
          </button>
        {/each}
      </div>

      <!-- Device Breakdown -->
      <div class="border-t-2 border-[#1c1917]/20 pt-6 space-y-4">
        <div class="flex items-center justify-between">
          <h3 class="text-xl font-normal text-[#1c1917]">
            Roster for <span class="font-semibold">{currentIdentity.name}</span>
          </h3>
          <span class="font-mono text-xs border border-[#1c1917] px-2.5 py-1">
            {currentIdentity.status.toUpperCase()}
          </span>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          {#each currentIdentity.devices as device (device.id)}
            {@const DevIcon = getDeviceIcon(device.deviceType)}
            <div class="border-2 border-[#1c1917] bg-[#faf8f5] p-4 space-y-3">
              <div class="flex items-center justify-between border-b border-[#1c1917]/20 pb-3">
                <div class="flex items-center gap-3">
                  <DevIcon class="size-5 text-[#1c1917]" />
                  <div>
                    <div class="font-mono text-sm font-bold">{device.name}</div>
                    <div class="font-mono text-xs text-[#78716c]">{device.os}</div>
                  </div>
                </div>
                <span class="font-mono text-xs font-bold">TRUST: {device.trustScore}%</span>
              </div>

              <div class="space-y-2">
                {#each device.keys as key (key.id)}
                  <div class="border border-[#1c1917]/30 bg-white p-2.5 font-mono text-xs">
                    <div class="flex justify-between font-bold text-[#1c1917] mb-1">
                      <span>{key.name}</span>
                      <span class="text-[10px] text-[#2563eb]">{key.keyType}</span>
                    </div>
                    <div class="text-[11px] text-[#78716c] truncate">{key.fingerprint}</div>
                  </div>
                {/each}
              </div>
            </div>
          {/each}
        </div>
      </div>
    </section>

    <!-- PART 2: VAULT RELATIONSHIPS -->
    <section class="border-2 border-[#1c1917] bg-white p-6 sm:p-8 space-y-6">
      <div class="flex items-center justify-between border-b border-[#1c1917]/20 pb-4">
        <div>
          <span class="font-mono text-xs text-[#2563eb] font-bold uppercase tracking-wider">
            Section 02 // Visually Separate Entitlement Ledger
          </span>
          <h2 class="text-2xl font-normal text-[#1c1917] mt-1">
            Vault & Identity Entitlements
          </h2>
        </div>
        <span class="font-mono text-xs border border-[#1c1917] px-3 py-1 bg-[#faf8f5]">
          Identities $\leftrightarrow$ Vaults
        </span>
      </div>

      <div class="space-y-4">
        {#each MOCK_VAULTS as vault (vault.id)}
          {@const isSelected = vault.id === activeVaultId}
          {@const relatesToActiveIdentity = vault.associatedIdentityIds.includes(activeId)}
          <div
            class={`border-2 p-5 transition ${
              isSelected
                ? 'border-[#1c1917] bg-[#1c1917] text-[#faf8f5]'
                : relatesToActiveIdentity
                  ? 'border-[#1c1917] bg-[#faf8f5]'
                  : 'border-[#1c1917]/30 bg-white opacity-60'
            }`}
          >
            <div class="flex items-center justify-between border-b border-current/20 pb-3 mb-3">
              <button
                type="button"
                onclick={() => (activeVaultId = vault.id)}
                class="font-semibold text-lg hover:underline text-left"
              >
                {vault.name}
              </button>
              <span class="font-mono text-xs font-bold border border-current px-2.5 py-0.5">
                {vault.thresholdK}-OF-{vault.totalN} QUORUM
              </span>
            </div>

            <div class="font-mono text-xs uppercase opacity-70 mb-2">
              Authorized Identity Participants ({vault.associatedIdentityIds.length})
            </div>

            <div class="flex flex-wrap items-center gap-3">
              {#each vault.associatedIdentityIds as identityId (identityId)}
                {@const idObj = MOCK_IDENTITIES.find((i) => i.id === identityId)}
                {@const role = vault.identityRoles[identityId]}
                {#if idObj}
                  <div
                    class={`border px-3 py-1 font-mono text-xs flex items-center gap-2 ${
                      identityId === activeId
                        ? 'border-emerald-500 bg-emerald-950 text-emerald-300 font-bold'
                        : 'border-current/40 bg-transparent'
                    }`}
                  >
                    <span>{idObj.name}</span>
                    <span class="opacity-60">[{role}]</span>
                  </div>
                {/if}
              {/each}
            </div>
          </div>
        {/each}
      </div>
    </section>
  </div>
</main>
