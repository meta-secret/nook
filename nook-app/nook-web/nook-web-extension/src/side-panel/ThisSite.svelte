<!--
This site: the active tab's host and its saved logins, each with Fill. The
service worker reads the panel's active tab itself; the panel sends only its
window and, for Fill, a login's opaque id. Logins stay in this component's
memory, in Rust's order, and are dropped when the tab, its address, the
panel's visibility or the lock state changes. Authenticators never appear.
-->
<script lang="ts">
  import { tick, untrack } from 'svelte'
  import { CircleAlert, LoaderCircle } from '@lucide/svelte'
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
    sidePanelSite,
    type SidePanelLoginFillRequest,
    type SidePanelLoginItemId,
    type SidePanelWindowSelection,
  } from '../lib/side-panel-site'
  import ThisSiteLogin from './ThisSiteLogin.svelte'
  import {
    SidePanelChangeKind,
    SidePanelRuntime,
    SidePanelWindowKind,
    type SidePanelWindow,
  } from './side-panel-runtime'
  import {
    SidePanelLockReasonKind,
    SidePanelReadFreshness,
    SidePanelReadSequence,
  } from './side-panel-state'
  import { ThisSiteFocus } from './this-site-focus'
  import {
    ThisSiteBodyKind,
    ThisSiteFillActivity,
    ThisSiteFillKind,
    ThisSiteHostKind,
    ThisSiteMemory,
    ThisSiteMemoryKind,
    ThisSiteNoticeKind,
    ThisSitePanelSignal,
    ThisSiteReload,
    ThisSiteViews,
    type ThisSiteFill,
    type ThisSiteState,
    type ThisSiteView,
  } from './this-site-state'

  type ThisSiteProps = {
    readonly i18n: ExtensionI18n
    readonly panelWindow: SidePanelWindow
    /** The extension locked; a Fill that found it locked says so. */
    readonly onlocked: (reason: SidePanelLockReasonKind) => void
    /** No identity is paired any more. */
    readonly onunpaired: () => void
  }

  let { i18n, panelWindow, onlocked, onunpaired }: ThisSiteProps = $props()

  const runtime = new SidePanelRuntime()
  const reads = new SidePanelReadSequence()
  const fills = new SidePanelReadSequence()
  const focus = new ThisSiteFocus()

  let site = $state<ThisSiteState>(ThisSiteMemory.initial())
  /** A Fill request on its way blocks the next, also after a drop. */
  let fillActivity = $state<ThisSiteFillActivity>(ThisSiteFillActivity.Idle)
  const view = $derived(site.view)
  const fill = $derived(site.fill)
  const notice = $derived(site.notice)

  function translatePlain(key: I18nKey): string {
    return i18n.t(extensionLocaleCatalog.plainExtensionTranslation(key))
  }

  function emptyText(host: string): string {
    const request: ExtensionTranslationRequest = {
      kind: ExtensionTranslationRequestKind.WithReplacements,
      key: I18N_KEYS.ExtensionActionSiteEmpty,
      replacements: { host },
    }
    return i18n.t(request)
  }

  /** Pending and success are announced from one persistent region. */
  function liveText(): string {
    switch (fill.kind) {
      case ThisSiteFillKind.Pending:
        return translatePlain(I18N_KEYS.ExtensionActionFillPending)
      case ThisSiteFillKind.Filled:
        return translatePlain(I18N_KEYS.ExtensionActionFillDone)
      case ThisSiteFillKind.Idle:
      case ThisSiteFillKind.Failed:
        return ''
    }
  }

  async function replace(next: ThisSiteView): Promise<void> {
    const place = focus.place()
    site = { ...site, view: next }
    await tick()
    focus.restore(place)
  }

  function showFill(next: ThisSiteFill): void {
    site = { ...site, fill: next }
  }

  function showNotice(next: ThisSiteNoticeKind): void {
    site = { ...site, notice: next }
  }

  /** Tell the panel what This site learned; it re-reads its own state. */
  function signal(next: ThisSitePanelSignal): void {
    switch (next) {
      case ThisSitePanelSignal.None:
        return
      case ThisSitePanelSignal.Locked:
        onlocked(SidePanelLockReasonKind.None)
        return
      case ThisSitePanelSignal.FillLocked:
        onlocked(SidePanelLockReasonKind.FillLocked)
        return
      case ThisSitePanelSignal.Unpaired:
        onunpaired()
        return
    }
  }

  /** List the active tab's logins again, dropping what was shown. */
  async function load(): Promise<void> {
    const read = reads.begin()
    await replace(ThisSiteViews.loading())
    switch (panelWindow.kind) {
      case SidePanelWindowKind.Resolving:
        return
      case SidePanelWindowKind.Unknown:
        await replace(ThisSiteViews.failed())
        return
      case SidePanelWindowKind.Known:
        break
    }
    const selection: SidePanelWindowSelection = { windowId: panelWindow.id }
    const listing = await sidePanelSite.list(selection)
    switch (read.freshness()) {
      case SidePanelReadFreshness.Stale:
        return
      case SidePanelReadFreshness.Current:
        break
    }
    const outcome = ThisSiteViews.listing(listing)
    await replace(outcome.view)
    signal(outcome.signal)
  }

  async function fillLogin(item: SidePanelLoginItemId): Promise<void> {
    switch (fillActivity) {
      case ThisSiteFillActivity.Running:
        return
      case ThisSiteFillActivity.Idle:
        break
    }
    switch (panelWindow.kind) {
      case SidePanelWindowKind.Resolving:
      case SidePanelWindowKind.Unknown:
        return
      case SidePanelWindowKind.Known:
        break
    }
    const read = fills.begin()
    fillActivity = ThisSiteFillActivity.Running
    showNotice(ThisSiteNoticeKind.None)
    const pending: ThisSiteFill = { kind: ThisSiteFillKind.Pending, item }
    showFill(pending)
    const request: SidePanelLoginFillRequest = {
      windowId: panelWindow.id,
      itemId: item,
    }
    const answer = await sidePanelSite.fill(request)
    fillActivity = ThisSiteFillActivity.Idle
    switch (read.freshness()) {
      // The list it came from was dropped: its answer shows nowhere.
      case SidePanelReadFreshness.Stale:
        return
      case SidePanelReadFreshness.Current:
        break
    }
    const outcomeRequest: Parameters<typeof ThisSiteViews.fill>[0] = {
      kind: answer.kind,
      item,
    }
    const outcome = ThisSiteViews.fill(outcomeRequest)
    showFill(outcome.fill)
    showNotice(outcome.notice)
    switch (outcome.reload) {
      case ThisSiteReload.List:
        void load()
        break
      case ThisSiteReload.None:
        break
    }
    signal(outcome.signal)
  }

  function fillRow(item: SidePanelLoginItemId): void {
    void fillLogin(item)
  }

  function changed(change: SidePanelChangeKind): void {
    const request: Parameters<typeof ThisSiteMemory.changed>[0] = {
      state: site,
      change,
    }
    const result = ThisSiteMemory.changed(request)
    switch (result.memory) {
      case ThisSiteMemoryKind.Dropped:
        // A dropped list also drops any answer still on its way.
        reads.invalidate()
        fills.invalidate()
        site = result.state
        break
      case ThisSiteMemoryKind.Kept:
        break
    }
    switch (result.reload) {
      case ThisSiteReload.List:
        void load()
        return
      case ThisSiteReload.None:
        return
    }
  }

  $effect(() => {
    const followRequest: Parameters<typeof runtime.follow>[0] = {
      window: panelWindow,
      onchange: changed,
    }
    const release = runtime.follow(followRequest)
    untrack(() => void load())
    return release
  })
</script>

<section
  class="side-panel-section"
  aria-labelledby="side-panel-site-heading"
  data-testid="side-panel-site"
  data-body={view.body.kind}
  {@attach focus.attachSection}
>
  <h1
    id="side-panel-site-heading"
    class="side-panel-site-heading"
    tabindex="-1"
    {@attach focus.attachHeading}
  >
    <span class="side-panel-label">
      {translatePlain(I18N_KEYS.ExtensionActionSiteLabel)}
    </span>
    {#if view.host.kind === ThisSiteHostKind.Named}
      <span class="side-panel-site-host" data-testid="side-panel-site-host">
        {view.host.host}
      </span>
    {:else if view.host.kind === ThisSiteHostKind.NoWebsite}
      <span
        class="side-panel-site-host is-absent"
        data-testid="side-panel-site-host"
      >
        {translatePlain(I18N_KEYS.ExtensionActionSiteNotWeb)}
      </span>
    {/if}
  </h1>
  <p class="side-panel-sr-only" aria-live="polite" aria-atomic="true">
    {liveText()}
  </p>

  {#if notice !== ThisSiteNoticeKind.None}
    <div class="side-panel-site-status">
      <p
        class="side-panel-site-status-failed"
        role="alert"
        data-testid="side-panel-site-note"
        data-note={notice}
      >
        <CircleAlert size={14} aria-hidden="true" />
        {translatePlain(ThisSiteViews.noticeKey(notice))}
      </p>
    </div>
  {/if}

  {#if view.body.kind === ThisSiteBodyKind.Loading}
    <div class="side-panel-site-status" role="status">
      <p>
        <LoaderCircle size={14} class="side-panel-spin" aria-hidden="true" />
        {translatePlain(I18N_KEYS.ExtensionActionSiteLoading)}
      </p>
    </div>
  {:else if view.body.kind === ThisSiteBodyKind.Matches}
    <ul class="side-panel-logins">
      {#each view.body.items as login (`${login.itemId.vaultStoreId}:${login.itemId.secretId}`)}
        <ThisSiteLogin
          {i18n}
          {login}
          count={view.body.count}
          {fill}
          activity={fillActivity}
          onfill={fillRow}
        />
      {/each}
    </ul>
  {:else if view.body.kind === ThisSiteBodyKind.Empty}
    <div class="side-panel-site-status" data-testid="side-panel-site-empty">
      <p class="side-panel-site-status-lead">{emptyText(view.body.host)}</p>
      <p>{translatePlain(I18N_KEYS.ExtensionActionSiteEmptyHint)}</p>
    </div>
  {:else if view.body.kind === ThisSiteBodyKind.NotWeb}
    <div class="side-panel-site-status">
      <p>{translatePlain(I18N_KEYS.ExtensionActionSiteNotWebHint)}</p>
    </div>
  {:else if view.body.kind === ThisSiteBodyKind.Restricted}
    <div class="side-panel-site-status">
      <p>{translatePlain(I18N_KEYS.ExtensionActionSiteRestricted)}</p>
    </div>
  {:else if view.body.kind === ThisSiteBodyKind.NoFillingVault}
    <div
      class="side-panel-site-status"
      data-testid="side-panel-site-no-filling"
    >
      <p>{translatePlain(I18N_KEYS.ExtensionActionSiteNoFillingVault)}</p>
    </div>
  {:else if view.body.kind === ThisSiteBodyKind.Locked}
    <div class="side-panel-site-status" data-testid="side-panel-site-locked">
      <p>{translatePlain(I18N_KEYS.ExtensionActionSiteLocked)}</p>
      <button
        type="button"
        class="side-panel-text-button"
        data-testid="side-panel-site-retry"
        onclick={() => void load()}
      >
        {translatePlain(I18N_KEYS.ExtensionActionTryAgain)}
      </button>
    </div>
  {:else}
    <div class="side-panel-site-status">
      <p
        class="side-panel-site-status-failed"
        role="alert"
        data-testid="side-panel-site-failed"
      >
        <CircleAlert size={14} aria-hidden="true" />
        {translatePlain(I18N_KEYS.ExtensionActionSiteFailed)}
      </p>
      <button
        type="button"
        class="side-panel-text-button"
        data-testid="side-panel-site-retry"
        onclick={() => void load()}
      >
        {translatePlain(I18N_KEYS.ExtensionActionTryAgain)}
      </button>
    </div>
  {/if}
</section>
