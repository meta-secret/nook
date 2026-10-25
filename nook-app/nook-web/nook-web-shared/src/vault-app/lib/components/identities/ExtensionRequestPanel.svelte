<!--
A browser extension asking to connect, shown beside the identity card while
this browser is locked. It names the extension device and the access it
asks for. The extension joins the identity, not one vault, so the one action
unlocks the identity; its selected vault (or first one here) opens behind it
for the approval step that follows.
-->
<script lang="ts">
  import { Check, Fingerprint, KeyRound, Puzzle } from '@lucide/svelte'
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

  <!-- One request card in two halves: the action on the left, as a large
       steel card, and the facts it is acting on, recessed, on the right.
       No arrow on the action: the extension's side panel points here, and an
       arrow back toward the panel would read as the opposite direction. -->
  <section class="grid gap-3 lg:grid-cols-2">
    {#if approvalVault}
      <Button
        type="button"
        class="h-auto min-h-40 w-full flex-col items-start justify-between gap-6 whitespace-normal p-5 text-left [&_svg]:size-6"
        data-testid="extension-request-unlock"
        data-store-id={approvalVault.storeId}
        disabled={busy}
        onclick={() => onConnect(approvalVault.storeId)}
      >
        <span
          class="grid size-12 place-items-center border border-current/25"
          aria-hidden="true"
        >
          {#if card.keyKind === IdentityKeyKind.Pin}
            <KeyRound class="size-6" />
          {:else}
            <Fingerprint class="size-6" />
          {/if}
        </span>
        <span class="grid gap-1">
          <span class="text-lg font-semibold tracking-tight">{unlockLabel}</span>
          <span class="text-sm font-normal opacity-75">
            {vault.t(I18N_KEYS.ExtensionRequestVaultAction)}
          </span>
        </span>
      </Button>
    {:else}
      <p
        class="nk-subpanel-recessed p-5 text-sm text-pretty text-muted-foreground"
      >
        {vault.t(I18N_KEYS.ExtensionRequestNoVaults)}
      </p>
    {/if}

    <dl class="nk-subpanel-recessed grid content-start gap-4 p-5 text-sm">
      <div class="grid gap-1.5">
        <dt class="nk-subpanel-head">
          {vault.t(I18N_KEYS.ExtensionConsentDevice)}
        </dt>
        <dd
          class="font-mono text-sm tracking-[0.08em] text-foreground"
          data-testid="extension-request-device"
        >
          {deviceGroups.join(' ')}
        </dd>
      </div>
      <div class="grid gap-1.5">
        <dt class="nk-subpanel-head">
          {vault.t(I18N_KEYS.ExtensionConsentRequestedAccess)}
        </dt>
        <dd>
          <ul class="grid gap-1.5">
            {#each request.scopes as scope (scope)}
              <li class="flex items-center gap-2 text-foreground">
                <Check
                  class="size-3.5 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                {vault.t(new ExtensionConsentScopeTranslation(scope).key)}
              </li>
            {/each}
          </ul>
        </dd>
      </div>
    </dl>
  </section>
</div>
