<!--
A browser extension asking to connect, shown beside the identity card while
this browser is locked. It names the extension device and the access it
asks for. The extension joins the identity, not one vault, so the one action
unlocks the identity; its selected vault (or first one here) opens behind it
for the approval step that follows.
-->
<script lang="ts">
  import { Fingerprint, KeyRound, Puzzle } from '@lucide/svelte'
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import { Button } from '$lib/components/ui/button'
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

  <!-- The one action leads, right under the request; what the request names
       follows, recessed, for whoever wants to check it. -->
  <section class="grid gap-2">
    {#if approvalVault}
      <!-- No arrow: the extension's side panel points here, at this button;
           an arrow back toward the panel would contradict it. -->
      <Button
        type="button"
        size="lg"
        class="h-12 w-full px-6 text-base sm:max-w-md"
        data-testid="extension-request-unlock"
        data-store-id={approvalVault.storeId}
        disabled={busy}
        onclick={() => onConnect(approvalVault.storeId)}
      >
        {#if card.keyKind === IdentityKeyKind.Pin}
          <KeyRound class="size-5" aria-hidden="true" />
        {:else}
          <Fingerprint class="size-5" aria-hidden="true" />
        {/if}
        {unlockLabel}
      </Button>
      <p class="text-xs text-muted-foreground">
        {vault.t(I18N_KEYS.ExtensionRequestVaultAction)}
      </p>
    {:else}
      <p class="text-sm text-muted-foreground">
        {vault.t(I18N_KEYS.ExtensionRequestNoVaults)}
      </p>
    {/if}
  </section>

  <dl class="nk-subpanel-recessed grid gap-3 p-4 text-sm sm:grid-cols-2">
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
</div>
