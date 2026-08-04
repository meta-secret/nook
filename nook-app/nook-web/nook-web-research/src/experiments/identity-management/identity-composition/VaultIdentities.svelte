<script lang="ts">
  import { UserRound, Users, Vault as VaultIcon } from '@lucide/svelte'
  import {
    identities,
    identityById,
    IdentityKind,
    vaultGrants,
    type VaultGrant,
  } from '../_shared/identity-model'

  interface Props {
    activeIdentityId: string
    onselectidentity: (identityId: string) => void
  }

  interface VaultRead {
    vaultId: string
    vaultLabel: string
    grants: readonly VaultGrant[]
    identityIds: ReadonlySet<string>
    pips: readonly boolean[]
  }

  const CAPS = 'font-mono text-[10px] tracking-[0.22em] uppercase'

  let { activeIdentityId, onselectidentity }: Props = $props()

  const vaultIds = $derived([
    ...new Set(vaultGrants.map((grant) => grant.vaultId)),
  ])
  const reads = $derived(vaultIds.map(readForVault))

  function readForVault(vaultId: string): VaultRead {
    const grants = vaultGrants.filter((grant) => grant.vaultId === vaultId)
    const first = grants[0]
    if (!first) throw new Error(`Unknown fixture vault ${vaultId}`)
    const identityIds = new Set(grants.map((grant) => grant.identityId))
    return {
      vaultId,
      vaultLabel: first.vaultLabel,
      grants,
      identityIds,
      pips: identities.map((identity) => identityIds.has(identity.id)),
    }
  }

  function identityInk(kind: IdentityKind): string {
    return kind === IdentityKind.Collective ? '#9aa6ff' : '#ff7651'
  }

  function identityCountLabel(count: number): string {
    return `${count} identit${count === 1 ? 'y' : 'ies'}`
  }

  function braceY(count: number, index: number): number {
    return ((index + 0.5) / count) * 100
  }
</script>

<section class="mt-14 border-t border-white/20 pt-10" aria-labelledby="vault-identities-title">
  <p id="vault-identities-title" class="{CAPS} flex items-center gap-1.5 text-white/45">
    <VaultIcon class="size-3" aria-hidden="true" />
    Vault ↔ identities
  </p>
  <p class="mt-2 max-w-xl text-[12px] leading-5 text-white/50">
    Vaults authorize identities. Their device keys and passkeys stay in the identity component above.
  </p>

  <ul class="mt-3 space-y-3">
    {#each reads as read (read.vaultId)}
      {@const related = read.identityIds.has(activeIdentityId)}
      <li class={`border border-l-2 border-l-[#5fd39f] border-y-white/20 border-r-white/20 transition motion-reduce:transition-none ${related ? 'opacity-100' : 'opacity-55'}`}>
        <div class="flex flex-col sm:flex-row sm:items-stretch">
          <article class="flex shrink-0 flex-col justify-center gap-1.5 border-b border-white/15 bg-[#121316] px-4 py-3 sm:w-56 sm:border-r sm:border-b-0">
            <span class="flex items-center gap-2">
              <VaultIcon class="size-3.5 shrink-0 text-white/55" aria-hidden="true" />
              <span class="truncate text-[13px]">{read.vaultLabel}</span>
              <span class="ml-auto shrink-0 font-mono text-[9px] tracking-[0.14em] text-[#5fd39f] uppercase">authorized</span>
            </span>
            <span class="font-mono text-xl tracking-[0.08em]">{read.vaultId}</span>
            <span class="flex items-center gap-1.5">
              <span class="flex items-center gap-1" aria-hidden="true">
                {#each read.pips as filled, index (index)}
                  <span class={`size-2 rounded-full ${filled ? 'bg-[#5fd39f]' : 'border border-white/25'}`}></span>
                {/each}
              </span>
              <span class="font-mono text-[10px] tracking-[0.1em] text-[#5fd39f] uppercase">
                {identityCountLabel(read.identityIds.size)}
              </span>
            </span>
            <span class="font-mono text-[10px] text-white/60">independent encrypted DEK</span>
          </article>

          <div class="relative hidden w-8 shrink-0 sm:block">
            <svg viewBox="0 0 24 100" preserveAspectRatio="none" class="absolute inset-0 h-full w-full" aria-hidden="true" focusable="false">
              {#each read.grants as grant, index (grant.id)}
                <path
                  d={`M24 ${braceY(read.grants.length, index)} H17 C9 ${braceY(read.grants.length, index)} 9 50 0 50`}
                  fill="none"
                  vector-effect="non-scaling-stroke"
                  stroke-width="1.25"
                  class="stroke-white/45"
                />
              {/each}
            </svg>
          </div>

          <div class="grid min-w-0 flex-1" style={`grid-template-rows: repeat(${read.grants.length}, minmax(0, 1fr))`}>
            {#each read.grants as grant (grant.id)}
              {@const identity = identityById(grant.identityId)}
              {@const selected = identity.id === activeIdentityId}
              <div class={`flex min-w-0 items-center gap-2 px-4 py-2.5 ${selected ? 'bg-[#5fd39f]/8' : ''}`}>
                <span class="hidden w-4 shrink-0 border-t border-white/35 sm:block" aria-hidden="true"></span>
                <button
                  type="button"
                  aria-pressed={selected}
                  aria-label={`Identity ${identity.label}, ${grant.capability}, ${grant.status}`}
                  class={`flex min-w-0 flex-1 items-center gap-2.5 rounded-r-md rounded-l-full px-1.5 py-1 text-left transition motion-reduce:transition-none ${selected ? 'bg-white text-black' : 'border border-white/25 bg-[#121316] text-white/70'}`}
                  onclick={() => onselectidentity(identity.id)}
                >
                  <span class="grid size-7 shrink-0 place-items-center rounded-full border" style={`border-color:${identityInk(identity.kind)}`} aria-hidden="true">
                    {#if identity.kind === IdentityKind.Collective}
                      <Users class="size-3" style={`color:${identityInk(identity.kind)}`} />
                    {:else}
                      <UserRound class="size-3" style={`color:${identityInk(identity.kind)}`} />
                    {/if}
                  </span>
                  <span class="min-w-0">
                    <span class={`block truncate text-[10px] ${selected ? 'text-black/60' : 'text-white/50'}`}>{identity.label}</span>
                    <span class="block font-mono text-[13px] tracking-[0.06em]">{identity.shortId}</span>
                  </span>
                  <span class="ml-auto shrink-0 text-right">
                    <span class={`block font-mono text-[9px] tracking-[0.12em] uppercase ${selected ? 'text-black/70' : 'text-[#5fd39f]'}`}>{grant.capability}</span>
                    <span class={`block font-mono text-[9px] tracking-[0.1em] uppercase ${selected ? 'text-black/50' : 'text-white/40'}`}>{grant.status}</span>
                  </span>
                </button>
              </div>
            {/each}
          </div>
        </div>
      </li>
    {/each}
  </ul>
</section>
