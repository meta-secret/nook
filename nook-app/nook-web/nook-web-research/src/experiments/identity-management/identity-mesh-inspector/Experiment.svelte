<script lang="ts">
  import {
    BadgeCheck,
    Boxes,
    CheckCircle,
    ChevronRight,
    Cpu,
    Fingerprint,
    HardDrive,
    KeyRound,
    Layers,
    Lock,
    Network,
    ShieldAlert,
    ShieldCheck,
    Smartphone,
    UserCheck,
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

  let activeIdentityId = $state<string>('id-main')
  let activeVaultId = $state<string>('vault-sentinel-core')
  let expandedDeviceId = $state<string>('dev-macbook')

  const activeIdentity = $derived(
    MOCK_IDENTITIES.find((i) => i.id === activeIdentityId) || MOCK_IDENTITIES[0],
  )

  const activeVault = $derived(
    MOCK_VAULTS.find((v) => v.id === activeVaultId) || MOCK_VAULTS[0],
  )

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

  function getRoleBadge(role: VaultRole): string {
    switch (role) {
      case VaultRole.Owner:
        return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
      case VaultRole.FullSigner:
        return 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30'
      case VaultRole.ThresholdParticipant:
        return 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30'
      case VaultRole.RecoveryGuardian:
        return 'bg-amber-500/20 text-amber-300 border-amber-500/30'
      case VaultRole.ReadOnlyObserver:
        return 'bg-slate-500/20 text-slate-300 border-slate-500/30'
    }
  }
</script>

<main class="min-h-screen bg-slate-950 text-slate-100 font-sans">
  <ExperimentBack {navigate} />

  <div class="mx-auto max-w-7xl px-4 py-12 sm:px-8">
    <!-- Header -->
    <header class="mb-8 border-b border-slate-800/80 pb-6">
      <div class="flex items-center gap-2 text-cyan-400 font-mono text-xs uppercase tracking-wider mb-2">
        <Network class="size-4" />
        Identity Management · Concept 02
      </div>
      <h1 class="text-4xl font-bold tracking-tight text-white sm:text-5xl">
        Identity Mesh Inspector
      </h1>
      <p class="mt-2 text-slate-400 text-sm sm:text-base max-w-3xl">
        Side-by-side workstation view. Left panel inspects identity devices & key slots; right obsidian panel inspects vault-identity relationship topology.
      </p>
    </header>

    <!-- MAIN SIDE-BY-SIDE LAYOUT -->
    <div class="grid gap-8 lg:grid-cols-2">
      <!-- LEFT PANEL: PART 1 - MY IDENTITIES & DEVICE KEY STACKS -->
      <section class="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 flex flex-col justify-between">
        <div>
          <!-- Header -->
          <div class="mb-6 flex items-center justify-between border-b border-slate-800/80 pb-4">
            <div>
              <div class="flex items-center gap-2 font-mono text-xs text-emerald-400 font-semibold uppercase tracking-wider">
                <UserCheck class="size-4" />
                Part 1 · Independent Panel
              </div>
              <h2 class="text-xl font-semibold text-white mt-1">
                My Identities & Devices
              </h2>
            </div>
            <span class="rounded-full bg-slate-800 px-3 py-1 font-mono text-xs text-slate-300 border border-slate-700/50">
              {MOCK_IDENTITIES.length} Identities
            </span>
          </div>

          <!-- Identity Selector Chips -->
          <div class="grid gap-3 sm:grid-cols-3 mb-6">
            {#each MOCK_IDENTITIES as identity (identity.id)}
              {@const isSelected = identity.id === activeIdentityId}
              <button
                type="button"
                onclick={() => {
                  activeIdentityId = identity.id
                  if (identity.devices.length > 0) {
                    expandedDeviceId = identity.devices[0].id
                  }
                }}
                class={`rounded-xl p-3 text-left transition-all border ${
                  isSelected
                    ? 'border-emerald-500 bg-slate-800 text-white shadow-md'
                    : 'border-slate-800 bg-slate-950/60 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                }`}
              >
                <div class="flex items-center gap-2 mb-1">
                  <div class={`size-3 rounded-full bg-gradient-to-br ${identity.avatarColor}`}></div>
                  <span class="font-medium text-xs truncate">{identity.name}</span>
                </div>
                <div class="font-mono text-[10px] text-slate-400">
                  {identity.devices.length} Devices
                </div>
              </button>
            {/each}
          </div>

          <!-- Selected Identity Device Inspector -->
          <div class="rounded-xl border border-slate-800 bg-slate-950/80 p-5">
            <div class="flex items-center justify-between border-b border-slate-800 pb-4">
              <div>
                <h3 class="font-semibold text-lg text-white">{activeIdentity.name}</h3>
                <div class="font-mono text-xs text-slate-400">{activeIdentity.handle}</div>
              </div>
              <div class="text-right font-mono text-xs">
                <span class="text-slate-400">Strength Score:</span>
                <span class="text-emerald-400 font-bold ml-1">{activeIdentity.chainStrengthScore}%</span>
              </div>
            </div>

            <!-- Accordion of Devices -->
            <div class="mt-5 space-y-3">
              <div class="font-mono text-xs uppercase tracking-wider text-slate-400 flex items-center gap-2 mb-2">
                <Layers class="size-3.5 text-emerald-400" />
                Attached Devices & Key Inventory
              </div>

              {#each activeIdentity.devices as device (device.id)}
                {@const isExpanded = device.id === expandedDeviceId}
                {@const DevIcon = getDeviceIcon(device.deviceType)}
                <div class="rounded-lg border border-slate-800/80 bg-slate-900/60 overflow-hidden">
                  <button
                    type="button"
                    onclick={() => (expandedDeviceId = isExpanded ? '' : device.id)}
                    class="w-full flex items-center justify-between p-3.5 text-left hover:bg-slate-800/50 transition-colors"
                  >
                    <div class="flex items-center gap-3">
                      <div class="rounded bg-slate-800 p-1.5 text-emerald-400">
                        <DevIcon class="size-4" />
                      </div>
                      <div>
                        <div class="font-medium text-sm text-slate-200">{device.name}</div>
                        <div class="font-mono text-[11px] text-slate-400">{device.os}</div>
                      </div>
                    </div>
                    <div class="flex items-center gap-3 font-mono text-xs">
                      <span class="text-emerald-400 font-semibold">{device.keys.length} keys</span>
                      <ChevronRight class={`size-4 text-slate-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                    </div>
                  </button>

                  {#if isExpanded}
                    <div class="border-t border-slate-800/80 bg-slate-950/80 p-4 space-y-3">
                      {#each device.keys as key (key.id)}
                        <div class="rounded-lg border border-slate-800/60 bg-slate-900/80 p-3 font-mono text-xs">
                          <div class="flex items-center justify-between font-semibold text-slate-200 mb-1">
                            <span>{key.name}</span>
                            <span class="text-[10px] text-cyan-400">{key.keyType}</span>
                          </div>
                          <div class="text-[11px] text-slate-400 truncate mb-1">
                            {key.fingerprint}
                          </div>
                          <div class="flex items-center justify-between text-[10px] text-slate-400 pt-1 border-t border-slate-800/40">
                            <span>Algo: {key.algorithm}</span>
                            <span>{key.usageCount} Operations</span>
                          </div>
                        </div>
                      {/each}
                    </div>
                  {/if}
                </div>
              {/each}
            </div>
          </div>
        </div>

        <div class="mt-6 rounded-xl border border-slate-800/80 bg-slate-950/50 p-4 font-mono text-xs text-slate-400 flex items-center gap-3">
          <BadgeCheck class="size-5 text-emerald-400 shrink-0" />
          <span>Part 1 maintains device and key boundaries independently of vault quorum settings.</span>
        </div>
      </section>

      <!-- RIGHT PANEL: PART 2 - VAULT & IDENTITY RELATIONSHIPS (VISUALLY SEPARATE OBSIDIAN PANEL) -->
      <section class="rounded-2xl border-2 border-cyan-500/30 bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 p-6 flex flex-col justify-between shadow-2xl shadow-cyan-950/40">
        <div>
          <!-- Header -->
          <div class="mb-6 flex items-center justify-between border-b border-slate-800 pb-4">
            <div>
              <div class="flex items-center gap-2 font-mono text-xs text-cyan-400 font-semibold uppercase tracking-wider">
                <Vault class="size-4" />
                Part 2 · Visually Separate Obsidian Card
              </div>
              <h2 class="text-xl font-semibold text-white mt-1">
                Vault & Identity Topology
              </h2>
            </div>
            <span class="rounded-full bg-cyan-950 px-3 py-1 font-mono text-xs text-cyan-300 border border-cyan-500/30">
              Vaults $\leftrightarrow$ Identities Only
            </span>
          </div>

          <p class="text-xs text-slate-400 mb-5 leading-relaxed">
            No keys shown here. This panel manages entitlement relationships, identity roles, and threshold quorum rules.
          </p>

          <!-- Vault Selection Grid -->
          <div class="grid gap-3 sm:grid-cols-2 mb-6">
            {#each MOCK_VAULTS as vault (vault.id)}
              {@const isSelected = vault.id === activeVaultId}
              {@const relatesToActiveIdentity = vault.associatedIdentityIds.includes(activeIdentityId)}
              <button
                type="button"
                onclick={() => (activeVaultId = vault.id)}
                class={`rounded-xl p-4 text-left transition-all border ${
                  isSelected
                    ? 'border-cyan-400 bg-cyan-950/30 shadow-lg shadow-cyan-500/10'
                    : relatesToActiveIdentity
                      ? 'border-emerald-500/40 bg-slate-900/80'
                      : 'border-slate-800 bg-slate-950/60 opacity-60 hover:opacity-100'
                }`}
              >
                <div class="flex items-center justify-between mb-2">
                  <div class="font-semibold text-sm text-slate-100">{vault.name}</div>
                  <span class="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-cyan-300">
                    {vault.thresholdK}/{vault.totalN}
                  </span>
                </div>
                <div class="font-mono text-[11px] text-slate-400">
                  {vault.associatedIdentityIds.length} Identities Authorized
                </div>
              </button>
            {/each}
          </div>

          <!-- Active Vault Identity Relationship Breakdown -->
          <div class="rounded-xl border border-slate-800 bg-slate-950/90 p-5 space-y-4">
            <div class="border-b border-slate-800 pb-3">
              <h4 class="font-semibold text-base text-white flex items-center gap-2">
                <Lock class="size-4 text-cyan-400" />
                {activeVault.name}
              </h4>
              <p class="text-xs text-slate-400 mt-1">{activeVault.description}</p>
            </div>

            <div class="font-mono text-xs uppercase tracking-wider text-slate-400">
              Identity Quorum Entitlements
            </div>

            <div class="space-y-3">
              {#each activeVault.associatedIdentityIds as identityId (identityId)}
                {@const identityItem = MOCK_IDENTITIES.find((i) => i.id === identityId)}
                {@const role = activeVault.identityRoles[identityId]}
                {#if identityItem}
                  <div class={`rounded-lg border p-3.5 flex items-center justify-between ${
                    identityId === activeIdentityId
                      ? 'border-emerald-500/50 bg-emerald-950/20'
                      : 'border-slate-800 bg-slate-900/40'
                  }`}>
                    <div class="flex items-center gap-3">
                      <div class={`size-7 rounded-full bg-gradient-to-br ${identityItem.avatarColor} flex items-center justify-center font-bold text-[10px] text-white`}>
                        {identityItem.name.slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <div class="font-medium text-xs text-slate-100 flex items-center gap-1.5">
                          {identityItem.name}
                          {#if identityId === activeIdentityId}
                            <span class="text-[10px] text-emerald-400 font-mono">(Active in Left Panel)</span>
                          {/if}
                        </div>
                        <div class="font-mono text-[10px] text-slate-400">{identityItem.handle}</div>
                      </div>
                    </div>

                    <span class={`rounded-full px-2.5 py-0.5 font-mono text-[11px] border ${getRoleBadge(role)}`}>
                      {role}
                    </span>
                  </div>
                {/if}
              {/each}
            </div>
          </div>
        </div>

        <div class="mt-6 rounded-xl border border-cyan-500/30 bg-cyan-950/20 p-4 font-mono text-xs text-cyan-300 flex items-center gap-3">
          <CheckCircle class="size-5 text-cyan-400 shrink-0" />
          <span>Vault security is derived from Identity threshold agreements without leaking key material.</span>
        </div>
      </section>
    </div>
  </div>
</main>
