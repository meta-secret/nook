<!--
Connecting an identity, as a companion keytag card: the person names the
first vault of a new identity, or says they already use Nook. Either way
Nook's connect page opens on that same step, so it never shows its
first-vault screen unannounced. The card leads the panel while no identity
is connected and opens under This site from Connect another identity.
-->
<script lang="ts">
  import { ArrowRight, LoaderCircle, Plus, X } from '@lucide/svelte'
  import {
    I18N_KEYS,
    type I18nKey,
  } from '../../../nook-web-shared/src/generated/i18n-keys'
  import { type ExtensionI18n, extensionLocaleCatalog } from '../lib/i18n'
  import type { IdentitySync } from '../popup/popup-app-state'
  import SidePanelIdentitySync from './SidePanelIdentitySync.svelte'
  import {
    SidePanelConnectCardPlacement,
    SidePanelConnectKind,
    type SidePanelConnect,
  } from './side-panel-state'

  type SidePanelConnectCardProps = {
    readonly i18n: ExtensionI18n
    readonly placement: SidePanelConnectCardPlacement
    readonly connect: SidePanelConnect
    readonly identitySync: IdentitySync
    readonly oncreate: (typedName: string) => void
    readonly onjoin: () => void
    readonly onclose: () => void
  }

  let {
    i18n,
    placement,
    connect,
    identitySync,
    oncreate,
    onjoin,
    onclose,
  }: SidePanelConnectCardProps = $props()

  function translatePlain(key: I18nKey): string {
    return i18n.t(extensionLocaleCatalog.plainExtensionTranslation(key))
  }

  let name = $state('')
  const starting = $derived(connect.kind === SidePanelConnectKind.Starting)

  function title(): I18nKey {
    switch (placement) {
      case SidePanelConnectCardPlacement.First:
        return I18N_KEYS.ExtensionCompanionNoVaultsTitle
      case SidePanelConnectCardPlacement.Another:
        return I18N_KEYS.ExtensionCompanionConnectAnother
    }
  }

  function create(event: SubmitEvent): void {
    event.preventDefault()
    if (starting) return
    oncreate(name)
  }
</script>

<section
  class="side-panel-keytag side-panel-connect-card"
  aria-labelledby="side-panel-connect-title"
  aria-busy={starting}
  data-testid="side-panel-connect-card"
  data-placement={placement}
>
  <div class="side-panel-keytag-body">
    <div class="side-panel-keytag-heading">
      <h2 id="side-panel-connect-title" class="side-panel-label">
        {translatePlain(title())}
      </h2>
      {#if placement === SidePanelConnectCardPlacement.Another}
        <button
          type="button"
          class="side-panel-icon-button side-panel-keytag-close"
          aria-label={translatePlain(
            I18N_KEYS.ExtensionDeviceSetupIdentityKeyCancel,
          )}
          title={translatePlain(
            I18N_KEYS.ExtensionDeviceSetupIdentityKeyCancel,
          )}
          aria-disabled={starting}
          data-testid="side-panel-connect-close"
          onclick={onclose}
        >
          <X size={14} aria-hidden="true" />
        </button>
      {/if}
    </div>
    <p class="side-panel-keytag-copy">
      {translatePlain(I18N_KEYS.ExtensionCompanionConnectChoiceBody)}
    </p>
    <form
      id="side-panel-first-vault"
      class="side-panel-field"
      onsubmit={create}
    >
      <label for="side-panel-vault-name">
        {translatePlain(I18N_KEYS.FirstRunNameLabel)}
      </label>
      <input
        id="side-panel-vault-name"
        type="text"
        maxlength="64"
        autocomplete="off"
        placeholder={translatePlain(I18N_KEYS.FirstRunNamePlaceholder)}
        data-testid="side-panel-vault-name"
        bind:value={name}
        readonly={starting}
      />
    </form>
    <SidePanelIdentitySync {i18n} {identitySync} />
    {#if connect.kind === SidePanelConnectKind.Continued}
      <p class="side-panel-note" role="status" data-testid="side-panel-handoff">
        {translatePlain(I18N_KEYS.ExtensionActionContinueInTab)}
      </p>
    {:else if connect.kind === SidePanelConnectKind.Failed}
      <p class="error-message" role="alert" data-testid="side-panel-error">
        {translatePlain(I18N_KEYS.ExtensionActionOpenFailed)}
      </p>
    {/if}
  </div>
  <div class="side-panel-action-bar">
    <button
      type="submit"
      form="side-panel-first-vault"
      class="is-primary"
      aria-disabled={starting}
      data-testid="side-panel-create-vault"
    >
      {#if starting}
        <LoaderCircle size={14} class="side-panel-spin" aria-hidden="true" />
      {:else}
        <Plus size={14} aria-hidden="true" />
      {/if}
      {translatePlain(I18N_KEYS.FirstRunCreate)}
    </button>
    <button
      type="button"
      aria-disabled={starting}
      data-testid="side-panel-join-identity"
      onclick={onjoin}
    >
      {translatePlain(I18N_KEYS.ExtensionCompanionJoinIdentity)}
      <ArrowRight size={14} aria-hidden="true" />
    </button>
  </div>
</section>
