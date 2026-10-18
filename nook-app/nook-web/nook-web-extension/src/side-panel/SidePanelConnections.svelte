<!--
Under This site's identity:vault sections: what the identity check after an
unlock found, and Connect another identity with its hand-off line. The
sections already name every connected identity and vault; connecting another
identity continues in the Nook tab.
-->
<script lang="ts">
  import { Plus } from '@lucide/svelte'
  import {
    I18N_KEYS,
    type I18nKey,
  } from '../../../nook-web-shared/src/generated/i18n-keys'
  import { type ExtensionI18n, extensionLocaleCatalog } from '../lib/i18n'
  import type { IdentitySync } from '../popup/popup-app-state'
  import SidePanelIdentitySync from './SidePanelIdentitySync.svelte'
  import {
    SidePanelHandOffKind,
    SidePanelHandOffTrigger,
    type SidePanelHandOff,
  } from './side-panel-state'

  type SidePanelConnectionsProps = {
    readonly i18n: ExtensionI18n
    readonly identitySync: IdentitySync
    readonly handOff: SidePanelHandOff
    readonly onconnect: () => void
  }

  let { i18n, identitySync, handOff, onconnect }: SidePanelConnectionsProps =
    $props()

  function translatePlain(key: I18nKey): string {
    return i18n.t(extensionLocaleCatalog.plainExtensionTranslation(key))
  }

  const connecting = $derived(
    handOff.kind !== SidePanelHandOffKind.Idle &&
      handOff.trigger === SidePanelHandOffTrigger.ConnectIdentity,
  )
</script>

<div
  class="side-panel-section side-panel-connections"
  data-testid="side-panel-connections"
>
  <SidePanelIdentitySync {i18n} {identitySync} />
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
</div>
