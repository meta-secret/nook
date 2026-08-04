<!--
SKETCH: IDENTITY MESH PIPELINE
Directly models Pic2's exact 3-box vertical flow:
Top Row: 3 Source Identity Cards with device counts & hardware key slot drawer.
Middle Flow Container: Central Identity Entitlement Router with merging connector conduits.
Bottom Panel: Visually separate Vault Entitlement Console window with identity quorum roles.
-->
<script lang="ts">
  import {
    Activity,
    ArrowDown,
    CheckCircle2,
    Cpu,
    Fingerprint,
    HardDrive,
    KeyRound,
    Laptop,
    Lock,
    Network,
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
</script>

<main class="min-h-screen bg-[#f6f3ec] text-[#1a1815] font-serif">
  <ExperimentBack {navigate} light />

  <div class="mx-auto max-w-5xl px-6 py-16 sm:px-8 space-y-8">
    <!-- Header -->
    <header class="border-b-2 border-[#1a1815] pb-6">
      <div class="flex items-center gap-2 text-[#1d5084] font-mono text-xs tracking-widest uppercase mb-2">
        <Network class="size-4" />
        Pic2 Structural Component Grouping · Sketch 02
      </div>
      <h1 class="text-4xl font-normal tracking-tight text-[#1a1815] sm:text-6xl">
        Identity Mesh Pipeline
      </h1>
      <p class="mt-3 text-sm font-sans text-[#1a1815]/70 max-w-2xl leading-relaxed">
        Refinement of Pic2's structural flow: 3 Source Identity cards feeding a central Entitlement Router, which connects directly to a full-width Vault Console below.
      </p>
    </header>

    <!-- TIER 1: TOP 3 SOURCE IDENTITY CARDS (PIC 2 TOP ROW) -->
    <section class="space-y-4">
      <div class="flex items-center justify-between border-b border-[#1a1815]/20 pb-2 font-mono text-xs text-[#1a1815]/60">
        <span class="{CAPS} text-[#1f5c44]">Tier 1 · Source Identities & Contained Devices</span>
        <span>Click an identity to expand key slots</span>
      </div>

      <div class="grid gap-4 sm:grid-cols-3">
        {#each MOCK_IDENTITIES as identity (identity.id)}
          {@const isSelected = identity.id === selectedIdentityId}
          <button
            type="button"
            onclick={() => (selectedIdentityId = identity.id)}
            class={`rounded-2xl border-2 p-5 text-left transition flex flex-col justify-between ${
              isSelected
                ? 'border-[#1a1815] bg-[#1a1815] text-[#f6f3ec] shadow-lg'
                : 'border-[#1a1815]/30 bg-[#fffdf7] text-[#1a1815] hover:border-[#1a1815]'
            }`}
          >
            <div>
              <div class="flex items-center justify-between mb-3">
                <div class="flex items-center gap-2 font-mono text-xs font-bold">
                  <span class="inline-block size-2 rounded-full bg-[#1f5c44]"></span>
                  <span>{identity.name}</span>
                </div>
                <span class={`rounded-full px-2.5 py-0.5 font-mono text-[10px] border ${
                  isSelected ? 'border-[#f6f3ec]/30 bg-[#f6f3ec]/10' : 'border-[#1a1815]/20 bg-[#f6f3ec]'
                }`}>
                  {identity.status}
                </span>
              </div>
              <p class="font-mono text-xs opacity-70 mb-4">{identity.handle}</p>
            </div>

            <div class="border-t border-current/20 pt-3 font-mono text-xs flex justify-between">
              <span>{identity.devices.length} Devices</span>
              <span class="font-bold">{identity.chainStrengthScore}% Strength</span>
            </div>
          </button>
        {/each}
      </div>

      <!-- Device Breakdown Drawer for Selected Identity -->
      <div class="rounded-xl border-2 border-[#1a1815] bg-[#fffdf7] p-5 space-y-4">
        <div class="flex items-center justify-between border-b border-[#1a1815]/20 pb-3">
          <div class="font-serif text-lg font-bold">
            Hardware Devices & Key Material for {selectedIdentity.name}
          </div>
          <span class="font-mono text-xs text-[#1f5c44] font-bold">
            {selectedIdentity.devices.length} Enrolled Devices
          </span>
        </div>

        <div class="grid gap-3 sm:grid-cols-2">
          {#each selectedIdentity.devices as device (device.id)}
            {@const DevIcon = getDeviceIcon(device.deviceType)}
            <div class="rounded-lg border border-[#1a1815]/30 bg-[#f6f3ec] p-3 font-mono text-xs">
              <div class="flex items-center justify-between border-b border-[#1a1815]/20 pb-2 mb-2">
                <div class="flex items-center gap-2">
                  <DevIcon class="size-4 text-[#1a1815]" />
                  <span class="font-bold text-[#1a1815]">{device.name}</span>
                </div>
                <span class="text-[10px] text-[#1f5c44] font-bold">{device.trustScore}% Trust</span>
              </div>
              <div class="space-y-1 text-[11px]">
                {#each device.keys as key (key.id)}
                  <div class="flex justify-between text-[#1a1815]/70">
                    <span>{key.name}</span>
                    <span class="text-[#1d5084] text-[10px]">{key.keyType}</span>
                  </div>
                {/each}
              </div>
            </div>
          {/each}
        </div>
      </div>
    </section>

    <!-- TIER 2: MIDDLE MERGING CONDUITS & ROUTER (PIC 2 MIDDLE HERO CONTAINER) -->
    <div class="relative py-2 flex flex-col items-center">
      <!-- Merging Curved Cables -->
      <div class="h-10 w-full max-w-lg overflow-hidden relative">
        <svg class="h-full w-full stroke-[#1d5084]" fill="none" stroke-width="2">
          <path d="M 60 0 Q 60 20 256 40" />
          <path d="M 256 0 L 256 40" />
          <path d="M 452 0 Q 452 20 256 40" />
        </svg>
      </div>

      <!-- Central Hero Identity Router Box -->
      <div class="w-full rounded-2xl border-2 border-[#1d5084] bg-[#fffdf7] p-6 text-center space-y-3 shadow-lg">
        <div class="inline-flex items-center gap-2 rounded-full border border-[#1d5084]/40 bg-[#1d5084]/10 px-3.5 py-1 font-mono text-xs font-semibold text-[#1d5084]">
          <Network class="size-4" />
          Central Identity Entitlement Router
        </div>
        <h3 class="font-serif text-3xl font-normal text-[#1a1815]">
          Multi-Party Quorum Aggregator
        </h3>

        <div class="flex flex-wrap items-center justify-center gap-2 pt-2">
          <span class="rounded-full border border-[#1a1815]/30 bg-[#f6f3ec] px-3 py-1 font-mono text-[10px] text-[#1a1815]">
            ✓ Identity Signatures
          </span>
          <span class="rounded-full border border-[#1a1815]/30 bg-[#f6f3ec] px-3 py-1 font-mono text-[10px] text-[#1a1815]">
            ✓ Threshold Agreements
          </span>
          <span class="rounded-full border border-[#1a1815]/30 bg-[#f6f3ec] px-3 py-1 font-mono text-[10px] text-[#1a1815]">
            ✓ Zero Key Clutter
          </span>
        </div>
      </div>

      <!-- Output Conduit to Tier 3 -->
      <div class="h-8 w-0.5 bg-[#1d5084]"></div>
    </div>

    <!-- TIER 3: BOTTOM OPERATIONAL SURFACE (PIC 2 FULL WINDOW CONSOLE) -->
    <section class="rounded-2xl border-2 border-[#1a1815] bg-[#fffdf7] p-6 sm:p-8 space-y-6 shadow-xl">
      <div class="flex flex-wrap items-center justify-between gap-4 border-b-2 border-[#1a1815] pb-4">
        <div>
          <p class="{CAPS} text-[#1d5084] font-semibold">
            Tier 3 · Visually Separate Vault Entitlement Console
          </p>
          <h2 class="mt-1 font-serif text-3xl font-normal tracking-tight text-[#1a1815]">
            Vault Entitlements & Identity Quorums
          </h2>
        </div>
        <div class="font-mono text-xs text-[#1d5084] border border-[#1d5084]/30 bg-[#1d5084]/10 px-3 py-1.5 rounded-full">
          Identities $\leftrightarrow$ Vaults
        </div>
      </div>

      <div class="space-y-4">
        {#each MOCK_VAULTS as vault (vault.id)}
          {@const isVaultSelected = vault.id === selectedVaultId}
          {@const relatesToActive = vault.associatedIdentityIds.includes(selectedIdentityId)}
          <div
            class={`rounded-xl border-2 p-5 transition ${
              isVaultSelected
                ? 'border-[#1a1815] bg-[#1a1815] text-[#f6f3ec] shadow-md'
                : relatesToActive
                  ? 'border-[#1d5084] bg-[#f6f3ec]'
                  : 'border-[#1a1815]/30 bg-[#fffdf7] opacity-75'
            }`}
          >
            <div class="flex flex-wrap items-center justify-between gap-4 border-b border-current/20 pb-3 mb-3">
              <button
                type="button"
                onclick={() => (selectedVaultId = vault.id)}
                class="font-serif text-2xl font-bold hover:underline text-left"
              >
                {vault.name}
              </button>

              <span class="font-mono text-xs font-bold border border-current px-3 py-1 rounded-md">
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
                    class={`border px-3 py-1 font-mono text-xs flex items-center gap-2 rounded-full transition ${
                      identityId === selectedIdentityId
                        ? 'border-[#f6f3ec] bg-[#f6f3ec] text-[#1a1815] font-bold'
                        : 'border-current/40 bg-transparent'
                    }`}
                  >
                    <span>{idObj.name}</span>
                    <span class="opacity-70 text-[10px]">[{role}]</span>
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
