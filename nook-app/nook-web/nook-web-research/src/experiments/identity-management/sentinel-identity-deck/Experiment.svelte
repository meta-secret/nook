<script lang="ts">
  import {
    Activity,
    AlertTriangle,
    CheckCircle2,
    Cpu,
    Fingerprint,
    HardDrive,
    KeyRound,
    Lock,
    Radio,
    Shield,
    ShieldCheck,
    Smartphone,
    Terminal,
    UserCheck,
    Users,
    Vault,
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
  import type { IdentityItem, VaultItem } from '../_shared/identity-mock-data'

  let { navigate }: ExperimentProps = $props()

  let selectedIdIndex = $state<number>(0)
  let selectedVaultIndex = $state<number>(1) // Sentinel 2-of-3 default

  const currentIdentity = $derived(MOCK_IDENTITIES[selectedIdIndex] || MOCK_IDENTITIES[0])
  const currentVault = $derived(MOCK_VAULTS[selectedVaultIndex] || MOCK_VAULTS[0])

  function getDeviceIcon(type: DeviceType) {
    switch (type) {
      case DeviceType.Workstation:
        return Cpu
      case DeviceType.SecurityKey:
        return KeyRound
      case DeviceType.MobileEnclave:
        return Smartphone
      case DeviceType.HardwareSigner:
        return HardDrive
    }
  }

  function getRoleStyle(role: VaultRole): string {
    switch (role) {
      case VaultRole.Owner:
        return 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10'
      case VaultRole.FullSigner:
        return 'text-cyan-400 border-cyan-500/40 bg-cyan-500/10'
      case VaultRole.ThresholdParticipant:
        return 'text-blue-400 border-blue-500/40 bg-blue-500/10'
      case VaultRole.RecoveryGuardian:
        return 'text-amber-400 border-amber-500/40 bg-amber-500/10'
      case VaultRole.ReadOnlyObserver:
        return 'text-slate-400 border-slate-500/40 bg-slate-500/10'
    }
  }
</script>

<main class="min-h-screen bg-slate-950 text-slate-100 font-mono text-xs">
  <ExperimentBack {navigate} />

  <div class="mx-auto max-w-7xl px-4 py-12 sm:px-8">
    <!-- Header Command Deck Banner -->
    <header class="mb-10 border border-slate-800 bg-slate-900/90 p-6 rounded-2xl backdrop-blur-md">
      <div class="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <div class="flex items-center gap-2 text-emerald-400 font-bold uppercase tracking-widest text-[11px]">
            <Radio class="size-4 animate-pulse" />
            Sentinel Command Deck · Concept 03
          </div>
          <h1 class="text-3xl font-bold tracking-tight text-white sm:text-4xl mt-1 font-sans">
            Sentinel Identity Command Deck
          </h1>
        </div>

        <div class="flex items-center gap-3">
          <div class="rounded-lg bg-slate-950 px-3 py-2 border border-slate-800 text-slate-300">
            <span class="text-slate-500">OPERATIONAL MODE:</span> <span class="text-emerald-400 font-bold">SENTINEL_ACTIVE</span>
          </div>
        </div>
      </div>

      <p class="mt-3 text-slate-400 text-xs font-sans max-w-3xl leading-relaxed">
        Tactical security deck dividing device key slot hardware telemetry from Sentinel vault quorum authorization contracts.
      </p>
    </header>

    <div class="space-y-10">
      <!-- DECK SECTION 1: MY IDENTITIES & HARDWARE KEY SLOTS -->
      <section class="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
        <div class="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div>
            <div class="flex items-center gap-2 text-emerald-400 font-bold uppercase tracking-wider text-[11px]">
              <UserCheck class="size-4" />
              Deck Section 01 · Independent Identity Telemetry
            </div>
            <h2 class="text-xl font-bold text-white font-sans mt-1">
              My Identities & Key Slot Matrix
            </h2>
          </div>

          <div class="flex gap-2">
            {#each MOCK_IDENTITIES as identity, idx (identity.id)}
              <button
                type="button"
                onclick={() => (selectedIdIndex = idx)}
                class={`px-3 py-1.5 rounded-lg border text-xs transition-all ${
                  selectedIdIndex === idx
                    ? 'border-emerald-500 bg-emerald-950/40 text-emerald-300 font-bold'
                    : 'border-slate-800 bg-slate-950/60 text-slate-400 hover:text-slate-200'
                }`}
              >
                {identity.name.split(' ')[0]}
              </button>
            {/each}
          </div>
        </div>

        <!-- Selected Identity Hardware Key Deck -->
        <div class="grid gap-6 lg:grid-cols-[16rem_1fr]">
          <div class="rounded-xl border border-slate-800 bg-slate-950/80 p-4 space-y-4">
            <div>
              <div class="text-slate-500 text-[10px]">SELECTED IDENTITY</div>
              <div class="text-sm font-bold text-white font-sans mt-0.5">{currentIdentity.name}</div>
              <div class="text-emerald-400 text-xs mt-0.5">{currentIdentity.handle}</div>
            </div>

            <div class="border-t border-slate-800 pt-3 space-y-2">
              <div class="flex justify-between text-slate-400">
                <span>STATUS:</span>
                <span class="text-emerald-400 font-bold">{currentIdentity.status}</span>
              </div>
              <div class="flex justify-between text-slate-400">
                <span>STRENGTH:</span>
                <span class="text-emerald-400 font-bold">{currentIdentity.chainStrengthScore}%</span>
              </div>
              <div class="flex justify-between text-slate-400">
                <span>DEVICES:</span>
                <span class="text-slate-200">{currentIdentity.devices.length}</span>
              </div>
            </div>
          </div>

          <!-- Device Hardware Slots -->
          <div class="space-y-4">
            <div class="text-slate-400 text-xs font-semibold uppercase tracking-wider flex items-center gap-2">
              <Terminal class="size-3.5 text-emerald-400" />
              Attached Hardware Devices & Enrolled Key Slots
            </div>

            <div class="grid gap-4 sm:grid-cols-2">
              {#each currentIdentity.devices as device (device.id)}
                {@const DevIcon = getDeviceIcon(device.deviceType)}
                <div class="rounded-xl border border-slate-800 bg-slate-950/90 p-4">
                  <div class="flex items-center justify-between border-b border-slate-800/80 pb-3 mb-3">
                    <div class="flex items-center gap-2.5">
                      <div class="rounded bg-slate-800 p-1.5 text-emerald-400">
                        <DevIcon class="size-4" />
                      </div>
                      <div>
                        <div class="font-sans font-semibold text-white text-xs">{device.name}</div>
                        <div class="text-[10px] text-slate-400">{device.os}</div>
                      </div>
                    </div>
                    <span class="text-[10px] text-emerald-400 font-bold">{device.trustScore}% TRUST</span>
                  </div>

                  <div class="space-y-2">
                    {#each device.keys as key (key.id)}
                      <div class="rounded border border-slate-800/80 bg-slate-900/60 p-2.5 text-[11px]">
                        <div class="flex justify-between text-slate-200 font-semibold mb-1">
                          <span>{key.name}</span>
                          <span class="text-cyan-400">{key.keyType}</span>
                        </div>
                        <div class="text-[10px] text-slate-400 truncate">{key.fingerprint}</div>
                      </div>
                    {/each}
                  </div>
                </div>
              {/each}
            </div>
          </div>
        </div>
      </section>

      <!-- DECK SECTION 2: SENTINEL VAULT AUTHORIZATION POLICY DECK (VISUALLY SEPARATE) -->
      <section class="rounded-2xl border-2 border-emerald-500/40 bg-gradient-to-b from-slate-900 via-slate-950 to-slate-950 p-6 shadow-2xl shadow-emerald-950/50">
        <div class="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div>
            <div class="flex items-center gap-2 text-cyan-400 font-bold uppercase tracking-wider text-[11px]">
              <Vault class="size-4" />
              Deck Section 02 · Visually Separate Quorum Deck
            </div>
            <h2 class="text-xl font-bold text-white font-sans mt-1">
              Sentinel Vault Authorization Deck
            </h2>
            <p class="text-slate-400 text-xs font-sans mt-1">
              Displays relationships between Vaults and Identities (not keys). Monitors K-of-N threshold agreements.
            </p>
          </div>

          <div class="flex gap-2">
            {#each MOCK_VAULTS as vault, vIdx (vault.id)}
              <button
                type="button"
                onclick={() => (selectedVaultIndex = vIdx)}
                class={`px-3 py-1.5 rounded-lg border text-xs transition-all ${
                  selectedVaultIndex === vIdx
                    ? 'border-cyan-400 bg-cyan-950/40 text-cyan-300 font-bold'
                    : 'border-slate-800 bg-slate-950/60 text-slate-400 hover:text-slate-200'
                }`}
              >
                {vault.name.split(' ')[0]}
              </button>
            {/each}
          </div>
        </div>

        <!-- Selected Vault Policy Deck -->
        <div class="rounded-xl border border-slate-800 bg-slate-950/90 p-6">
          <div class="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
            <div>
              <h3 class="text-lg font-bold text-white font-sans">{currentVault.name}</h3>
              <p class="text-slate-400 text-xs font-sans mt-1">{currentVault.description}</p>
            </div>
            <div class="flex items-center gap-3">
              <span class="rounded bg-cyan-950 border border-cyan-500/30 px-3 py-1 text-cyan-300 font-bold">
                QUORUM: {currentVault.thresholdK}-OF-{currentVault.totalN} IDENTITIES
              </span>
            </div>
          </div>

          <!-- Identity Access Grid for Vault -->
          <div class="mt-6 space-y-4">
            <div class="text-slate-400 text-xs uppercase tracking-wider font-semibold">
              Authorized Identity Quorum Roster
            </div>

            <div class="grid gap-4 sm:grid-cols-3">
              {#each currentVault.associatedIdentityIds as identityId (identityId)}
                {@const idObj = MOCK_IDENTITIES.find((i) => i.id === identityId)}
                {@const role = currentVault.identityRoles[identityId]}
                {#if idObj}
                  <div class={`rounded-xl border p-4 flex flex-col justify-between ${
                    idObj.id === currentIdentity.id
                      ? 'border-emerald-500 bg-emerald-950/20'
                      : 'border-slate-800 bg-slate-900/40'
                  }`}>
                    <div>
                      <div class="flex items-center justify-between mb-2">
                        <div class={`size-7 rounded-full bg-gradient-to-br ${idObj.avatarColor} flex items-center justify-center font-bold text-[10px] text-white`}>
                          {idObj.name.slice(0, 2).toUpperCase()}
                        </div>
                        <span class={`rounded px-2 py-0.5 border text-[10px] ${getRoleStyle(role)}`}>
                          {role}
                        </span>
                      </div>
                      <div class="font-sans font-semibold text-slate-100 text-xs">{idObj.name}</div>
                      <div class="text-slate-400 text-[11px] mt-0.5">{idObj.handle}</div>
                    </div>

                    <div class="mt-4 border-t border-slate-800/80 pt-2 flex items-center justify-between text-[10px]">
                      <span class="text-slate-400">{idObj.devices.length} Registered Devices</span>
                      <CheckCircle2 class="size-3.5 text-emerald-400" />
                    </div>
                  </div>
                {/if}
              {/each}
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</main>
