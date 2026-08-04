<!--
DIRECTION: Iteration on chain-strength blueprint for Identity Management.
Top Section (Part 1): My Identities list. Clicking an identity expands its attached devices and device key material (X25519, Passkey PRF seed, Ed25519, PIV slot). Completely independent.
Bottom Section (Part 2): Visually separate Vault & Identity Relationships panel. Vaults lead each row, connected via SVG braces to Identities (not keys) with threshold quorum policies and identity roles.
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
  const ACTION =
    'rounded-full border border-[#1a1815]/30 px-2.5 py-1 font-mono text-[10px] tracking-[0.14em] uppercase transition hover:border-[#1a1815] motion-reduce:transition-none'

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

<main class="min-h-[100svh] bg-[#f6f3ec] text-[#1a1815]">
  <ExperimentBack {navigate} light />

  <div class="mx-auto max-w-5xl px-5 pt-24 pb-20 sm:px-8">
    <!-- Header -->
    <header class="mb-10 border-b-2 border-[#1a1815] pb-6">
      <div class="flex items-center gap-2 text-[#1f5c44] font-mono text-xs tracking-widest uppercase mb-2">
        <ShieldCheck class="size-4" />
        Identity Management · Concept 01
      </div>
      <h1 class="font-serif text-5xl tracking-tight text-[#1a1815] sm:text-6xl">
        Identity Chain Strength
      </h1>
      <p class="mt-3 text-sm text-[#1a1815]/70 max-w-3xl leading-relaxed">
        Adapted from the chain-strength blueprint. Part 1 lists independent identities with their device key material. Part 2 visually separates vault-identity quorum relationships.
      </p>
    </header>

    <div class="space-y-12">
      <!-- PART 1: MY IDENTITIES (INDEPENDENT PANEL) -->
      <section class="border-2 border-[#1a1815] bg-[#fffdf7] p-6 sm:p-8">
        <div class="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-[#1a1815]/20 pb-4">
          <div>
            <p class="{CAPS} text-[#1f5c44] font-semibold">
              Part 1 · Independent Registry
            </p>
            <h2 class="mt-1 font-serif text-3xl font-normal tracking-tight text-[#1a1815]">
              My Identities
            </h2>
          </div>
          <div class="font-mono text-xs text-[#1a1815]/60">
            Click an identity to inspect contained devices & key material
          </div>
        </div>

        <!-- Identity Cards Grid -->
        <div class="grid gap-4 sm:grid-cols-3 mb-6">
          {#each MOCK_IDENTITIES as identity (identity.id)}
            {@const isSelected = identity.id === selectedIdentityId}
            {@const isExpanded = identity.id === expandedIdentityId}
            <div
              class={`rounded-md border-2 bg-[#fffdf7] p-4 transition ${
                isSelected ? 'border-[#1a1815] shadow-sm' : 'border-[#1a1815]/30 hover:border-[#1a1815]/60'
              }`}
            >
              <button
                type="button"
                onclick={() => {
                  selectedIdentityId = identity.id
                  expandedIdentityId = isExpanded ? '' : identity.id
                }}
                class="w-full text-left"
              >
                <div class="flex items-center justify-between mb-2">
                  <div class="flex items-center gap-2">
                    <span class="grid size-7 place-items-center rounded-full border border-[#1a1815] bg-[#1a1815]/5 font-mono text-xs font-bold">
                      {identity.name.slice(0, 1)}
                    </span>
                    <span class="font-serif font-medium text-base text-[#1a1815]">{identity.name}</span>
                  </div>
                  <ChevronDown class={`size-4 text-[#1a1815]/60 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                </div>

                <div class="font-mono text-xs text-[#1a1815]/60 mb-2">
                  {identity.handle}
                </div>

                <div class="flex items-center justify-between border-t border-[#1a1815]/15 pt-2 font-mono text-[11px]">
                  <span class="text-[#1a1815]/70">{identity.devices.length} Devices</span>
                  <span class="text-[#1f5c44] font-semibold">Strength {identity.chainStrengthScore}%</span>
                </div>
              </button>
            </div>
          {/each}
        </div>

        <!-- Expanded Identity Devices & Keys Drawer -->
        {#if selectedIdentity}
          <div class="border-t-2 border-[#1a1815]/30 pt-6">
            <div class="flex items-center justify-between mb-4">
              <div>
                <h3 class="font-serif text-2xl font-normal text-[#1a1815]">
                  {selectedIdentity.name}
                  <span class="ml-2 font-mono text-xs text-[#1f5c44] border border-[#1f5c44]/40 bg-[#1f5c44]/10 rounded px-2 py-0.5">
                    {selectedIdentity.status}
                  </span>
                </h3>
                <p class="font-mono text-xs text-[#1a1815]/50 mt-1">
                  ID: {selectedIdentity.id} · Handle: {selectedIdentity.handle}
                </p>
              </div>
              <div class="font-mono text-xs text-right">
                <span class="text-[#1a1815]/50">Total Devices:</span>
                <span class="font-bold text-[#1a1815] ml-1">{selectedIdentity.devices.length}</span>
              </div>
            </div>

            <!-- Devices List -->
            <div class="space-y-4">
              <p class="{CAPS} text-[#1a1815]/50">
                Attached Devices & Key Slot Inventory
              </p>

              <div class="space-y-4">
                {#each selectedIdentity.devices as device (device.id)}
                  {@const DevIcon = getDeviceIcon(device.deviceType)}
                  <div class="border border-[#1a1815]/30 bg-[#f6f3ec] p-4 rounded-md">
                    <!-- Device Bar -->
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

                      <div class="font-mono text-xs flex items-center gap-4">
                        <span class="text-[#1a1815]/60">Trust: <b class="text-[#1f5c44]">{device.trustScore}%</b></span>
                        <span class="rounded bg-[#1a1815] text-[#f6f3ec] px-2 py-0.5 text-[10px] font-bold">
                          {device.keys.length} Keys Contained
                        </span>
                      </div>
                    </div>

                    <!-- Keys Breakdown -->
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
                          <div class="flex items-center justify-between text-[10px] text-[#1a1815]/50 border-t border-[#1a1815]/10 pt-1">
                            <span>{key.algorithm}</span>
                            {#if key.isHardwareBacked}
                              <span class="text-[#1f5c44] font-bold">HW BACKED</span>
                            {/if}
                          </div>
                        </div>
                      {/each}
                    </div>
                  </div>
                {/each}
              </div>
            </div>
          </div>
        {/if}
      </section>

      <!-- PART 2: VAULT & IDENTITY RELATIONSHIPS (VISUALLY SEPARATE) -->
      <section class="border-2 border-[#1a1815] bg-[#fffdf7] p-6 sm:p-8">
        <div class="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-[#1a1815]/20 pb-4">
          <div>
            <p class="{CAPS} text-[#1d5084] font-semibold">
              Part 2 · Visually Separate Vault Topology Panel
            </p>
            <h2 class="mt-1 font-serif text-3xl font-normal tracking-tight text-[#1a1815]">
              Vault & Identity Relationships
            </h2>
            <p class="mt-1 text-xs text-[#1a1815]/60">
              Vaults lead each row and connect directly to Identities (not keys). Monitors threshold quorum policies.
            </p>
          </div>
          <div class="font-mono text-xs text-[#1a1815]/60 border border-[#1a1815]/30 bg-[#f6f3ec] px-3 py-1.5 rounded">
            Vaults $\leftrightarrow$ Identities Only
          </div>
        </div>

        <!-- Vault Rows with Identity Connectors -->
        <ul class="space-y-4">
          {#each MOCK_VAULTS as vault (vault.id)}
            {@const isVaultSelected = vault.id === selectedVaultId}
            {@const isAssociatedWithIdentity = vault.associatedIdentityIds.includes(selectedIdentityId)}
            <li
              class={`border-2 transition ${
                isVaultSelected
                  ? 'border-[#1a1815] bg-[#fffdf7] shadow-md'
                  : isAssociatedWithIdentity
                    ? 'border-[#1f5c44]/50 bg-[#fffdf7]'
                    : 'border-[#1a1815]/30 bg-[#f6f3ec]/60'
              }`}
            >
              <div class="grid sm:grid-cols-[16rem_1fr] items-stretch">
                <!-- Vault Header Column -->
                <button
                  type="button"
                  onclick={() => (selectedVaultId = vault.id)}
                  class="p-4 text-left border-b border-[#1a1815]/20 sm:border-r sm:border-b-0 flex flex-col justify-between"
                >
                  <div>
                    <div class="flex items-center gap-2">
                      <VaultIcon class="size-4 text-[#1a1815]/70 shrink-0" />
                      <span class="font-serif font-bold text-base text-[#1a1815] truncate">{vault.name}</span>
                    </div>
                    <p class="mt-1.5 text-xs text-[#1a1815]/60 line-clamp-2">
                      {vault.description}
                    </p>
                  </div>

                  <div class="mt-4 pt-2 border-t border-[#1a1815]/15 flex items-center justify-between font-mono text-xs">
                    <span class="font-bold text-[#1f5c44]">
                      {vault.thresholdK}-of-{vault.totalN} Quorum
                    </span>
                    <span class="text-[#1a1815]/50">{vault.itemCount} items</span>
                  </div>
                </button>

                <!-- Identities Connected to Vault Column -->
                <div class="p-4 flex flex-col justify-center">
                  <div class="{CAPS} text-[#1a1815]/50 mb-3">
                    Authorized Identity Quorum ({vault.associatedIdentityIds.length} Identities)
                  </div>

                  <div class="flex flex-wrap items-center gap-3">
                    {#each vault.associatedIdentityIds as identityId (identityId)}
                      {@const idObj = MOCK_IDENTITIES.find((i) => i.id === identityId)}
                      {@const role = vault.identityRoles[identityId]}
                      {#if idObj}
                        <div
                          class={`flex items-center gap-2 rounded-full border px-3 py-1.5 transition ${
                            identityId === selectedIdentityId
                              ? 'border-[#1a1815] bg-[#1a1815] text-[#f6f3ec]'
                              : 'border-[#1a1815]/40 bg-[#fffdf7] text-[#1a1815]'
                          }`}
                        >
                          <span class={`grid size-5 place-items-center rounded-full font-mono text-[10px] font-bold ${
                            identityId === selectedIdentityId ? 'bg-[#f6f3ec] text-[#1a1815]' : 'bg-[#1a1815]/10 text-[#1a1815]'
                          }`}>
                            {idObj.name.slice(0, 1)}
                          </span>
                          <span class="font-mono text-xs font-semibold">{idObj.name}</span>
                          <span class={`rounded-full px-2 py-0.5 font-mono text-[9px] uppercase border ${
                            identityId === selectedIdentityId ? 'border-[#f6f3ec]/40 text-[#f6f3ec]' : getRoleBadge(role)
                          }`}>
                            {role}
                          </span>
                        </div>
                      {/if}
                    {/each}
                  </div>
                </div>
              </div>
            </li>
          {/each}
        </ul>
      </section>
    </div>
  </div>
</main>
