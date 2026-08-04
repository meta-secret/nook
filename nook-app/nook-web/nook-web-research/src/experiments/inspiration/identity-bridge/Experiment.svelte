<script lang="ts">
  import { Fingerprint, KeyRound, MonitorSmartphone, ShieldCheck, Vault } from '@lucide/svelte'
  import ExperimentBack from '$lib/components/ExperimentBack.svelte'
  import type { ExperimentProps } from '../../index'
  import {
    grantsForIdentity,
    identities,
    identityById,
    vaultById,
  } from './identity-vault-fixtures'

  let { navigate }: ExperimentProps = $props()

  let selectedIdentityId = $state('idn_7c9d')
  const selectedIdentity = $derived(identityById(selectedIdentityId))
  const selectedGrants = $derived(grantsForIdentity(selectedIdentityId))
</script>

<svelte:head>
  <title>Identity bridge · Nook research</title>
</svelte:head>

<main class="min-h-svh bg-[#08090a] text-[#f4f3f0]">
  <ExperimentBack {navigate} />

  <nav class="identity-menu" aria-label="Identities">
    <p class="menu-heading"><Fingerprint class="size-4" /> My identities</p>
    <ol>
      {#each identities as identity (identity.id)}
        {@const active = identity.id === selectedIdentityId}
        {@const vaultCount = grantsForIdentity(identity.id).length}
        <li>
          <button
            type="button"
            class:active
            aria-current={active ? 'page' : 'false'}
            onclick={() => (selectedIdentityId = identity.id)}
          >
            <span class="identity-mark"><Fingerprint class="size-4" /></span>
            <span class="identity-copy">
              <strong>{identity.label}</strong>
              <small>{identity.description}</small>
            </span>
            <span class="identity-count">
              {vaultCount} {vaultCount === 1 ? 'vault' : 'vaults'}
            </span>
          </button>
        </li>
      {/each}
    </ol>
  </nav>

  <section class="page" aria-labelledby="bridge-title">
    <header>
      <p class="eyebrow">Identity-first view</p>
      <h1 id="bridge-title">
        {selectedIdentity.label} can open {selectedGrants.length}
        {selectedGrants.length === 1 ? 'vault' : 'vaults'}.
      </h1>
      <p class="lede">
        Hardware proves this identity can act here. Vault grants decide what the identity may open.
      </p>
    </header>

    <div class="bridge">
      <section class="evidence-column" aria-labelledby="device-evidence-title">
        <div class="section-heading">
          <span>Device evidence</span>
          <span>{selectedIdentity.devices.length}</span>
        </div>
        <div class="device-stack">
          {#each selectedIdentity.devices as device (device.id)}
            <article class="device-row">
              <span class="device-icon"><MonitorSmartphone class="size-4" /></span>
              <span class="device-copy">
                <strong>{device.label}</strong>
                <small>{device.installations.join(' · ')}</small>
              </span>
              <span class="key-count">
                <KeyRound class="size-3.5" /> {device.installations.length}
              </span>
            </article>
          {/each}
        </div>
      </section>

      <div class="identity-hub" aria-label="Selected identity">
        <span class="hub-line left" aria-hidden="true"></span>
        <span class="hub-mark"><Fingerprint class="size-6" /></span>
        <strong>{selectedIdentity.label}</strong>
        <small>{selectedIdentity.id}</small>
        <span class="hub-line right" aria-hidden="true"></span>
      </div>

      <section class="vault-column" aria-labelledby="vault-outcome-title">
        <div class="section-heading">
          <span id="vault-outcome-title">Vaults it can open</span>
          <span>{selectedGrants.length}</span>
        </div>
        <div class="vault-stack">
          {#each selectedGrants as grant (grant.id)}
            {@const vault = vaultById(grant.vaultId)}
            <article class="vault-card">
              <div class="vault-topline">
                <span class="vault-icon"><Vault class="size-5" /></span>
                <span class="grant-proof"><ShieldCheck class="size-3.5" /> Authorized</span>
              </div>
              <h2>{vault.label}</h2>
              <p>{vault.description}</p>
              <dl>
                <div><dt>Grant</dt><dd>{grant.role}</dd></div>
                <div><dt>Items</dt><dd>{vault.itemCount}</dd></div>
                <div><dt>Vault ID</dt><dd>{vault.id}</dd></div>
              </dl>
            </article>
          {/each}
        </div>
      </section>
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
    transform: translateY(-50%);
  }

  .menu-heading,
  .section-heading,
  .eyebrow {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    text-transform: uppercase;
    letter-spacing: 0.18em;
  }

  .menu-heading {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    margin: 0 0 0.9rem 0.75rem;
    color: #8b8b88;
    font-size: 0.6875rem;
  }

  .identity-menu ol {
    display: grid;
    gap: 0.55rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .identity-menu button {
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

  .identity-menu button::before {
    position: absolute;
    top: 50%;
    left: -0.75rem;
    width: 1px;
    height: 1.5rem;
    background: #4a4a48;
    content: '';
    transform: translateY(-50%);
  }

  .identity-menu button.active {
    background: linear-gradient(90deg, #1b1c1e 0%, transparent 100%);
    color: #f4f3f0;
  }

  .identity-menu button.active::before {
    height: 3.5rem;
    background: #ff6b3d;
  }

  .identity-menu button:focus-visible {
    outline: 1px solid #8b8b88;
    outline-offset: -1px;
  }

  .identity-mark,
  .hub-mark,
  .device-icon,
  .vault-icon {
    display: grid;
    place-items: center;
    border: 1px solid #3a3b3d;
    border-radius: 999px;
  }

  .identity-mark { width: 2.75rem; height: 2.75rem; }
  .identity-menu button.active .identity-mark { border-color: #c9c8c4; }
  .identity-copy { min-width: 0; }
  .identity-copy strong, .identity-copy small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .identity-copy strong { color: inherit; font-size: 0.875rem; font-weight: 500; }
  .identity-copy small { margin-top: 0.2rem; color: #555653; font-size: 0.6875rem; }
  .identity-count { color: #6d6d6a; font-family: ui-monospace, monospace; font-size: 0.625rem; }

  .page {
    min-height: 100svh;
    padding: 6.5rem 5rem 5rem 22rem;
  }

  .eyebrow { margin: 0; color: #ff6b3d; font-size: 0.625rem; }
  h1 { max-width: 56rem; margin: 1.25rem 0 0; font-size: clamp(2.5rem, 5vw, 4.5rem); line-height: 1.02; font-weight: 500; letter-spacing: -0.045em; }
  .lede { max-width: 42rem; margin: 1.25rem 0 0; color: #777774; font-size: 0.875rem; line-height: 1.6; }

  .bridge {
    display: grid;
    grid-template-columns: minmax(12rem, 15rem) 8rem minmax(17rem, 1fr);
    gap: 0;
    margin-top: 3.5rem;
    align-items: center;
  }

  .section-heading {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    padding-bottom: 0.75rem;
    color: #777774;
    font-size: 0.625rem;
  }

  .device-stack, .vault-stack { display: grid; gap: 0.65rem; }
  .device-row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.7rem;
    min-height: 4.2rem;
    padding: 0.65rem 0.75rem;
    border: 1px solid #252628;
    border-radius: 0.375rem;
    background: #0d0e10;
  }
  .device-icon { width: 2rem; height: 2rem; color: #8b8b88; }
  .device-copy strong, .device-copy small { display: block; }
  .device-copy strong { font-size: 0.8125rem; font-weight: 500; }
  .device-copy small { margin-top: 0.15rem; color: #686966; font-size: 0.625rem; }
  .key-count { display: flex; align-items: center; gap: 0.25rem; color: #777774; font-family: ui-monospace, monospace; font-size: 0.625rem; }

  .identity-hub {
    position: relative;
    display: grid;
    place-items: center;
    align-content: center;
    min-height: 13rem;
    text-align: center;
  }
  .hub-mark { width: 4.25rem; height: 4.25rem; color: #f4f3f0; border-color: #8b8b88; background: #101113; }
  .identity-hub strong { margin-top: 0.65rem; font-size: 0.8125rem; font-weight: 500; }
  .identity-hub small { margin-top: 0.2rem; color: #6d6d6a; font-family: ui-monospace, monospace; font-size: 0.625rem; }
  .hub-line { position: absolute; top: 50%; width: 2rem; height: 1px; background: #3a3b3d; }
  .hub-line.left { left: 0; }
  .hub-line.right { right: 0; background: #ff6b3d; }

  .vault-stack { grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr)); }
  .vault-card { padding: 0.9rem; border: 1px solid #303134; border-radius: 0.375rem; background: linear-gradient(145deg, #141517, #101113); }
  .vault-topline { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
  .vault-icon { width: 2.2rem; height: 2.2rem; color: #b2b1ad; }
  .grant-proof { display: flex; align-items: center; gap: 0.3rem; color: #c57b60; font-family: ui-monospace, monospace; font-size: 0.625rem; text-transform: uppercase; letter-spacing: 0.1em; }
  .vault-card h2 { margin: 0.75rem 0 0; font-size: 1rem; font-weight: 500; }
  .vault-card > p { margin: 0.2rem 0 0; color: #777774; font-size: 0.75rem; }
  .vault-card dl { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.75rem; margin: 0.75rem 0 0; padding-top: 0.65rem; border-top: 1px solid #292a2c; }
  .vault-card dl div { display: grid; gap: 0.2rem; min-width: 0; font-size: 0.625rem; }
  .vault-card dt { color: #686966; }
  .vault-card dd { overflow: hidden; margin: 0; color: #a5a5a1; font-family: ui-monospace, monospace; text-overflow: ellipsis; white-space: nowrap; }

  @media (width < 70rem) {
    .page { padding-right: 2rem; }
    .bridge { grid-template-columns: minmax(11rem, 13rem) 6rem minmax(15rem, 1fr); }
    .vault-stack { grid-template-columns: 1fr; }
  }

  @media (width < 48rem) {
    .identity-menu { position: relative; top: auto; left: auto; width: auto; padding: 7rem 1.25rem 0; transform: none; }
    .identity-menu ol { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .identity-menu button { display: grid; min-height: 3rem; grid-template-columns: 1fr; justify-items: center; margin: 0; padding: 0.3rem; border-radius: 999px; }
    .identity-menu button::before { top: auto; bottom: -0.45rem; left: 50%; width: 1.5rem; height: 1px; transform: translateX(-50%); }
    .identity-menu button.active::before { width: 3rem; height: 1px; }
    .identity-copy, .identity-count { display: none; }
    .page { min-height: auto; padding: 3rem 1.25rem 5rem; }
    .bridge { grid-template-columns: 1fr; gap: 1.25rem; }
    .identity-hub { min-height: 8rem; }
    .hub-line { display: none; }
    .evidence-column { order: 3; }
    .identity-hub { order: 1; }
    .vault-column { order: 2; }
  }
</style>
