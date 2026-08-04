<!--
SKETCH: IDENTITY QUORUM FLOW
Directly models Pic2's exact 3-box vertical flow in an editorial paper style:
Top Row: 3 Source Identity Cards with device counts & hardware key slot drawer.
Middle Flow Container: Central Multi-Party Threshold Engine with merging SVG cables.
Bottom Surface: Full-width Vault Ledger window detailing authorized identity quorums and vault permissions.
-->
<script lang="ts">
  import {
    Activity,
    ArrowDown,
    Check,
    Cpu,
    Feather,
    Fingerprint,
    HardDrive,
    KeyRound,
    Laptop,
    Lock,
    Shield,
    ShieldCheck,
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

  const CAPS = 'font-mono text-[10px] tracking-[0.22em] uppercase'

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

  <div class="mx-auto max-w-5xl px-6 py-16 sm:px-8 space-y-8">
    <!-- Header -->
    <header class="border-y-2 border-[#1a1815] py-6">
      <p class="font-mono text-xs tracking-[0.2em] uppercase text-[#1a1815]/60">
        Pic2 Structural Component Grouping · Sketch 03
      </p>
      <h1 class="mt-2 text-4xl tracking-tight sm:text-6xl font-normal">
        Identity Quorum Flow
      </h1>
      <p class="mt-3 max-w-2xl font-serif text-base italic text-[#1a1815]/70">
        Editorial paper rendition of Pic2: Top Source Identities feed a central Multi-Party Threshold Engine, which outputs directly to a full-width Vault Ledger below.
      </p>
    </header>

    <!-- TIER 1: TOP 3 SOURCE IDENTITY CARDS (PIC 2 TOP ROW) -->
    <section class="border-2 border-[#1a1815] bg-[#fffdf7] p-6 sm:p-8 space-y-6">
      <div class="flex items-center justify-between border-b-2 border-[#1a1815] pb-4">
        <div>
          <p class="{CAPS} text-[#1f5c44] font-semibold">
            Tier 1 · Source Identities & Contained Devices
          </p>
          <h2 class="text-3xl tracking-tight mt-1 font-normal">
            Source Identity Register
          </h2>
        </div>
        <Feather class="size-6 text-[#1a1815]" />
      </div>

      <div class="grid gap-4 sm:grid-cols-3">
        {#each MOCK_IDENTITIES as identity (identity.id)}
          {@const isSelected = identity.id === selectedId}
          <button
            type="button"
            onclick={() => (selectedId = identity.id)}
            class={`border-2 p-5 text-left transition ${
              isSelected
                ? 'border-[#1a1815] bg-[#1a1815] text-[#f6f3ec]'
                : 'border-[#1a1815]/40 bg-[#f6f3ec] hover:border-[#1a1815]'
            }`}
          >
            <div class="font-mono text-xs uppercase tracking-wider mb-1 opacity-80">
              {identity.handle}
            </div>
            <div class="font-serif text-xl font-bold">{identity.name}</div>
            <div class="mt-3 border-t border-current/20 pt-2 font-mono text-[10px] flex justify-between">
              <span>{identity.devices.length} Devices</span>
              <span>Strength: {identity.chainStrengthScore}%</span>
            </div>
          </button>
        {/each}
      </div>

      <!-- Device Breakdown for Selected Identity -->
      <div class="border-t-2 border-[#1a1815] pt-6">
        <div class="flex items-center justify-between mb-3 font-serif text-xl">
          <span>Devices & Key Slots for <b class="underline underline-offset-4">{currentIdentity.name}</b></span>
          <span class="font-mono text-xs font-bold text-[#1f5c44]">
            {currentIdentity.devices.length} Enrolled Devices
          </span>
        </div>

        <div class="grid gap-3 sm:grid-cols-2">
          {#each currentIdentity.devices as device (device.id)}
            {@const DevIcon = getDeviceIcon(device.deviceType)}
            <div class="border-2 border-[#1a1815] bg-[#f6f3ec] p-3 font-mono text-xs">
              <div class="flex items-center justify-between border-b border-[#1a1815]/30 pb-2 mb-2">
                <div class="flex items-center gap-2">
                  <DevIcon class="size-4 text-[#1a1815]" />
                  <span class="font-bold">{device.name}</span>
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

    <!-- TIER 2: MIDDLE FLOW ENGINE (PIC 2 CENTRAL HERO CONTAINER) -->
    <div class="relative py-2 flex flex-col items-center">
      <div class="h-10 w-full max-w-lg overflow-hidden relative">
        <svg class="h-full w-full stroke-[#6c4897]" fill="none" stroke-width="2">
          <path d="M 60 0 Q 60 20 256 40" />
          <path d="M 256 0 L 256 40" />
          <path d="M 452 0 Q 452 20 256 40" />
        </svg>
      </div>

      <div class="w-full border-2 border-[#6c4897] bg-[#fffdf7] p-6 text-center space-y-3 shadow-lg">
        <div class="inline-flex items-center gap-2 border border-[#6c4897] bg-[#6c4897]/10 px-3.5 py-1 font-mono text-xs font-semibold text-[#6c4897]">
          <Stamp class="size-4" />
          Multi-Party Threshold Engine
        </div>
        <h3 class="font-serif text-3xl font-normal text-[#1a1815]">
          Identity Quorum Aggregator
        </h3>

        <div class="flex flex-wrap items-center justify-center gap-2 pt-2">
          <span class="border border-[#1a1815]/30 bg-[#f6f3ec] px-3 py-1 font-mono text-[10px]">
            ✓ $K$-of-$N$ Threshold Agreements
          </span>
          <span class="border border-[#1a1815]/30 bg-[#f6f3ec] px-3 py-1 font-mono text-[10px]">
            ✓ Identity Roles Only
          </span>
        </div>
      </div>

      <div class="h-8 w-0.5 bg-[#6c4897]"></div>
    </div>

    <!-- TIER 3: BOTTOM OPERATIONAL SURFACE (PIC 2 FULL WINDOW LEDGER) -->
    <section class="border-2 border-[#1a1815] bg-[#fffdf7] p-6 sm:p-8 space-y-6 shadow-xl">
      <div class="flex flex-wrap items-center justify-between gap-4 border-b-2 border-[#1a1815] pb-4">
        <div>
          <p class="{CAPS} text-[#6c4897] font-semibold">
            Tier 3 · Visually Separate Vault Ledger
          </p>
          <h2 class="text-3xl tracking-tight mt-1 font-normal">
            Authorized Vaults & Identity Participants
          </h2>
        </div>
        <Stamp class="size-6 text-[#1a1815]" />
      </div>

      <div class="space-y-4">
        {#each MOCK_VAULTS as vault (vault.id)}
          {@const isSelected = vault.id === selectedVaultId}
          {@const relatesToActive = vault.associatedIdentityIds.includes(selectedId)}
          <div
            class={`border-2 p-5 transition ${
              isSelected
                ? 'border-[#1a1815] bg-[#1a1815] text-[#f6f3ec]'
                : relatesToActive
                  ? 'border-[#1a1815] bg-[#f6f3ec]'
                  : 'border-[#1a1815]/40 bg-[#fffdf7] opacity-70'
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

              <span class="font-mono text-xs font-bold border border-current px-3 py-1">
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
        {/each}
      </div>
    </section>
  </div>
</main>
