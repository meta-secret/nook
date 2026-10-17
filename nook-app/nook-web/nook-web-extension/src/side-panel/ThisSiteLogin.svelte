<!--
One saved login for This site: its username and vault, and Fill. The row
itself is not a control; only Fill is. Fill sends the login's opaque id;
the service worker fills the active tab's form and never submits it.
-->
<script lang="ts">
  import { Check, CircleAlert, LoaderCircle } from '@lucide/svelte'
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
  import type {
    SidePanelLoginItemId,
    SidePanelSiteLogin,
  } from '../lib/side-panel-site'
  import {
    ThisSiteFillKind,
    ThisSiteMatchCount,
    ThisSiteRowResult,
    ThisSiteViews,
    type ThisSiteFill,
  } from './this-site-state'

  type ThisSiteLoginProps = {
    readonly i18n: ExtensionI18n
    readonly login: SidePanelSiteLogin
    readonly count: ThisSiteMatchCount
    readonly fill: ThisSiteFill
    readonly onfill: (item: SidePanelLoginItemId) => void
  }

  let { i18n, login, count, fill, onfill }: ThisSiteLoginProps = $props()

  function translatePlain(key: I18nKey): string {
    return i18n.t(extensionLocaleCatalog.plainExtensionTranslation(key))
  }

  /** What the row shows for a login saved without a username. */
  function loginName(): string {
    switch (login.username) {
      case '':
        return translatePlain(I18N_KEYS.ExtensionLoginPickerUnnamed)
      default:
        return login.username
    }
  }

  function vaultName(): string {
    switch (login.vaultLabel) {
      case '':
        return translatePlain(I18N_KEYS.LoginVaultPickerUnnamed)
      default:
        return login.vaultLabel
    }
  }

  /** Distinct names, so two rows with the same username stay apart. */
  function fillLabel(): string {
    const request: ExtensionTranslationRequest = {
      kind: ExtensionTranslationRequestKind.WithReplacements,
      key: I18N_KEYS.ExtensionActionFillLogin,
      replacements: { login: loginName(), vault: vaultName() },
    }
    return i18n.t(request)
  }

  const rowResultRequest = $derived<
    Parameters<typeof ThisSiteViews.rowResult>[0]
  >({ fill, item: login.itemId })
  const result = $derived(ThisSiteViews.rowResult(rowResultRequest))
  const pendingHere = $derived(
    result === ThisSiteRowResult.Shown &&
      fill.kind === ThisSiteFillKind.Pending,
  )
</script>

<li
  class="side-panel-login"
  data-testid="side-panel-login"
  aria-busy={pendingHere}
>
  <div class="side-panel-login-copy">
    <span class="side-panel-login-name" title={login.username}
      >{loginName()}</span
    >
    <span class="side-panel-login-vault">{vaultName()}</span>
  </div>
  <button
    type="button"
    class="side-panel-fill"
    class:secondary-button={count === ThisSiteMatchCount.Several}
    aria-label={fillLabel()}
    aria-disabled={fill.kind === ThisSiteFillKind.Pending}
    data-testid="side-panel-fill"
    onclick={() => onfill(login.itemId)}
  >
    {translatePlain(I18N_KEYS.ExtensionActionFill)}
  </button>
  {#if result === ThisSiteRowResult.Shown}
    {#if fill.kind === ThisSiteFillKind.Failed}
      <p
        class="side-panel-login-result"
        data-result="failed"
        role="alert"
        data-testid="side-panel-fill-result"
      >
        <CircleAlert size={14} aria-hidden="true" />
        {translatePlain(ThisSiteViews.resultKey(fill))}
      </p>
    {:else if fill.kind === ThisSiteFillKind.Filled}
      <p
        class="side-panel-login-result"
        data-result="filled"
        data-testid="side-panel-fill-result"
      >
        <Check size={14} aria-hidden="true" />
        {translatePlain(ThisSiteViews.resultKey(fill))}
      </p>
    {:else}
      <p
        class="side-panel-login-result"
        data-result="pending"
        data-testid="side-panel-fill-result"
      >
        <LoaderCircle size={14} class="side-panel-spin" aria-hidden="true" />
        {translatePlain(ThisSiteViews.resultKey(fill))}
      </p>
    {/if}
  {/if}
</li>
