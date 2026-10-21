<!--
Under This site's identity:vault sections: what the identity check after an
unlock found, and Connect another identity as the card's action row. It
starts the connect at once and shows the connect card in place while it
runs; the sections already name every connected identity and vault.
-->
<script lang="ts">
  import { Plus } from '@lucide/svelte'
  import {
    I18N_KEYS,
    type I18nKey,
  } from '../../../nook-web-shared/src/generated/i18n-keys'
  import { type ExtensionI18n, extensionLocaleCatalog } from '../lib/i18n'
  import type { IdentitySync } from '../popup/popup-app-state'
  import SidePanelConnectCard from './SidePanelConnectCard.svelte'
  import SidePanelIdentitySync from './SidePanelIdentitySync.svelte'
  import {
    SidePanelConnectCardPlacement,
    type SidePanelConnect,
    type SidePanelTabPointer,
  } from './side-panel-connect-state'

  type SidePanelConnectionsProps = {
    readonly i18n: ExtensionI18n
    readonly identitySync: IdentitySync
    readonly connect: SidePanelConnect
    /** Where the Nook tab is from the panel, for the card's tab guide. */
    readonly pointer: SidePanelTabPointer
    /** The connect card is open under the sections. */
    readonly cardShown: boolean
    readonly onconnect: () => void
    readonly onfocustab: () => void
    readonly onclose: () => void
  }

  let {
    i18n,
    identitySync,
    connect,
    pointer,
    cardShown,
    onconnect,
    onfocustab,
    onclose,
  }: SidePanelConnectionsProps = $props()

  function translatePlain(key: I18nKey): string {
    return i18n.t(extensionLocaleCatalog.plainExtensionTranslation(key))
  }
</script>

<div
  class="side-panel-section side-panel-connections"
  data-testid="side-panel-connections"
>
  {#if cardShown}
    <SidePanelConnectCard
      {i18n}
      placement={SidePanelConnectCardPlacement.Another}
      {connect}
      {pointer}
      {identitySync}
      {onconnect}
      {onfocustab}
      {onclose}
    />
  {:else}
    <SidePanelIdentitySync {i18n} {identitySync} />
    <div class="side-panel-action-bar side-panel-action-row">
      <button
        type="button"
        data-testid="side-panel-connect"
        onclick={onconnect}
      >
        <Plus size={14} aria-hidden="true" />
        {translatePlain(I18N_KEYS.ExtensionActionConnectAnother)}
      </button>
    </div>
  {/if}
</div>
