<!--
This site: the active tab's host and its site-bound secrets (logins,
authenticators, passkeys and API keys) under identity headers, as Rust
filtered them for what the page needs and grouped them. Logins offer Fill and
authenticators Fill code; passkeys and API keys are shown only. The service
worker reads the panel's active tab itself; the panel sends only its window
and, for a fill, the item's opaque id. Rows stay in this component's memory,
in Rust's order, and are dropped when the tab, its address, the panel's
visibility or the lock state changes.
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
  import type {
    SiteSecretIdentityHeader,
    SiteSecretRow,
  } from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
  import {
    sidePanelSite,
    type SidePanelLoginFillRequest,
    type SidePanelWindowSelection,
  } from '../lib/side-panel-site'
  import ThisSiteItem from './ThisSiteItem.svelte'
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
    ThisSiteFillAction,
    ThisSiteFillActivity,
    ThisSiteFillChoiceKind,
    ThisSiteFillKind,
    ThisSiteHostKind,
    ThisSiteLiveAnnouncementKind,
    ThisSiteMemory,
    ThisSiteMemoryKind,
    ThisSiteNoticeKind,
    ThisSitePanelSignal,
    ThisSiteReload,
    ThisSiteViews,
    type ThisSiteEmptyBody,
    type ThisSiteFill,
    type ThisSiteFillOutcome,
    type ThisSiteFillSend,
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

  /** Rust's empty-state message for what the page needs, naming the site. */
  function emptyText(body: ThisSiteEmptyBody): string {
    const request: ExtensionTranslationRequest = {
      kind: ExtensionTranslationRequestKind.SelectedWithReplacements,
      key: body.empty.message_key,
      replacements: { host: body.host },
    }
    return i18n.t(request)
  }

  /** A catalog key Rust chose. */
  function translateSelected(key: string): string {
    const request: ExtensionTranslationRequest = {
      kind: ExtensionTranslationRequestKind.Selected,
      key,
    }
    return i18n.t(request)
  }

  function headerText(header: SiteSecretIdentityHeader): string {
    switch (header.kind) {
      case 'Named':
        return header.name
      case 'Unnamed':
        return translateSelected(header.message_key)
    }
  }

  /** Pending and success are announced from one persistent region. */
  function liveText(): string {
    const announcement = ThisSiteViews.liveAnnouncement(fill)
    switch (announcement.kind) {
      case ThisSiteLiveAnnouncementKind.Announced:
        return translatePlain(announcement.key)
      case ThisSiteLiveAnnouncementKind.Silent:
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

  /** Sends the row's fill request and maps its answer to what the row shows. */
  async function sendFill(
    request: ThisSiteFillSend,
  ): Promise<ThisSiteFillOutcome> {
    const fillRequest: SidePanelLoginFillRequest = {
      windowId: request.windowId,
      itemId: request.item,
    }
    switch (request.action) {
      case ThisSiteFillAction.Login: {
        const answer = await sidePanelSite.fill(fillRequest)
        const loginAnswer: Parameters<typeof ThisSiteViews.fill>[0] = {
          kind: answer.kind,
          item: request.item,
        }
        return ThisSiteViews.fill(loginAnswer)
      }
      case ThisSiteFillAction.Code: {
        const answer = await sidePanelSite.fillCode(fillRequest)
        const codeAnswer: Parameters<typeof ThisSiteViews.codeFill>[0] = {
          kind: answer.kind,
          item: request.item,
        }
        return ThisSiteViews.codeFill(codeAnswer)
      }
    }
  }

  async function fillItem(row: SiteSecretRow): Promise<void> {
    const choice = ThisSiteViews.fillChoice(row)
    switch (choice.kind) {
      case ThisSiteFillChoiceKind.ViewOnly:
        return
      case ThisSiteFillChoiceKind.Fills:
        break
    }
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
    const item = ThisSiteViews.itemId(row)
    const read = fills.begin()
    fillActivity = ThisSiteFillActivity.Running
    showNotice(ThisSiteNoticeKind.None)
    const pending: ThisSiteFill = {
      kind: ThisSiteFillKind.Pending,
      item,
      action: choice.action,
    }
    showFill(pending)
    const send: ThisSiteFillSend = {
      action: choice.action,
      item,
      windowId: panelWindow.id,
    }
    const outcome = await sendFill(send)
    fillActivity = ThisSiteFillActivity.Idle
    switch (read.freshness()) {
      // The list it came from was dropped: its answer shows nowhere.
      case SidePanelReadFreshness.Stale:
        return
      case SidePanelReadFreshness.Current:
        break
    }
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

  function fillRow(row: SiteSecretRow): void {
    void fillItem(row)
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
    {#each view.body.groups as group, index (index)}
      <h2 class="side-panel-site-group" data-testid="side-panel-site-group">
        {headerText(group.header)}
      </h2>
      <ul class="side-panel-logins">
        {#each group.rows as row (`${row.item_id.vault_store_id}:${row.item_id.secret_id}`)}
          <ThisSiteItem
            {i18n}
            {row}
            count={view.body.count}
            {fill}
            activity={fillActivity}
            onfill={fillRow}
          />
        {/each}
      </ul>
    {/each}
  {:else if view.body.kind === ThisSiteBodyKind.Empty}
    <div class="side-panel-site-status" data-testid="side-panel-site-empty">
      <p class="side-panel-site-status-lead">{emptyText(view.body)}</p>
      {#if 'message_key' in view.body.empty.hint}
        <p>{translateSelected(view.body.empty.hint.message_key)}</p>
      {/if}
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
