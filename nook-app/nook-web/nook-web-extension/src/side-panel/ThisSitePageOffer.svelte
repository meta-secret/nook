<!--
Rust's offer for the page itself: on an authenticator setup page, "Add 2FA
from this page". The click asks the service worker to start the page
widget's consented enrollment; the panel sends only its window and shows
whether the review started on the page. No secret reaches the panel.
-->
<script lang="ts">
  import type { I18nKey } from '../../../nook-web-shared/src/generated/i18n-keys'
  import type { SiteSecretPageOffer } from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
  import {
    ExtensionTranslationRequestKind,
    type ExtensionI18n,
    type ExtensionTranslationRequest,
    extensionLocaleCatalog,
  } from '../lib/i18n'
  import {
    sidePanelSite,
    type SidePanelWindowSelection,
  } from '../lib/side-panel-site'
  import {
    SidePanelWindowKind,
    type SidePanelWindow,
  } from './side-panel-runtime'
  import {
    ThisSitePageOfferStatus,
    ThisSitePageOfferViews,
  } from './this-site-page-offer'

  type ThisSitePageOfferProps = {
    readonly i18n: ExtensionI18n
    readonly offer: SiteSecretPageOffer
    readonly panelWindow: SidePanelWindow
  }

  let { i18n, offer, panelWindow }: ThisSitePageOfferProps = $props()

  let status = $state(ThisSitePageOfferStatus.Idle)

  function translatePlain(key: I18nKey): string {
    return i18n.t(extensionLocaleCatalog.plainExtensionTranslation(key))
  }

  function translateSelected(key: string): string {
    const request: ExtensionTranslationRequest = {
      kind: ExtensionTranslationRequestKind.Selected,
      key,
    }
    return i18n.t(request)
  }

  async function add(): Promise<void> {
    switch (status) {
      case ThisSitePageOfferStatus.Pending:
        return
      case ThisSitePageOfferStatus.Idle:
      case ThisSitePageOfferStatus.Started:
      case ThisSitePageOfferStatus.Missing:
        break
    }
    switch (panelWindow.kind) {
      case SidePanelWindowKind.Resolving:
      case SidePanelWindowKind.Unknown:
        return
      case SidePanelWindowKind.Known:
        break
    }
    status = ThisSitePageOfferStatus.Pending
    const selection: SidePanelWindowSelection = { windowId: panelWindow.id }
    const outcome = await sidePanelSite.addAuthenticator(selection)
    status = ThisSitePageOfferViews.status(outcome.kind)
  }
</script>

{#if 'label_key' in offer}
  <div class="side-panel-site-status" data-testid="side-panel-page-offer">
    <button
      type="button"
      class="side-panel-fill"
      aria-disabled={status === ThisSitePageOfferStatus.Pending}
      data-testid="side-panel-add-authenticator"
      onclick={() => void add()}
    >
      {translateSelected(offer.label_key)}
    </button>
    {#if status === ThisSitePageOfferStatus.Started || status === ThisSitePageOfferStatus.Missing}
      <p
        role="status"
        data-testid="side-panel-add-authenticator-status"
        data-status={status}
      >
        {translatePlain(ThisSitePageOfferViews.statusKey(status))}
      </p>
    {/if}
  </div>
{/if}
