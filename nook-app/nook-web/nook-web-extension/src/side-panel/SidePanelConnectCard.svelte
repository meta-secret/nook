<!--
Connecting an identity, as a companion keytag card. One action opens (or
reuses) the Nook tab on the connect route; creating, joining and choosing
the identity happen there. With no identity connected the panel takes that
action itself, once, so the card's button returns only after the tab closes
or the connect fails. While that tab is open the card follows the step
the page reports and, once another tab covers it, offers to bring it back
to the front. The card leads
the panel while no identity is connected and opens under This site from
Connect another identity. While the next step is on the Nook tab, the tab
guide sits right on top of the card.
-->
<script lang="ts">
  import { ArrowUpRight, LoaderCircle, Plus, X } from '@lucide/svelte'
  import {
    I18N_KEYS,
    type I18nKey,
  } from '../../../nook-web-shared/src/generated/i18n-keys'
  import { type ExtensionI18n, extensionLocaleCatalog } from '../lib/i18n'
  import type { IdentitySync } from '../popup/popup-app-state'
  import SidePanelIdentitySync from './SidePanelIdentitySync.svelte'
  import SidePanelTabGuide from './SidePanelTabGuide.svelte'
  import {
    SidePanelConnectCardPlacement,
    SidePanelConnectKind,
    SidePanelConnects,
    SidePanelTabPlace,
    SidePanelTabPointer,
    type SidePanelConnect,
  } from './side-panel-connect-state'

  type SidePanelConnectCardProps = {
    readonly i18n: ExtensionI18n
    readonly placement: SidePanelConnectCardPlacement
    readonly connect: SidePanelConnect
    /** Where the Nook tab is from the panel; None shows no guide. */
    readonly pointer: SidePanelTabPointer
    readonly identitySync: IdentitySync
    readonly onconnect: () => void
    readonly onfocustab: () => void
    readonly onclose: () => void
  }

  let {
    i18n,
    placement,
    connect,
    pointer,
    identitySync,
    onconnect,
    onfocustab,
    onclose,
  }: SidePanelConnectCardProps = $props()

  function translatePlain(key: I18nKey): string {
    return i18n.t(extensionLocaleCatalog.plainExtensionTranslation(key))
  }

  const starting = $derived(connect.kind === SidePanelConnectKind.Starting)

  function title(): I18nKey {
    switch (placement) {
      case SidePanelConnectCardPlacement.First:
        return I18N_KEYS.ExtensionCompanionNoVaultsTitle
      case SidePanelConnectCardPlacement.Another:
        return I18N_KEYS.ExtensionCompanionConnectAnother
    }
  }

  function start(): void {
    if (starting) return
    onconnect()
  }
</script>

{#if pointer !== SidePanelTabPointer.None}
  <SidePanelTabGuide {i18n} {pointer} {onfocustab} />
{/if}
<section
  class="side-panel-keytag side-panel-connect-card"
  aria-labelledby="side-panel-connect-title"
  aria-busy={starting}
  data-testid="side-panel-connect-card"
  data-placement={placement}
  data-connect={connect.kind}
>
  <div class="side-panel-keytag-body">
    <div class="side-panel-keytag-heading">
      <h2 id="side-panel-connect-title" class="side-panel-label">
        {translatePlain(title())}
      </h2>
      {#if placement === SidePanelConnectCardPlacement.Another && !starting}
        <button
          type="button"
          class="side-panel-icon-button side-panel-keytag-close"
          aria-label={translatePlain(
            I18N_KEYS.ExtensionDeviceSetupIdentityKeyCancel,
          )}
          title={translatePlain(
            I18N_KEYS.ExtensionDeviceSetupIdentityKeyCancel,
          )}
          data-testid="side-panel-connect-close"
          onclick={onclose}
        >
          <X size={14} aria-hidden="true" />
        </button>
      {/if}
    </div>
    {#if connect.kind === SidePanelConnectKind.InTab}
      <p
        class="side-panel-note"
        role="status"
        aria-live="polite"
        data-testid="side-panel-connect-step"
        data-step={connect.follow.kind}
      >
        {translatePlain(SidePanelConnects.followLine(connect.follow))}
      </p>
    {:else}
      <p class="side-panel-keytag-copy">
        {translatePlain(I18N_KEYS.ExtensionConnectTabBody)}
      </p>
    {/if}
    <SidePanelIdentitySync {i18n} {identitySync} />
    {#if connect.kind === SidePanelConnectKind.Failed}
      <p class="error-message" role="alert" data-testid="side-panel-error">
        {translatePlain(SidePanelConnects.failureAlert(connect.failure))}
      </p>
    {/if}
  </div>
  {#if connect.kind === SidePanelConnectKind.InTab}
    <!-- The Nook tab in front needs no action; the step line says what to do. -->
    {#if connect.place === SidePanelTabPlace.Behind}
      <div class="side-panel-action-bar">
        <button
          type="button"
          class="is-primary"
          data-testid="side-panel-connect-focus-tab"
          onclick={onfocustab}
        >
          {translatePlain(I18N_KEYS.ExtensionConnectTabShowTab)}
          <ArrowUpRight size={14} aria-hidden="true" />
        </button>
      </div>
    {/if}
  {:else}
    <div class="side-panel-action-bar">
      <button
        type="button"
        class="is-primary"
        aria-disabled={starting}
        data-testid="side-panel-connect-start"
        onclick={start}
      >
        {#if starting}
          <LoaderCircle size={14} class="side-panel-spin" aria-hidden="true" />
        {:else}
          <Plus size={14} aria-hidden="true" />
        {/if}
        {translatePlain(I18N_KEYS.ExtensionActionConnectIdentity)}
      </button>
    </div>
  {/if}
</section>
