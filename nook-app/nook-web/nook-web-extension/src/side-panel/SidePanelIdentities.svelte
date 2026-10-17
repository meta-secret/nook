<!--
The identities this extension is connected to and their vaults, compact:
the vault picture lives in the Nook tab and the web app. Connecting another
identity continues in the Nook tab.
-->
<script lang="ts">
  import { Plus } from '@lucide/svelte'
  import {
    I18N_KEYS,
    type I18nKey,
  } from '../../../nook-web-shared/src/generated/i18n-keys'
  import {
    ExtensionTranslationRequestKind,
    type ExtensionI18n,
    type ExtensionTranslationRequest,
    extensionLocaleCatalog,
  } from '../lib/i18n'
  import type { ExtensionSessionDeviceState } from '../lib/nook-wasm'
  import type { PairedVaultGroup } from '../lib/paired-vaults'
  import { IdentitySyncKind, type IdentitySync } from '../popup/popup-app-state'
  import {
    SidePanelHandOffKind,
    SidePanelHandOffTrigger,
    SidePanelIdentityRelation,
    SidePanelViews,
    type SidePanelHandOff,
  } from './side-panel-state'

  type SidePanelIdentitiesProps = {
    readonly i18n: ExtensionI18n
    readonly groups: readonly PairedVaultGroup[]
    readonly device: ExtensionSessionDeviceState
    readonly identitySync: IdentitySync
    readonly handOff: SidePanelHandOff
    readonly onconnect: () => void
  }

  let {
    i18n,
    groups,
    device,
    identitySync,
    handOff,
    onconnect,
  }: SidePanelIdentitiesProps = $props()

  function translatePlain(key: I18nKey): string {
    return i18n.t(extensionLocaleCatalog.plainExtensionTranslation(key))
  }

  function awaitingNote(awaitingGrant: number): string {
    const request: ExtensionTranslationRequest = {
      kind: ExtensionTranslationRequestKind.WithReplacements,
      key: I18N_KEYS.ExtensionCompanionIdentitySyncAwaiting,
      replacements: { count: String(awaitingGrant) },
    }
    return i18n.t(request)
  }

  function relation(group: PairedVaultGroup): SidePanelIdentityRelation {
    const request: Parameters<typeof SidePanelViews.identityRelation>[0] = {
      group,
      device,
    }
    return SidePanelViews.identityRelation(request)
  }

  const connecting = $derived(
    handOff.kind !== SidePanelHandOffKind.Idle &&
      handOff.trigger === SidePanelHandOffTrigger.ConnectIdentity,
  )
</script>

<section
  class="side-panel-section side-panel-identities"
  aria-labelledby="side-panel-identities-heading"
  data-testid="side-panel-identities"
>
  <h2 id="side-panel-identities-heading" class="side-panel-label">
    {translatePlain(I18N_KEYS.ExtensionActionIdentities)}
  </h2>
  {#if identitySync.kind === IdentitySyncKind.Checking}
    <p class="side-panel-note" role="status" data-testid="side-panel-sync">
      {translatePlain(I18N_KEYS.ExtensionCompanionIdentitySyncChecking)}
    </p>
  {:else if identitySync.kind === IdentitySyncKind.Checked && identitySync.awaitingGrant > 0}
    <p class="side-panel-note" data-testid="side-panel-sync">
      {awaitingNote(identitySync.awaitingGrant)}
    </p>
  {:else if identitySync.kind === IdentitySyncKind.Failed}
    <p class="error-message" role="alert" data-testid="side-panel-sync">
      {translatePlain(I18N_KEYS.ExtensionCompanionIdentitySyncFailed)}
    </p>
  {/if}
  <ul class="side-panel-identity-list">
    {#each groups as group (`${group.deviceId}:${group.identityLabel}`)}
      <li
        class="side-panel-identity"
        class:is-other={relation(group) === SidePanelIdentityRelation.Other}
        data-testid="side-panel-identity"
      >
        <span class="side-panel-identity-name">
          {group.identityLabel ||
            translatePlain(I18N_KEYS.ExtensionCompanionOtherVaults)}
        </span>
        {#if relation(group) === SidePanelIdentityRelation.Other}
          <span class="side-panel-tag">
            {translatePlain(I18N_KEYS.ExtensionActionOtherIdentity)}
          </span>
        {/if}
        <ul class="side-panel-vaults">
          {#each group.vaults as vault (vault.vaultStoreId)}
            <li class="side-panel-vault" class:is-default={vault.isDefault}>
              {vault.vaultName ||
                translatePlain(I18N_KEYS.LoginVaultPickerUnnamed)}
              {#if vault.isDefault}
                <span class="side-panel-sr-only">
                  ({translatePlain(I18N_KEYS.ExtensionCompanionDefaultVault)})
                </span>
              {/if}
            </li>
          {/each}
        </ul>
      </li>
    {/each}
  </ul>
  <button
    type="button"
    class="side-panel-text-button"
    aria-busy={connecting && handOff.kind === SidePanelHandOffKind.Opening}
    aria-disabled={handOff.kind === SidePanelHandOffKind.Opening}
    data-testid="side-panel-connect"
    onclick={onconnect}
  >
    <Plus size={14} aria-hidden="true" />
    {translatePlain(I18N_KEYS.ExtensionActionConnectAnother)}
  </button>
  {#if connecting && handOff.kind === SidePanelHandOffKind.Continued}
    <p class="side-panel-note" role="status" data-testid="side-panel-handoff">
      {translatePlain(I18N_KEYS.ExtensionActionContinueInTab)}
    </p>
  {:else if connecting && handOff.kind === SidePanelHandOffKind.Failed}
    <p class="error-message" role="alert" data-testid="side-panel-error">
      {translatePlain(I18N_KEYS.ExtensionActionOpenFailed)}
    </p>
  {/if}
</section>
