<!--
Reading this as: Operate-mode Access browse chrome for Identity versus Vault,
preserving Identity Bridge evidence language, as a compact top strip so graph
and list can use the full column, interaction priority scan-and-act.
-->
<script lang="ts">
  import { Fingerprint, KeyRound, Vault as VaultIcon } from '@lucide/svelte'
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import type { VaultState } from '$lib/vault.svelte'
  import type { VaultAccessView } from './access-chain'
  import {
    IdentityBridgePerspective,
    IdentityBridgeVaultSelectionKind,
    type IdentityBridgeVaultSelection,
  } from './identity-bridge-model'

  let {
    vault,
    perspective,
    selectedVault,
    vaults,
    onPerspective,
    onVault,
  }: {
    vault: VaultState
    perspective: IdentityBridgePerspective
    selectedVault: IdentityBridgeVaultSelection
    vaults: readonly VaultAccessView[]
    onPerspective: (perspective: IdentityBridgePerspective) => void
    onVault: (storeId: string) => void
  } = $props()

  function storeFingerprint(storeId: string): string {
    return storeId.length <= 12
      ? storeId
      : `${storeId.slice(0, 6)}…${storeId.slice(-4)}`
  }
</script>

<nav
  class="bridge-menu"
  aria-label={vault.t(I18N_KEYS.DevicesAccessBridgeBrowseBy)}
>
  <p class="menu-label">{vault.t(I18N_KEYS.DevicesAccessBridgeBrowseBy)}</p>
  <div class="perspective-switch">
    <button
      type="button"
      class:active={perspective === IdentityBridgePerspective.Identities}
      aria-pressed={perspective === IdentityBridgePerspective.Identities}
      data-testid="devices-access-perspective-identities"
      onclick={() => onPerspective(IdentityBridgePerspective.Identities)}
    >
      <Fingerprint class="size-4" aria-hidden="true" />
      {vault.t(I18N_KEYS.DevicesAccessBridgeIdentity)}
    </button>
    <button
      type="button"
      class:active={perspective === IdentityBridgePerspective.Vaults}
      aria-pressed={perspective === IdentityBridgePerspective.Vaults}
      data-testid="devices-access-perspective-vaults"
      onclick={() => onPerspective(IdentityBridgePerspective.Vaults)}
    >
      <VaultIcon class="size-4" aria-hidden="true" />
      {vault.t(I18N_KEYS.DevicesAccessBridgeVault)}
    </button>
  </div>

  {#if perspective === IdentityBridgePerspective.Vaults && vaults.length === 0}
    <p class="empty-list">{vault.t(I18N_KEYS.DevicesAccessNoVaultsReady)}</p>
  {:else if perspective === IdentityBridgePerspective.Vaults}
    <ol>
      {#each vaults as vaultEntry (vaultEntry.storeId)}
        <li>
          <button
            type="button"
            class:active={selectedVault.kind ===
              IdentityBridgeVaultSelectionKind.Selected &&
              vaultEntry.storeId === selectedVault.storeId}
            class="entity"
            aria-current={selectedVault.kind ===
              IdentityBridgeVaultSelectionKind.Selected &&
            vaultEntry.storeId === selectedVault.storeId
              ? 'page'
              : 'false'}
            onclick={() => onVault(vaultEntry.storeId)}
          >
            <span class="entity-mark"
              ><VaultIcon class="size-4" aria-hidden="true" /></span
            >
            <span class="entity-copy">
              <strong>{vaultEntry.label}</strong>
              <small
                >{vaultEntry.verified
                  ? vault.t(I18N_KEYS.DevicesAccessRouteVerified)
                  : vault.t(I18N_KEYS.DevicesAccessRouteUnverified)}</small
              >
              <small class="entity-id" title={vaultEntry.storeId}
                >{storeFingerprint(vaultEntry.storeId)}</small
              >
            </span>
            <span class="entity-count" aria-hidden="true"
              ><KeyRound class="size-3" aria-hidden="true" />{vaultEntry.verified
                ? 1
                : 0}</span
            >
            <span class="sr-only">
              {(() => {
                const translationRequest: Parameters<typeof vault.t>[0] = {
                  key: I18N_KEYS.DevicesAccessBridgeVerifiedDeviceKeyCount,
                  replacements: {
                    count: vaultEntry.verified ? '1' : '0',
                  },
                }
                return vault.t(translationRequest)
              })()}
            </span>
          </button>
        </li>
      {/each}
    </ol>
  {/if}
</nav>

<style>
  .bridge-menu {
    display: grid;
    min-width: 0;
    gap: 0.75rem;
  }
  .menu-label {
    margin: 0;
    color: var(--muted-foreground);
    font-family: ui-monospace, monospace;
    font-size: 0.625rem;
    letter-spacing: 0.16em;
    text-transform: uppercase;
  }
  .perspective-switch {
    display: inline-grid;
    width: min(22rem, 100%);
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.3rem;
  }
  .perspective-switch button,
  .entity {
    position: relative;
    border: 0;
    background: transparent;
    color: var(--muted-foreground);
    text-align: left;
  }
  .perspective-switch button {
    display: flex;
    min-height: 2.9rem;
    align-items: center;
    gap: 0.45rem;
    padding: 0.55rem 0.7rem 0.55rem 0.9rem;
    font-family: ui-monospace, monospace;
    font-size: 0.6875rem;
    letter-spacing: 0.07em;
    text-transform: uppercase;
  }
  .perspective-switch button::before,
  .entity::before {
    position: absolute;
    top: 50%;
    left: 0;
    width: 1px;
    height: 1.25rem;
    background: var(--border);
    content: '';
    transform: translateY(-50%);
  }
  .perspective-switch button.active {
    background: linear-gradient(
      90deg,
      color-mix(in oklab, var(--muted) 70%, transparent),
      transparent
    );
    color: var(--foreground);
  }
  .perspective-switch button.active::before {
    height: 2rem;
    background: var(--primary);
  }
  ol {
    display: flex;
    min-width: 0;
    gap: 0.45rem;
    margin: 0;
    padding: 0.15rem 0;
    overflow-x: auto;
    list-style: none;
  }
  ol li {
    min-width: min(16rem, 78vw);
  }
  .entity {
    display: grid;
    width: 100%;
    min-height: 3.5rem;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.65rem;
    padding: 0.45rem 0.8rem 0.45rem 1rem;
    border-radius: 2.5rem;
  }
  .entity::before {
    left: 0.15rem;
    height: 1.5rem;
  }
  .entity.active {
    background: linear-gradient(
      90deg,
      color-mix(in oklab, var(--muted) 75%, transparent),
      transparent
    );
    color: var(--foreground);
  }
  .entity.active::before {
    height: 2.5rem;
    background: var(--primary);
  }
  .entity-mark {
    display: grid;
    width: 2.25rem;
    height: 2.25rem;
    place-items: center;
    border: 1px solid var(--border);
    border-radius: 999px;
  }
  .active .entity-mark {
    border-color: color-mix(in oklab, var(--foreground) 65%, transparent);
  }
  .entity-copy {
    min-width: 0;
  }
  .entity-copy strong,
  .entity-copy small {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .entity-copy .entity-id {
    color: color-mix(in oklab, var(--muted-foreground) 72%, transparent);
    font-family: ui-monospace, monospace;
    font-size: 0.59375rem;
    letter-spacing: 0.035em;
  }
  .entity-copy strong {
    font-size: 0.875rem;
    font-weight: 550;
  }
  .entity-copy small {
    margin-top: 0.15rem;
    color: var(--muted-foreground);
    font-size: 0.6875rem;
  }
  .entity-count {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    font-family: ui-monospace, monospace;
    font-size: 0.625rem;
  }
  .empty-list {
    margin: 0;
    color: var(--muted-foreground);
    font-size: 0.75rem;
    line-height: 1.5;
  }
  button {
    cursor: pointer;
  }
  button:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
  }
  @media (width < 40rem) {
    .perspective-switch {
      width: 100%;
    }
  }
</style>
