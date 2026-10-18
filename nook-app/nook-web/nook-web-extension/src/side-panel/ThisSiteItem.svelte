<!--
One site-bound secret for This site, as Rust presented it: a type icon, its
type label, its title, and "account · saved host"; its section header names
the identity and vault. The row itself is not a control. A Login offers Fill
and an Authenticator Fill code; both send only the item's opaque id, and the
service worker fills the active tab without submitting. Passkeys and API keys
are shown for reference only.
-->
<script lang="ts">
  import {
    Braces,
    Check,
    CircleAlert,
    Globe,
    KeyRound,
    LoaderCircle,
    ShieldCheck,
  } from '@lucide/svelte'
  import type { SiteSecretRow } from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
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
  import {
    ThisSiteFillActivity,
    ThisSiteFillKind,
    ThisSiteMatchCount,
    ThisSiteRowResult,
    ThisSiteViews,
    type ThisSiteFill,
  } from './this-site-state'

  type ThisSiteItemProps = {
    readonly i18n: ExtensionI18n
    readonly row: SiteSecretRow
    /** The vault name its section header shows; the fill label names it. */
    readonly vault: string
    readonly count: ThisSiteMatchCount
    readonly fill: ThisSiteFill
    /** A fill on its way keeps every fill unavailable, focus included. */
    readonly activity: ThisSiteFillActivity
    readonly onfill: (row: SiteSecretRow) => void
  }

  let { i18n, row, vault, count, fill, activity, onfill }: ThisSiteItemProps =
    $props()

  function translatePlain(key: I18nKey): string {
    return i18n.t(extensionLocaleCatalog.plainExtensionTranslation(key))
  }

  /** A catalog key Rust chose for this row. */
  function translateSelected(key: string): string {
    const request: ExtensionTranslationRequest = {
      kind: ExtensionTranslationRequestKind.Selected,
      key,
    }
    return i18n.t(request)
  }

  /** The type icon is presentation only; Rust chose every text on the row. */
  function typeIcon(): typeof Globe {
    switch (row.kind) {
      case 'Login':
        return Globe
      case 'Authenticator':
        return ShieldCheck
      case 'Passkey':
        return KeyRound
      case 'ApiKey':
        return Braces
    }
  }

  /** What the accessible label names for an item saved without an account. */
  function accountName(): string {
    switch (row.account) {
      case '':
        return translatePlain(I18N_KEYS.ExtensionLoginPickerUnnamed)
      default:
        return row.account
    }
  }

  /** "account · saved host", leaving out whichever the item does not have. */
  function subtitle(): string {
    return [row.account, row.saved_host]
      .filter((part) => part !== '')
      .join(' · ')
  }

  /** Distinct names, so two rows with the same account stay apart. */
  function actionLabel(key: string): string {
    const request: ExtensionTranslationRequest = {
      kind: ExtensionTranslationRequestKind.SelectedWithReplacements,
      key,
      replacements: { login: accountName(), vault },
    }
    return i18n.t(request)
  }

  const Icon = $derived(typeIcon())
  const rowResultRequest = $derived<
    Parameters<typeof ThisSiteViews.rowResult>[0]
  >({ fill, item: ThisSiteViews.itemId(row) })
  const result = $derived(ThisSiteViews.rowResult(rowResultRequest))
  const pendingHere = $derived(
    result === ThisSiteRowResult.Shown &&
      fill.kind === ThisSiteFillKind.Pending,
  )
</script>

<li
  class="side-panel-login"
  data-testid="side-panel-item"
  data-kind={row.kind}
  aria-busy={pendingHere}
>
  <span class="side-panel-login-icon" aria-hidden="true">
    <Icon size={16} />
  </span>
  <div class="side-panel-login-copy">
    <span class="side-panel-login-type" data-testid="side-panel-item-type">
      {translateSelected(row.type_label_key)}
    </span>
    <span class="side-panel-login-name" title={row.title}>{row.title}</span>
    {#if subtitle() !== ''}
      <span
        class="side-panel-login-vault"
        data-testid="side-panel-item-subtitle">{subtitle()}</span
      >
    {/if}
  </div>
  {#if 'label_key' in row.action}
    <button
      type="button"
      class="side-panel-fill"
      class:secondary-button={count === ThisSiteMatchCount.Several}
      aria-label={actionLabel(row.action.accessible_label_key)}
      aria-disabled={activity === ThisSiteFillActivity.Running}
      data-testid="side-panel-fill"
      onclick={() => onfill(row)}
    >
      {translateSelected(row.action.label_key)}
    </button>
  {/if}
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
