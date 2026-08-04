<!--
SKETCH 02: IDENTITY CHAIN RIBBON
Tactile ribbon & badge hierarchy adapting the chain-strength design system.
Part 1 (My Identities): Independent top roster with expandable device key material.
Part 2 (Vault & Identity Ribbon): Visually separate entitlement ribbon mapping Vaults directly to Identities with threshold K-of-N badges.
-->
<script lang="ts">
  import {
    Activity,
    CheckCircle2,
    ChevronDown,
    ChevronRight,
    Cpu,
    Fingerprint,
    HardDrive,
    KeyRound,
    Laptop,
    Lock,
    Shield,
    ShieldCheck,
    Smartphone,
    UserCheck,
    Users,
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

  const CAPS = 'font-mono text-[10px] tracking-[0.22em] uppercase'

  let selectedIdentityId = $state<string>('id-main')
  let selectedVaultId = $state<string>('vault-sentinel-core')

  const selectedIdentity = $derived(
    MOCK_IDENTITIES.find((i) => i.id === selectedIdentityId) || MOCK_IDENTITIES[0],
  )
  const selectedVault = $derived(
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

  function getRoleBadge(role: VaultRole): string {
    switch (role) {
      case VaultRole.Owner:
        return 'border-[#1f5c44] text-[#1f5c44] bg-[#1f5c44]/10'
      case VaultRole.FullSigner:
        return 'border-[#1d5084] text-[#1d5084] bg-[#1d5084]/10'
      case VaultRole.ThresholdParticipant:
        return 'border-[#6c4897] text-[#6c4897] bg-[#6c4897]/10'
      case VaultRole.RecoveryGuardian:
        return 'border-[#8a5d0f] text-[#8a5d0f] bg-[#8a5d0f]/10'
      case VaultRole.ReadOnlyObserver:
        return 'border-[#1a1815]/40 text-[#1a1815]/60 bg-[#1a1815]/5'
    }
  }
</script>

<main class="min-h-screen bg-[#f6f3ec] text-[#1a1815] font-serif">
  <ExperimentBack {navigate} light />

  <div class="mx-auto max-w-5xl px-6 py-20 sm:px-8 space-y-12">
    <!-- Header -->
    <header class="border-b-2 border-[#1a1815] pb-6">
      <div class="flex items-center gap-2 text-[#1d5084] font-mono text-xs tracking-widest uppercase mb-2">
        <ShieldCheck class="size-4" />
        Chain-Strength Iteration 02
      </div>
      <h1 class="text-4xl font-normal tracking-tight text-[#1a1815] sm:text-6xl">
        Identity Chain Ribbon
      </h1>
      <p class="mt-3 text-sm font-sans text-[#1a1815]/70 max-w-2xl leading-relaxed">
        Tactile ribbon and badge hierarchy. Part 1 lists independent identities with attached devices & key material; Part 2 presents a visually separate Vault $\leftrightarrow$ Identity entitlement ribbon.
      </p>
    </header>

    <!-- PART 1: MY IDENTITIES -->
    <section class="border-2 border-[#1a1815] bg-[#fffdf7] p-6 sm:p-8 space-y-6">
      <div class="flex flex-wrap items-center justify-between gap-4 border-b border-[#1a1815]/20 pb-4">
        <div>
          <p class="{CAPS} text-[#1f5c44] font-semibold">
            Part 1 · Independent Identity Registry
          </p>
          <h2 class="mt-1 font-serif text-3xl font-normal tracking-tight text-[#1a1815]">
            My Identities & Device Keys
          </h2>
        </div>
        <div class="font-mono text-xs text-[#1a1815]/60 border border-[#1a1815]/20 bg-[#f6f3ec] px-3 py-1.5 rounded">
          Click an identity to inspect devices
        </div>
      </div>

      <!-- Identity Badges -->
      <div class="grid gap-4 sm:grid-cols-3">
        {#each MOCK_IDENTITIES as identity (identity.id)}
          {@const isSelected = identity.id === selectedIdentityId}
          <button
            type="button"
            onclick={() => (selectedIdentityId = identity.id)}
            class={`border-2 p-4 text-left rounded-md transition ${
              isSelected
                ? 'border-[#1a1815] bg-[#1a1815] text-[#f6f3ec] shadow-md'
                : 'border-[#1a1815]/30 bg-[#fffdf7] text-[#1a1815] hover:border-[#1a1815]'
            }`}
          >
            <div class="font-mono text-xs opacity-70 mb-1">{identity.handle}</div>
            <div class="font-serif font-medium text-lg mb-2">{identity.name}</div>
            <div class="flex items-center justify-between border-t border-current/20 pt-2 font-mono text-[11px]">
              <span>{identity.devices.length} Devices</span>
              <span class="font-bold">{identity.chainStrengthScore}% Strength</span>
            </div>
          </button>
        {/each}
      </div>

      <!-- Device Breakdown for Selected Identity -->
      <div class="border-t-2 border-[#1a1815]/30 pt-6">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-2xl font-normal text-[#1a1815]">
            Device Key Inventory for <span class="underline underline-offset-4">{selectedIdentity.name}</span>
          </h3>
          <span class="font-mono text-xs border border-[#1a1815] px-2.5 py-1 rounded">
            STATUS: {selectedIdentity.status.toUpperCase()}
          </span>
        </div>

        <div class="space-y-4">
          {#each selectedIdentity.devices as device (device.id)}
            {@const DevIcon = getDeviceIcon(device.deviceType)}
            <div class="border border-[#1a1815]/30 bg-[#f6f3ec] p-4 rounded-md">
              <div class="flex flex-wrap items-center justify-between gap-3 border-b border-[#1a1815]/20 pb-3">
                <div class="flex items-center gap-3">
                  <div class="rounded border border-[#1a1815]/40 bg-[#fffdf7] p-2 text-[#1a1815]">
                    <DevIcon class="size-4" />
                  </div>
                  <div>
                    <div class="font-mono text-sm font-semibold text-[#1a1815]">{device.name}</div>
                    <div class="font-mono text-xs text-[#1a1815]/60">{device.os}</div>
                  </div>
                </div>

                <span class="font-mono text-xs font-bold text-[#1f5c44]">
                  Trust Score: {device.trustScore}%
                </span>
              </div>

              <div class="mt-3 grid gap-3 sm:grid-cols-2">
                {#each device.keys as key (key.id)}
                  <div class="border border-[#1a1815]/20 bg-[#fffdf7] p-3 font-mono text-xs rounded-sm">
                    <div class="flex items-center justify-between font-bold text-[#1a1815] mb-1">
                      <span>{key.name}</span>
                      <span class="text-[10px] text-[#1d5084]">{key.keyType}</span>
                    </div>
                    <div class="text-[11px] text-[#1a1815]/60 truncate mb-1">
                      {key.fingerprint}
                    </div>
                  </div>
                {/each}
              </div>
            </div>
          {/each}
        </div>
      </div>
    </section>

    <!-- PART 2: VAULT RELATIONSHIPS -->
    <section class="border-2 border-[#1a1815] bg-[#fffdf7] p-6 sm:p-8 space-y-6">
      <div class="flex flex-wrap items-center justify-between gap-4 border-b border-[#1a1815]/20 pb-4">
        <div>
          <p class="{CAPS} text-[#1d5084] font-semibold">
            Part 2 · Visually Separate Vault Entitlement Ribbon
          </p>
          <h2 class="mt-1 font-serif text-3xl font-normal tracking-tight text-[#1a1815]">
            Vault & Identity Entitlement Ribbon
          </h2>
          <p class="mt-1 text-xs text-[#1a1815]/60 font-sans">
            Maps Vaults directly to authorized Identities (not keys!). Displays threshold quorum rules ($K$-of-$N$).
          </p>
        </div>
        <div class="font-mono text-xs text-[#1a1815]/60 border border-[#1a1815]/30 bg-[#f6f3ec] px-3 py-1.5 rounded">
          Vaults $\leftrightarrow$ Identities
        </div>
      </div>

      <div class="space-y-4">
        {#each MOCK_VAULTS as vault (vault.id)}
          {@const isSelected = vault.id === selectedVaultId}
          {@const relatesToActive = vault.associatedIdentityIds.includes(selectedIdentityId)}
          <div
            class={`border-2 p-5 transition ${
              isSelected
                ? 'border-[#1a1815] bg-[#1a1815] text-[#f6f3ec]'
                : relatesToActive
                  ? 'border-[#1a1815] bg-[#f6f3ec]'
                  : 'border-[#1a1815]/30 bg-[#fffdf7] opacity-70'
            }`}
          >
            <div class="flex flex-wrap items-center justify-between gap-4 border-b border-current/20 pb-3 mb-3">
              <button
                type="button"
                onclick={() => (selectedVaultId = vault.id)}
                class="font-serif text-xl font-bold hover:underline text-left"
              >
                {vault.name}
              </button>
              <span class="font-mono text-xs font-bold border border-current px-3 py-0.5 rounded">
                POLICY: {vault.thresholdK}-OF-{vault.totalN} QUORUM
              </span>
            </div>

            <div class="{CAPS} opacity-70 mb-2">
              Authorized Identity Participants ({vault.associatedIdentityIds.length})
            </div>

            <div class="flex flex-wrap items-center gap-3">
              {#each vault.associatedIdentityIds as identityId (identityId)}
                {@const idObj = MOCK_IDENTITIES.find((i) => i.id === identityId)}
                {@const role = vault.identityRoles[identityId]}
                {#if idObj}
                  <div
                    class={`border px-3 py-1 font-mono text-xs flex items-center gap-2 rounded ${
                      identityId === selectedIdentityId
                        ? 'border-[#f6f3ec] bg-[#f6f3ec] text-[#1a1815] font-bold'
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
