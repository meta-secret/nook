<script lang="ts">
  import { Fingerprint, Vault } from '@lucide/svelte'
  import ExperimentBack from '$lib/components/ExperimentBack.svelte'
  import type { ExperimentProps } from '../../index'
  import {
    grantsForIdentity,
    grantsForVault,
    identities,
    identityById,
    vaults,
    vaultById,
  } from '../_shared/identity-vault-fixtures'
  import BridgeGraph from './BridgeGraph.svelte'
  import { BridgePerspective } from './bridge-perspective'

  let { navigate }: ExperimentProps = $props()

  let selectedPerspective = $state(BridgePerspective.Identities)
  let selectedIdentityId = $state('idn_7c9d')
  let selectedVaultId = $state('vlt_home')
  const selectedIdentity = $derived(identityById(selectedIdentityId))
  const selectedVault = $derived(vaultById(selectedVaultId))
  const selectedVaultGrants = $derived(grantsForVault(selectedVaultId))
</script>

<svelte:head>
  <title>Identity bridge · Nook research</title>
</svelte:head>

<main class="min-h-svh bg-[#08090a] text-[#f4f3f0]">
  <ExperimentBack {navigate} />

  <nav
    class="identity-menu"
    aria-label={selectedPerspective === BridgePerspective.Identities
      ? 'Identities'
      : 'Vaults'}
  >
    <p class="perspective-heading">Browse by</p>
    <div class="perspective-switch" aria-label="Browse by">
      <button
        type="button"
        class:active={selectedPerspective === BridgePerspective.Identities}
        aria-pressed={selectedPerspective === BridgePerspective.Identities}
        onclick={() => (selectedPerspective = BridgePerspective.Identities)}
      >
        <Fingerprint class="size-4" />
        <span>Identity</span>
      </button>
      <button
        type="button"
        class:active={selectedPerspective === BridgePerspective.Vaults}
        aria-pressed={selectedPerspective === BridgePerspective.Vaults}
        onclick={() => (selectedPerspective = BridgePerspective.Vaults)}
      >
        <Vault class="size-4" />
        <span>Vault</span>
      </button>
    </div>

    {#if selectedPerspective === BridgePerspective.Identities}
      <ol>
        {#each identities as identity (identity.id)}
          {@const active = identity.id === selectedIdentityId}
          {@const vaultCount = grantsForIdentity(identity.id).length}
          <li>
            <button
              type="button"
              class:active
              aria-label={`${identity.label}, ${identity.description}, ${vaultCount} ${vaultCount === 1 ? 'vault' : 'vaults'}`}
              aria-current={active ? 'page' : 'false'}
              onclick={() => (selectedIdentityId = identity.id)}
            >
              <span class="identity-mark"><Fingerprint class="size-4" /></span>
              <span class="identity-copy">
                <strong>{identity.label}</strong>
                <small>{identity.description}</small>
              </span>
              <span class="identity-count"
                ><Vault class="size-3" /> {vaultCount}</span
              >
            </button>
          </li>
        {/each}
      </ol>
    {:else}
      <ol class="vault-list">
        {#each vaults as vault (vault.id)}
          {@const active = vault.id === selectedVaultId}
          {@const identityCount = grantsForVault(vault.id).length}
          <li>
            <button
              type="button"
              class:active
              aria-label={`${vault.label}, ${vault.description}, ${identityCount} ${identityCount === 1 ? 'identity' : 'identities'}`}
              aria-current={active ? 'page' : 'false'}
              onclick={() => (selectedVaultId = vault.id)}
            >
              <span class="identity-mark"><Vault class="size-4" /></span>
              <span class="identity-copy">
                <strong>{vault.label}</strong>
                <small>{vault.description}</small>
              </span>
              <span class="identity-count"
                ><Fingerprint class="size-3" /> {identityCount}</span
              >
            </button>
          </li>
        {/each}
      </ol>
    {/if}
  </nav>

  <section class="page" aria-labelledby="bridge-title">
    {#if selectedPerspective === BridgePerspective.Identities}
      <header class="page-header">
        <p class="eyebrow">Identity view</p>
        <h1 id="bridge-title">
          {selectedIdentity.label} connects its devices to {grantsForIdentity(
            selectedIdentityId,
          ).length}
          {grantsForIdentity(selectedIdentityId).length === 1
            ? 'vault'
            : 'vaults'}.
        </h1>
        <p class="lede">
          Device keys establish where this distributed identity can act. Vault
          grants define what it may open.
        </p>
      </header>
    {:else}
      <header class="page-header">
        <p class="eyebrow">Vault view</p>
        <h1 id="bridge-title">
          {selectedVaultGrants.length}
          {selectedVaultGrants.length === 1 ? 'identity' : 'identities'} can open
          {selectedVault.label}.
        </h1>
        <p class="lede">
          The vault grant names who may open it. Each identity carries evidence
          of the devices where it can act.
        </p>
      </header>
    {/if}

    <div class="graph-shell">
      {#key `${selectedPerspective}:${selectedIdentityId}:${selectedVaultId}`}
        <BridgeGraph
          perspective={selectedPerspective}
          identityId={selectedIdentityId}
          vaultId={selectedVaultId}
        />
      {/key}
    </div>
  </section>
</main>

<style>
  .identity-menu {
    position: fixed;
    top: 50%;
    left: 1.5rem;
    z-index: 30;
    width: 18rem;
    min-height: 28.25rem;
    transform: translateY(-50%);
  }

  .perspective-heading,
  .eyebrow {
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    text-transform: uppercase;
    letter-spacing: 0.18em;
  }

  .perspective-heading {
    margin: 0 0 0.55rem 0.75rem;
    color: #555653;
    font-size: 0.5625rem;
  }

  .perspective-switch {
    display: grid;
    width: calc(100% - 0.75rem);
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.35rem;
    margin: 0 0 1.85rem 0.75rem;
  }

  .perspective-switch button {
    position: relative;
    display: flex;
    min-height: 3rem;
    align-items: center;
    gap: 0.5rem;
    padding: 0.55rem 0.75rem 0.55rem 1rem;
    border: 0;
    background: transparent;
    color: #5f605d;
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.6875rem;
    letter-spacing: 0.08em;
    text-align: left;
    text-transform: uppercase;
  }

  .perspective-switch button::before,
  .identity-menu ol button::before {
    position: absolute;
    top: 50%;
    left: 0;
    width: 1px;
    background: #3f403e;
    content: '';
    transform: translateY(-50%);
  }

  .perspective-switch button::before {
    height: 1.25rem;
  }
  .perspective-switch button.active {
    background: linear-gradient(90deg, #17181a 0%, transparent 100%);
    color: #f4f3f0;
  }
  .perspective-switch button.active::before {
    height: 2rem;
    background: #ff6b3d;
  }
  .perspective-switch button:focus-visible,
  .identity-menu ol button:focus-visible {
    outline: 0;
    box-shadow: inset 0 -1px #8b8b88;
  }

  .identity-menu ol {
    display: grid;
    gap: 0.55rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .identity-menu ol button {
    position: relative;
    display: grid;
    width: 100%;
    min-height: 4.6rem;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.8rem;
    padding: 0.6rem 0.9rem;
    border: 0;
    border-radius: 2.5rem 0 0 2.5rem;
    background: transparent;
    color: #6d6d6a;
    text-align: left;
  }

  .identity-menu ol button::before {
    left: -0.75rem;
    height: 1.5rem;
    background: #4a4a48;
  }
  .identity-menu ol button.active {
    background: linear-gradient(90deg, #1b1c1e 0%, transparent 100%);
    color: #f4f3f0;
  }
  .identity-menu ol button.active::before {
    height: 3.5rem;
    background: #ff6b3d;
  }

  .identity-mark {
    display: grid;
    width: 2.75rem;
    height: 2.75rem;
    place-items: center;
    border: 1px solid #3a3b3d;
    border-radius: 999px;
  }

  .identity-menu ol button.active .identity-mark {
    border-color: #c9c8c4;
  }
  .identity-copy {
    min-width: 0;
  }
  .identity-copy strong,
  .identity-copy small {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .identity-copy strong {
    color: inherit;
    font-size: 0.875rem;
    font-weight: 500;
  }
  .identity-copy small {
    margin-top: 0.2rem;
    color: #555653;
    font-size: 0.6875rem;
  }
  .identity-count {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    color: #6d6d6a;
    font-family: ui-monospace, monospace;
    font-size: 0.625rem;
  }

  .page {
    min-height: 100svh;
    padding: 4.5rem 3.5rem 2.5rem 21.75rem;
  }

  .page-header,
  .graph-shell {
    max-width: 82rem;
    margin-right: auto;
  }
  .eyebrow {
    margin: 0;
    color: #ff6b3d;
    font-size: 0.625rem;
  }
  h1 {
    max-width: 66rem;
    margin: 0.75rem 0 0;
    font-size: clamp(2.35rem, 4vw, 3.75rem);
    line-height: 1.02;
    font-weight: 500;
    letter-spacing: -0.045em;
  }
  .lede {
    max-width: 46rem;
    margin: 0.8rem 0 0;
    color: #777774;
    font-size: 0.8125rem;
    line-height: 1.55;
  }
  .graph-shell {
    margin-top: 1.7rem;
  }

  @media (width < 70rem) {
    .page {
      padding-right: 2rem;
    }
  }

  @media (width < 48rem) {
    .identity-menu {
      position: relative;
      top: auto;
      left: auto;
      width: auto;
      min-height: 0;
      padding: 5.5rem 1.25rem 0;
      transform: none;
    }
    .perspective-heading {
      margin-left: 0;
    }
    .perspective-switch {
      width: 100%;
      margin: 0 0 1.35rem;
    }
    .perspective-switch button {
      min-height: 2.75rem;
      justify-content: center;
      padding: 0.5rem 0.75rem;
    }
    .identity-menu ol,
    .identity-menu ol.vault-list {
      display: grid;
      gap: 0.45rem;
      padding: 0;
    }
    .identity-menu li {
      width: 100%;
    }
    .identity-menu ol button {
      min-height: 3.75rem;
      grid-template-columns: auto minmax(0, 1fr) auto;
      justify-items: initial;
      gap: 0.7rem;
      padding: 0.55rem 0.8rem;
      border-radius: 2.25rem 0 0 2.25rem;
    }
    .identity-menu ol button::before {
      top: 50%;
      bottom: auto;
      left: 0;
      width: 1px;
      height: 1.5rem;
      transform: translateY(-50%);
    }
    .identity-menu ol button.active::before {
      width: 1px;
      height: 3rem;
    }
    .identity-mark {
      width: 2.375rem;
      height: 2.375rem;
    }
    .identity-copy {
      width: auto;
      text-align: left;
    }
    .identity-copy strong {
      font-size: 0.8125rem;
    }
    .identity-copy small {
      display: block;
    }
    .identity-count {
      display: flex;
    }
    .page {
      min-height: auto;
      padding: 2rem 0 4rem;
    }
    .page-header {
      padding: 0 1.25rem;
    }
    h1 {
      max-width: 22rem;
      font-size: clamp(2.25rem, 10.5vw, 2.75rem);
      line-height: 1.04;
    }
    .lede {
      max-width: 22rem;
    }
    .graph-shell {
      margin-top: 1.4rem;
    }
  }
</style>
