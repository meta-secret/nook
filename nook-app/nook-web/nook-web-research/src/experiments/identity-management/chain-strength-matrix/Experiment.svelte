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
    Lock,
    Shield,
    ShieldCheck,
    Smartphone,
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
  import type { IdentityItem, KeyItem, VaultItem } from '../_shared/identity-mock-data'

  let { navigate }: ExperimentProps = $props()

  let selectedIdentityId = $state<string>('id-main')
  let selectedVaultId = $state<string>('vault-sentinel-core')

  const selectedIdentity = $derived(
    MOCK_IDENTITIES.find((item) => item.id === selectedIdentityId) ||
      MOCK_IDENTITIES[0],
  )

  const selectedVault = $derived(
    MOCK_VAULTS.find((item) => item.id === selectedVaultId) || MOCK_VAULTS[0],
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

  function getKeyBadgeColor(type: KeyType): string {
    switch (type) {
      case KeyType.DeviceX25519:
        return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
      case KeyType.PasskeyPrfSeed:
        return 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30'
      case KeyType.SigningEd25519:
        return 'bg-blue-500/10 text-blue-400 border-blue-500/30'
      case KeyType.PivSlot:
        return 'bg-amber-500/10 text-amber-400 border-amber-500/30'
      case KeyType.AgeRecipient:
        return 'bg-purple-500/10 text-purple-400 border-purple-500/30'
    }
  }

  function getRoleBadgeColor(role: VaultRole): string {
    switch (role) {
      case VaultRole.Owner:
        return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
      case VaultRole.FullSigner:
        return 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
      case VaultRole.ThresholdParticipant:
        return 'bg-blue-500/20 text-blue-300 border-blue-500/40'
      case VaultRole.RecoveryGuardian:
        return 'bg-amber-500/20 text-amber-300 border-amber-500/40'
      case VaultRole.ReadOnlyObserver:
        return 'bg-slate-500/20 text-slate-300 border-slate-500/40'
    }
  }
</script>

<main class="min-h-screen bg-slate-950 text-slate-100 font-sans">
  <ExperimentBack {navigate} />

  <div class="mx-auto max-w-7xl px-4 py-12 sm:px-8">
    <!-- Header -->
    <header class="mb-10 border-b border-slate-800 pb-8">
      <div class="flex items-center gap-3 text-emerald-400 font-mono text-xs tracking-wider uppercase mb-2">
        <ShieldCheck class="size-4" />
        Identity Management · Concept 01
      </div>
      <h1 class="text-4xl font-bold tracking-tight text-white sm:text-5xl">
        Chain Strength Matrix
      </h1>
      <p class="mt-3 max-w-3xl text-base text-slate-400 leading-relaxed">
        Independent identity & device key inventory paired with a visually separate vault-identity relationship matrix.
      </p>
    </header>

    <div class="space-y-12">
      <!-- PART 1: MY IDENTITIES (INDEPENDENT PANEL) -->
      <section class="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 backdrop-blur-md">
        <div class="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/80 pb-5">
          <div>
            <div class="flex items-center gap-2 font-mono text-xs text-emerald-400 font-semibold uppercase tracking-wider">
              <UserCheck class="size-4" />
              Part 1 · Independent Identity Registry
            </div>
            <h2 class="mt-1 text-2xl font-semibold tracking-tight text-white">
              My Identities
            </h2>
          </div>
          <div class="flex items-center gap-2 rounded-lg bg-slate-950 px-3 py-1.5 font-mono text-xs text-slate-400 border border-slate-800">
            <Fingerprint class="size-3.5 text-emerald-400" />
            <span>Select an identity to reveal devices & key material</span>
          </div>
        </div>

        <div class="grid gap-6 lg:grid-cols-[18rem_1fr]">
          <!-- Identity List -->
          <div class="space-y-3">
            {#each MOCK_IDENTITIES as identity (identity.id)}
              {@const isSelected = identity.id === selectedIdentityId}
              <button
                type="button"
                onclick={() => (selectedIdentityId = identity.id)}
                class={`w-full text-left rounded-xl p-4 transition-all duration-200 border ${
                  isSelected
                    ? 'border-emerald-500/50 bg-slate-800/90 shadow-lg shadow-emerald-500/5'
                    : 'border-slate-800/80 bg-slate-950/50 hover:bg-slate-800/50 hover:border-slate-700'
                }`}
              >
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-3">
                    <div class={`size-9 rounded-full bg-gradient-to-br ${identity.avatarColor} flex items-center justify-center font-bold text-xs text-white shadow-inner`}>
                      {identity.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <div class="font-medium text-sm text-slate-100">{identity.name}</div>
                      <div class="font-mono text-xs text-slate-400">{identity.handle}</div>
                    </div>
                  </div>
                  {#if isSelected}
                    <ChevronRight class="size-4 text-emerald-400" />
                  {/if}
                </div>

                <div class="mt-3 flex items-center justify-between border-t border-slate-800/60 pt-2 font-mono text-[11px]">
                  <span class="text-slate-400">{identity.devices.length} Devices</span>
                  <span class="inline-flex items-center gap-1 text-emerald-400 font-semibold">
                    <Activity class="size-3" />
                    Strength {identity.chainStrengthScore}%
                  </span>
                </div>
              </button>
            {/each}
          </div>

          <!-- Selected Identity Details: Devices & Keys -->
          <div class="rounded-xl border border-slate-800 bg-slate-950/80 p-6">
            <div class="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
              <div>
                <h3 class="text-xl font-semibold text-white flex items-center gap-2">
                  {selectedIdentity.name}
                  <span class="rounded-full bg-emerald-500/10 border border-emerald-500/30 px-2.5 py-0.5 font-mono text-xs text-emerald-400">
                    {selectedIdentity.status}
                  </span>
                </h3>
                <p class="font-mono text-xs text-slate-400 mt-1">
                  ID: {selectedIdentity.id} · Handle: {selectedIdentity.handle}
                </p>
              </div>

              <div class="flex items-center gap-3">
                <div class="text-right">
                  <div class="font-mono text-xs text-slate-400">Chain Strength</div>
                  <div class="text-lg font-bold font-mono text-emerald-400">{selectedIdentity.chainStrengthScore}/100</div>
                </div>
              </div>
            </div>

            <!-- Device Cards -->
            <div class="mt-6 space-y-5">
              <h4 class="font-mono text-xs uppercase tracking-wider text-slate-400 flex items-center gap-2">
                <Cpu class="size-3.5 text-emerald-400" />
                Attached Devices ({selectedIdentity.devices.length}) & Key Material
              </h4>

              <div class="space-y-4">
                {#each selectedIdentity.devices as device (device.id)}
                  {@const IconComponent = getDeviceIcon(device.deviceType)}
                  <div class="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
                    <!-- Device Bar -->
                    <div class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/60 pb-3">
                      <div class="flex items-center gap-3">
                        <div class="rounded-lg bg-slate-800 p-2 text-emerald-400 border border-slate-700/50">
                          <IconComponent class="size-5" />
                        </div>
                        <div>
                          <div class="font-medium text-slate-200 text-sm">{device.name}</div>
                          <div class="font-mono text-xs text-slate-400">{device.os}</div>
                        </div>
                      </div>

                      <div class="flex items-center gap-4 font-mono text-xs">
                        <div class="text-slate-400">
                          Trust score: <span class="text-emerald-400 font-semibold">{device.trustScore}%</span>
                        </div>
                        <div class="rounded bg-slate-800 px-2 py-1 text-slate-300">
                          {device.keys.length} Keys
                        </div>
                      </div>
                    </div>

                    <!-- Keys inside device -->
                    <div class="mt-3 grid gap-3 sm:grid-cols-2">
                      {#each device.keys as key (key.id)}
                        <div class="rounded-lg border border-slate-800/80 bg-slate-950/60 p-3 font-mono text-xs">
                          <div class="flex items-center justify-between mb-1.5">
                            <span class="font-semibold text-slate-200">{key.name}</span>
                            <span class={`rounded px-1.5 py-0.5 text-[10px] border ${getKeyBadgeColor(key.keyType)}`}>
                              {key.keyType}
                            </span>
                          </div>
                          <div class="text-[11px] text-slate-400 truncate mb-1">
                            {key.fingerprint}
                          </div>
                          <div class="flex items-center justify-between text-[10px] text-slate-400 pt-1 border-t border-slate-800/40">
                            <span>{key.algorithm}</span>
                            {#if key.isHardwareBacked}
                              <span class="text-emerald-400">HW Backed</span>
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
        </div>
      </section>

      <!-- PART 2: VAULT & IDENTITY RELATIONSHIPS (VISUALLY SEPARATE) -->
      <section class="rounded-2xl border-2 border-emerald-500/30 bg-gradient-to-b from-slate-900 via-slate-900/90 to-slate-950 p-6 shadow-2xl shadow-emerald-950/30">
        <div class="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-5">
          <div>
            <div class="flex items-center gap-2 font-mono text-xs text-cyan-400 font-semibold uppercase tracking-wider">
              <Vault class="size-4" />
              Part 2 · Visually Separate Topology Panel
            </div>
            <h2 class="mt-1 text-2xl font-semibold tracking-tight text-white">
              Vault & Identity Relationships
            </h2>
            <p class="mt-1 text-xs text-slate-400">
              Vaults connect directly to Identities (not raw keys). Inspect access policies and quorum authorization.
            </p>
          </div>

          <div class="flex items-center gap-2 rounded-lg bg-emerald-950/40 px-3 py-1.5 font-mono text-xs text-emerald-300 border border-emerald-500/30">
            <Users class="size-3.5" />
            <span>Quorum & Access Mapping</span>
          </div>
        </div>

        <div class="grid gap-6 lg:grid-cols-2">
          <!-- Vault List -->
          <div class="space-y-4">
            <h3 class="font-mono text-xs uppercase tracking-wider text-slate-400 flex items-center gap-2">
              <Lock class="size-3.5 text-cyan-400" />
              Managed Vaults ({MOCK_VAULTS.length})
            </h3>

            <div class="space-y-3">
              {#each MOCK_VAULTS as vault (vault.id)}
                {@const isVaultSelected = vault.id === selectedVaultId}
                {@const isAssociatedWithIdentity = vault.associatedIdentityIds.includes(selectedIdentityId)}
                <button
                  type="button"
                  onclick={() => (selectedVaultId = vault.id)}
                  class={`w-full text-left rounded-xl p-4 transition-all duration-200 border ${
                    isVaultSelected
                      ? 'border-cyan-500 bg-slate-800/90 shadow-lg shadow-cyan-500/10'
                      : isAssociatedWithIdentity
                        ? 'border-emerald-500/40 bg-slate-900/90'
                        : 'border-slate-800 bg-slate-950/40 opacity-70 hover:opacity-100'
                  }`}
                >
                  <div class="flex items-center justify-between">
                    <div class="font-semibold text-slate-100 text-sm flex items-center gap-2">
                      {vault.name}
                      {#if isAssociatedWithIdentity}
                        <span class="rounded bg-emerald-500/20 px-1.5 py-0.5 font-mono text-[10px] text-emerald-300 border border-emerald-500/30">
                          Identity Associated
                        </span>
                      {/if}
                    </div>
                    <span class="rounded-full bg-slate-800 px-2 py-0.5 font-mono text-xs text-cyan-400">
                      {vault.thresholdK}-of-{vault.totalN} Quorum
                    </span>
                  </div>

                  <p class="mt-2 text-xs text-slate-400 line-clamp-2">
                    {vault.description}
                  </p>

                  <div class="mt-3 flex items-center justify-between border-t border-slate-800/60 pt-2 font-mono text-xs text-slate-400">
                    <span>{vault.itemCount} Encrypted Items</span>
                    <span>{vault.associatedIdentityIds.length} Identities Authorized</span>
                  </div>
                </button>
              {/each}
            </div>
          </div>

          <!-- Relationship Matrix Card -->
          <div class="rounded-xl border border-slate-800 bg-slate-950/90 p-6 flex flex-col justify-between">
            <div>
              <div class="border-b border-slate-800 pb-4">
                <h4 class="font-semibold text-lg text-white flex items-center gap-2">
                  <Shield class="size-4 text-emerald-400" />
                  {selectedVault.name}
                </h4>
                <p class="mt-1 font-mono text-xs text-slate-400">
                  Policy: <span class="text-cyan-400 font-semibold">{selectedVault.policyType}</span> ({selectedVault.thresholdK}-of-{selectedVault.totalN} quorum required)
                </p>
              </div>

              <!-- Participating Identities -->
              <div class="mt-6 space-y-4">
                <div class="font-mono text-xs uppercase tracking-wider text-slate-400">
                  Participating Identities for this Vault
                </div>

                <div class="space-y-3">
                  {#each selectedVault.associatedIdentityIds as identityId (identityId)}
                    {@const identityObj = MOCK_IDENTITIES.find((i) => i.id === identityId)}
                    {@const role = selectedVault.identityRoles[identityId]}
                    {#if identityObj}
                      <div class={`rounded-xl border p-4 flex flex-wrap items-center justify-between gap-3 ${
                        identityId === selectedIdentityId
                          ? 'border-emerald-500/50 bg-emerald-950/20'
                          : 'border-slate-800 bg-slate-900/40'
                      }`}>
                        <div class="flex items-center gap-3">
                          <div class={`size-8 rounded-full bg-gradient-to-br ${identityObj.avatarColor} flex items-center justify-center font-bold text-xs text-white`}>
                            {identityObj.name.slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <div class="font-medium text-sm text-slate-100 flex items-center gap-2">
                              {identityObj.name}
                              {#if identityId === selectedIdentityId}
                                <span class="text-[10px] font-mono text-emerald-400">(Selected Identity)</span>
                              {/if}
                            </div>
                            <div class="font-mono text-xs text-slate-400">{identityObj.handle}</div>
                          </div>
                        </div>

                        <span class={`rounded-full px-2.5 py-1 font-mono text-xs border ${getRoleBadgeColor(role)}`}>
                          {role}
                        </span>
                      </div>
                    {/if}
                  {/each}
                </div>
              </div>
            </div>

            <div class="mt-8 rounded-lg border border-slate-800 bg-slate-900/60 p-4 font-mono text-xs text-slate-400">
              <div class="flex items-center gap-2 text-emerald-400 font-semibold mb-1">
                <CheckCircle2 class="size-4" />
                Security Rule Verification
              </div>
              <p class="text-slate-400 leading-relaxed">
                Vault authorization evaluates identity quorums directly. Key rotation inside an Identity updates all attached Vault relationships automatically.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</main>
