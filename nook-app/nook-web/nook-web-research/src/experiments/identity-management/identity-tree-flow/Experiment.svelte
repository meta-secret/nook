<!--
SKETCH: IDENTITY TREE FLOW
Directly implements Pic1 & Pic2 structure:
Top Row: Root identity owner branching to Identity cards with nested devices & key slots.
Middle Engine: Central Sentinel Quorum Controller with merging connector conduits.
Bottom Panel: Visually separate Vault Entitlement Ledger with identity roles and K-of-N threshold policies.
-->
<script lang="ts">
  import {
    ArrowDown,
    CheckCircle2,
    ChevronDown,
    Cpu,
    Fingerprint,
    GitFork,
    HardDrive,
    KeyRound,
    Laptop,
    Lock,
    Plus,
    ShieldCheck,
    Smartphone,
    User,
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
  let expandedIdentityId = $state<string>('id-main')

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

  <div class="mx-auto max-w-5xl px-6 py-16 sm:px-8 space-y-10">
    <!-- Header -->
    <header class="border-b-2 border-[#1a1815] pb-6">
      <div class="flex items-center gap-2 text-[#1f5c44] font-mono text-xs tracking-widest uppercase mb-2">
        <GitFork class="size-4" />
        Pic2 Structural Component Grouping · Sketch 01
      </div>
      <h1 class="text-4xl font-normal tracking-tight text-[#1a1815] sm:text-6xl">
        Identity Tree Flow
      </h1>
      <p class="mt-3 text-sm font-sans text-[#1a1815]/70 max-w-2xl leading-relaxed">
        Integrates the root identity tree (Pic1) into Pic2's 3-tier component grouping flow: Top Identities $\rightarrow$ Middle Quorum Engine $\rightarrow$ Bottom Vault Surface.
      </p>
    </header>

    <!-- TIER 1: TOP IDENTITIES OVERVIEW TREE (PIC 1 & PIC 2 TOP ROW) -->
    <section class="border-2 border-[#1a1815] bg-[#fffdf7] p-6 sm:p-8 space-y-6">
      <div class="flex items-center justify-between border-b border-[#1a1815]/20 pb-4">
        <div>
          <p class="{CAPS} text-[#1f5c44] font-semibold">
            Tier 1 · Root Identities & Device Nodes
          </p>
          <h2 class="mt-1 font-serif text-3xl font-normal tracking-tight text-[#1a1815]">
            Identities Overview
          </h2>
        </div>
        <span class="font-mono text-xs text-[#1a1815]/60 border border-[#1a1815]/20 bg-[#f6f3ec] px-3 py-1.5 rounded">
          Source Identities
        </span>
      </div>

      <!-- Root Identity Owner Box -->
      <div class="flex justify-center">
        <div class="rounded-xl border-2 border-[#1a1815] bg-[#f6f3ec] px-6 py-2.5 flex items-center gap-3 shadow-sm">
          <div class="grid size-8 place-items-center rounded-full bg-[#1a1815] text-[#f6f3ec]">
            <User class="size-4" />
          </div>
          <div>
            <div class="font-serif font-bold text-base text-[#1a1815]">Alex Vance (You)</div>
            <div class="font-mono text-[10px] text-[#1a1815]/60">Root Identity Vault Owner</div>
          </div>
        </div>
      </div>

      <!-- Connecting SVG Tree Conduits -->
      <div class="relative h-8 w-full max-w-2xl mx-auto overflow-hidden">
        <svg class="absolute inset-0 h-full w-full stroke-[#1a1815]/40" fill="none" stroke-width="2">
          <!-- Top vertical stem -->
          <line x1="50%" y1="0" x2="50%" y2="12" />
          <!-- Horizontal bar -->
          <line x1="16.6%" y1="12" x2="83.3%" y2="12" />
          <!-- Downward branches to 3 cards -->
          <line x1="16.6%" y1="12" x2="16.6%" y2="32" />
          <line x1="50%" y1="12" x2="50%" y2="32" />
          <line x1="83.3%" y1="12" x2="83.3%" y2="32" />
        </svg>
      </div>

      <!-- Identity Cards Row -->
      <div class="grid gap-4 sm:grid-cols-3">
        {#each MOCK_IDENTITIES as identity (identity.id)}
          {@const isSelected = identity.id === selectedIdentityId}
          <button
            type="button"
            onclick={() => (selectedIdentityId = identity.id)}
            class={`rounded-xl border-2 p-5 text-left transition flex flex-col justify-between ${
              isSelected
                ? 'border-[#1a1815] bg-[#1a1815] text-[#f6f3ec] shadow-md'
                : 'border-[#1a1815]/30 bg-[#fffdf7] text-[#1a1815] hover:border-[#1a1815]'
            }`}
          >
            <div>
              <div class="flex items-center justify-between mb-2">
                <span class={`font-mono text-[10px] px-2 py-0.5 rounded border ${
                  isSelected ? 'border-[#f6f3ec]/40 bg-[#f6f3ec]/10 text-[#f6f3ec]' : 'border-[#1a1815]/20 bg-[#f6f3ec] text-[#1a1815]/70'
                }`}>
                  {identity.status.toUpperCase()}
                </span>
                <span class="font-mono text-[10px] opacity-70">
                  {identity.devices.length} Devices
                </span>
              </div>
              <div class="font-serif font-bold text-lg mb-1">{identity.name}</div>
              <div class="font-mono text-xs opacity-70 truncate mb-4">{identity.handle}</div>
            </div>

            <!-- Mini Device Icons Stack (Pic1 style) -->
            <div class="border-t border-current/20 pt-3">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-1.5">
                  {#each identity.devices as device (device.id)}
                    {@const DevIcon = getDeviceIcon(device.deviceType)}
                    <div class={`grid size-7 place-items-center rounded border ${
                      isSelected ? 'border-[#f6f3ec]/40 bg-[#f6f3ec]/10' : 'border-[#1a1815]/30 bg-[#f6f3ec]'
                    }`}>
                      <DevIcon class="size-3.5" />
                    </div>
                  {/each}
                </div>
                <span class="font-mono text-[10px] font-bold">
                  {identity.chainStrengthScore}%
                </span>
              </div>
            </div>
          </button>
        {/each}
      </div>

      <!-- Device Key Drawer for Selected Identity -->
      <div class="border-t-2 border-[#1a1815]/20 pt-6">
        <div class="flex items-center justify-between mb-3">
          <div class="font-serif text-xl text-[#1a1815]">
            Device Key Slot Inventory for <span class="underline underline-offset-4 font-bold">{selectedIdentity.name}</span>
          </div>
          <span class="font-mono text-xs text-[#1f5c44] font-semibold">
            {selectedIdentity.devices.length} Hardware Devices Enrolled
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
              <div class="space-y-1.5 text-[11px]">
                {#each device.keys as key (key.id)}
                  <div class="flex justify-between text-[#1a1815]/70 border-b border-[#1a1815]/10 pb-1">
                    <span>{key.name}</span>
                    <span class="text-[#1d5084] text-[10px] font-semibold">{key.keyType}</span>
                  </div>
                {/each}
              </div>
            </div>
          {/each}
        </div>
      </div>
    </section>

    <!-- TIER 2: MIDDLE FLOW ENGINE (PIC 2 CENTRAL AGGREGATOR HERO) -->
    <div class="relative py-2 flex flex-col items-center">
      <!-- Downward Conduit Lines -->
      <div class="h-10 w-full max-w-md overflow-hidden relative">
        <svg class="h-full w-full stroke-[#1f5c44]" fill="none" stroke-width="2">
          <path d="M 50 0 Q 50 20 200 40" />
          <path d="M 200 0 L 200 40" />
          <path d="M 350 0 Q 350 20 200 40" />
        </svg>
      </div>

      <!-- Central Hero Quorum Controller Box -->
      <div class="w-full rounded-2xl border-2 border-[#1f5c44] bg-[#fffdf7] p-6 text-center space-y-3 shadow-lg">
        <div class="inline-flex items-center gap-2 rounded-full border border-[#1f5c44]/40 bg-[#1f5c44]/10 px-3 py-1 font-mono text-xs font-semibold text-[#1f5c44]">
          <ShieldCheck class="size-4" />
          Sentinel Access Quorum Engine
        </div>
        <h3 class="font-serif text-3xl font-normal text-[#1a1815]">
          Multi-Party Threshold Entitlement Controller
        </h3>
        <p class="text-xs text-[#1a1815]/70 max-w-xl mx-auto font-sans">
          Merges verified identity signatures from Tier 1 into active threshold quorums ($K$-of-$N$) for Tier 3 Vaults.
        </p>

        <!-- Feature Pills (Pic2 style) -->
        <div class="flex flex-wrap items-center justify-center gap-2 pt-2">
          <span class="rounded-full border border-[#1a1815]/30 bg-[#f6f3ec] px-3 py-1 font-mono text-[10px] text-[#1a1815]">
            ✓ $K$-of-$N$ Shamir Agreement
          </span>
          <span class="rounded-full border border-[#1a1815]/30 bg-[#f6f3ec] px-3 py-1 font-mono text-[10px] text-[#1a1815]">
            ✓ Zero Key Clutter in Vaults
          </span>
          <span class="rounded-full border border-[#1a1815]/30 bg-[#f6f3ec] px-3 py-1 font-mono text-[10px] text-[#1a1815]">
            ✓ Identity Role Binding
          </span>
        </div>
      </div>

      <!-- Output Connector to Tier 3 -->
      <div class="h-8 w-0.5 bg-[#1f5c44]"></div>
    </div>

    <!-- TIER 3: BOTTOM OPERATIONAL SURFACE (PIC 2 FULL WINDOW VAULT LEDGER) -->
    <section class="rounded-2xl border-2 border-[#1a1815] bg-[#fffdf7] p-6 sm:p-8 space-y-6 shadow-xl">
      <div class="flex flex-wrap items-center justify-between gap-4 border-b-2 border-[#1a1815] pb-4">
        <div>
          <p class="{CAPS} text-[#1d5084] font-semibold">
            Tier 3 · Visually Separate Vault Entitlement Ledger
          </p>
          <h2 class="mt-1 font-serif text-3xl font-normal tracking-tight text-[#1a1815]">
            Authorized Vaults & Identity Participants
          </h2>
        </div>
        <div class="font-mono text-xs text-[#1d5084] border border-[#1d5084]/30 bg-[#1d5084]/10 px-3 py-1.5 rounded-full">
          Identities $\leftrightarrow$ Vaults Only
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
                  ? 'border-[#1f5c44] bg-[#f6f3ec]'
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

            <p class="text-xs opacity-80 mb-4 font-sans max-w-2xl leading-relaxed">{vault.description}</p>

            <div class="{CAPS} opacity-70 mb-2">
              Authorized Identity Participants ({vault.associatedIdentityIds.length})
            </div>

            <div class="flex flex-wrap items-center gap-3">
              {#each vault.associatedIdentityIds as identityId (identityId)}
                {@const idObj = MOCK_IDENTITIES.find((i) => i.id === identityId)}
                {@const role = vault.identityRoles[identityId]}
                {#if idObj}
                  <div
                    class={`border px-3 py-1.5 font-mono text-xs flex items-center gap-2 rounded-full transition ${
                      identityId === selectedIdentityId
                        ? 'border-[#f6f3ec] bg-[#f6f3ec] text-[#1a1815] font-bold'
                        : 'border-current/40 bg-transparent'
                    }`}
                  >
                    <span class={`grid size-5 place-items-center rounded-full text-[10px] font-bold ${
                      identityId === selectedIdentityId ? 'bg-[#1a1815] text-[#f6f3ec]' : 'bg-current/20 text-current'
                    }`}>
                      {idObj.name.slice(0, 1)}
                    </span>
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
