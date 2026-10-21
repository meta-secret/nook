<!--
A browser extension asking to connect, shown beside the identity card while
this browser is locked. It names the extension device and the access it
asks for. The extension joins the identity, not one vault, so the one action
unlocks the identity; its selected vault (or first one here) opens behind it
for the approval step that follows.
-->
<script lang="ts">
  import { ArrowRight, Fingerprint, KeyRound, Puzzle } from '@lucide/svelte'
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import type { ExtensionConnectRequest } from '$lib/extension/connect'
  import type { VaultState } from '$lib/vault.svelte'
  import { ExtensionConsentScopeTranslation } from '../extension-connect-consent-state'
  import {
    IdentityKeyKind,
    IdentityVaultRowState,
    type IdentityCardView,
  } from './identity-card-model'

  let {
    vault,
    request,
    card,
    selectedStoreId,
    busy = false,
    onConnect,
  }: {
    vault: VaultState
    request: ExtensionConnectRequest
    card: IdentityCardView
    /** The card's selected vault on this browser ("" when none). */
    selectedStoreId: string
    busy?: boolean
    /** Unlock the identity and open this vault; the approval step follows. */
    onConnect: (storeId: string) => void
  } = $props()

  const title = $derived.by(() => {
    const titleRequest: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.ExtensionRequestTitle,
      replacements: { label: request.deviceLabel },
    }
    return vault.t(titleRequest)
  })

  /** Only vaults this browser holds can be opened here. */
  const vaults = $derived(
    card.vaults.filter(
      (row) =>
        row.state === IdentityVaultRowState.Open ||
        row.state === IdentityVaultRowState.Available,
    ),
  )
  /** The vault the approval is made from: the selected one, else the first. */
  const approvalVault = $derived(
    vaults.find((row) => row.storeId === selectedStoreId) || vaults[0],
  )
  const unlockLabel = $derived.by(() => {
    const labelRequest: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.ExtensionRequestUnlockIdentity,
      replacements: { identity: card.label },
    }
    return vault.t(labelRequest)
  })

  /** The device id in groups of four, as fingerprints read elsewhere. */
  const deviceGroups = $derived(
    request.deviceId.toUpperCase().match(/.{1,4}/g) || [],
  )
</script>

<div
  class="grid min-w-0 content-start gap-6"
  data-testid="extension-request-panel"
>
  <header class="flex items-start gap-3">
    <span class="nk-vault-icon nk-vault-icon-open size-10" aria-hidden="true">
      <Puzzle class="size-4" />
    </span>
    <span class="grid min-w-0 gap-1">
      <span
        class="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground"
        >{vault.t(I18N_KEYS.ExtensionRequestEyebrow)}</span
      >
      <h2
        class="text-lg font-semibold tracking-tight text-foreground"
        data-testid="extension-request-title"
      >
        {title}
      </h2>
      <p class="max-w-[60ch] text-sm text-pretty text-muted-foreground">
        {vault.t(I18N_KEYS.ExtensionRequestBody)}
      </p>
    </span>
  </header>

  <dl class="grid gap-3 text-sm sm:grid-cols-2">
    <div class="grid gap-1">
      <dt
        class="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground"
      >
        {vault.t(I18N_KEYS.ExtensionConsentDevice)}
      </dt>
      <dd
        class="font-mono text-xs text-foreground"
        data-testid="extension-request-device"
      >
        {deviceGroups.join(' ')}
      </dd>
    </div>
    <div class="grid gap-1">
      <dt
        class="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground"
      >
        {vault.t(I18N_KEYS.ExtensionConsentRequestedAccess)}
      </dt>
      <dd class="flex flex-wrap gap-1.5">
        {#each request.scopes as scope (scope)}
          <span class="nk-tag border border-border px-1.5 py-0.5">
            {vault.t(new ExtensionConsentScopeTranslation(scope).key)}
          </span>
        {/each}
      </dd>
    </div>
  </dl>

  <section class="grid gap-3 border-t border-border pt-5">
    <h3
      class="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground"
    >
      {vault.t(I18N_KEYS.ExtensionRequestVaults)}
    </h3>
    {#if approvalVault}
      <button
        type="button"
        class="nk-identity-menu-item nk-plate group w-full border border-border disabled:cursor-default disabled:opacity-45"
        data-testid="extension-request-unlock"
        data-store-id={approvalVault.storeId}
        disabled={busy}
        onclick={() => onConnect(approvalVault.storeId)}
      >
        <span class="nk-vault-icon" aria-hidden="true">
          {#if card.keyKind === IdentityKeyKind.Pin}
            <KeyRound class="size-4" />
          {:else}
            <Fingerprint class="size-4" />
          {/if}
        </span>
        <span class="flex min-w-0 flex-1 flex-col">
          <span class="truncate text-sm font-medium text-foreground"
            >{unlockLabel}</span
          >
          <span class="truncate text-xs text-muted-foreground"
            >{vault.t(I18N_KEYS.ExtensionRequestVaultAction)}</span
          >
        </span>
        <ArrowRight
          class="size-4 flex-none text-muted-foreground transition-transform group-hover:translate-x-0.5"
          aria-hidden="true"
        />
      </button>
    {:else}
      <p class="text-sm text-muted-foreground">
        {vault.t(I18N_KEYS.ExtensionRequestNoVaults)}
      </p>
    {/if}
  </section>
</div>
