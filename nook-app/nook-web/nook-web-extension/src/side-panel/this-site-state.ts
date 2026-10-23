import {
  I18N_KEYS,
  type I18nKey,
} from '../../../nook-web-shared/src/generated/i18n-keys'
import type {
  SiteSecretEmptyHint,
  SiteSecretIdentityHeader,
  SiteSecretListing,
  SiteSecretListingSummary,
  SiteSecretRow,
  SiteSecretSection,
  SiteSecretSectionContent,
  SiteSecretVaultLabel,
} from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  SidePanelCodeFillKind,
  SidePanelLoginFillKind,
  SidePanelSiteListingKind,
  type SidePanelLoginItemId,
  type SidePanelSiteListing,
} from '../lib/side-panel-site'
import { SidePanelChangeKind } from './side-panel-runtime'

/**
 * This site: the site-bound secrets for the active tab of the panel's window,
 * as the service worker and Rust answer them: one section per identity:vault,
 * each with the rows Rust filtered by the page's need or its empty line. The
 * panel keeps them in memory only, in Rust's order, and drops them when the
 * tab, its address, the panel's visibility or the lock state changes. Every
 * answer ends in something visible: sections, Rust's empty state above them,
 * an unavailable page, or a failure.
 */
export enum ThisSiteHostKind {
  /** The active tab's host, as Rust displays it. */
  Named = 'named',
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  NoWebsite = 'no-website',
  /** The answer named no host: loading, failed, or a page Nook cannot fill. */
  Unnamed = 'unnamed',
}

export type ThisSiteHost =
  | { readonly kind: ThisSiteHostKind.Named; readonly host: string }
  | { readonly kind: ThisSiteHostKind.NoWebsite }
  | { readonly kind: ThisSiteHostKind.Unnamed }

export enum ThisSiteBodyKind {
  Loading = 'loading',
  Matches = 'matches',
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  Empty = 'empty',
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  NotWeb = 'not-web',
  /** A Nook vault app or a page no content script reaches. */
  Restricted = 'restricted',
  /** Paired vaults exist, but none of them fills passwords. */
  NoFillingVault = 'no-filling-vault',
  /** The session answered locked while the panel still showed unlocked. */
  Locked = 'locked',
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  Failed = 'failed',
}

/** How many rows the sections list together, across every section: a
 * single row gets the primary action. */
export enum ThisSiteMatchCount {
  /** No section lists a row; Rust's empty state says so. */
  None = 'none',
  One = 'one',
  Several = 'several',
}

/** Rust's identity:vault sections, in Rust's order. */
export type ThisSiteSections = readonly SiteSecretSection[]

/** One section's display rows, in Rust's order. */
type ThisSiteRows = readonly SiteSecretRow[]

/** What a section header names: its identity or its vault, saved or unnamed. */
export type ThisSiteSectionLabel =
  SiteSecretIdentityHeader | SiteSecretVaultLabel

/** The sections a ready listing shows, and how many rows they list. */
export type ThisSiteSectionList = {
  readonly sections: ThisSiteSections
  readonly count: ThisSiteMatchCount
}

/** Rust's empty state for the page's need: its message (taking the host)
 * and optional hint, shown above the sections. */
export type ThisSiteEmptyListing = Extract<
  SiteSecretListingSummary,
  { hint: SiteSecretEmptyHint }
>

export type ThisSiteBody =
  | { readonly kind: ThisSiteBodyKind.Loading }
  | {
      readonly kind: ThisSiteBodyKind.Matches
      readonly sections: ThisSiteSections
      readonly count: ThisSiteMatchCount
    }
  | {
      readonly kind: ThisSiteBodyKind.Empty
      readonly host: string
      readonly empty: ThisSiteEmptyListing
      readonly sections: ThisSiteSections
      readonly count: ThisSiteMatchCount
    }
  | { readonly kind: ThisSiteBodyKind.NotWeb }
  | { readonly kind: ThisSiteBodyKind.Restricted }
  | { readonly kind: ThisSiteBodyKind.NoFillingVault }
  | { readonly kind: ThisSiteBodyKind.Locked }
  | { readonly kind: ThisSiteBodyKind.Failed }

/** An empty answer: the host Rust named and its empty state. */
export type ThisSiteEmptyBody = Extract<
  ThisSiteBody,
  { readonly kind: ThisSiteBodyKind.Empty }
>

export type ThisSiteView = {
  readonly host: ThisSiteHost
  readonly body: ThisSiteBody
}

/** What This site asks of the panel besides showing its answer. */
export enum ThisSitePanelSignal {
  None = 'none',
  /** The session is locked: the panel re-reads which lock it is. */
  Locked = 'locked',
  /** A Fill found the session locked: the locked view says so. */
  FillLocked = 'fill-locked',
  /** No paired vault fills passwords: the panel re-reads its vaults. */
  Unpaired = 'unpaired',
}

export type ThisSiteListingOutcome = {
  readonly view: ThisSiteView
  readonly signal: ThisSitePanelSignal
}

/** Fill shows one result at a time for the whole section. */
export enum ThisSiteFillKind {
  Idle = 'idle',
  Pending = 'pending',
  Filled = 'filled',
  Failed = 'failed',
}

export enum ThisSiteFillFailure {
  NoLoginForm = 'no-login-form',
  /** Rust found no one-time-code challenge on the page. */
  NoCodeField = 'no-code-field',
  /** The session locked before the fill. */
  Locked = 'locked',
  Other = 'other',
}

/** Which fill a row asked for: a saved login or an authenticator code. */
export enum ThisSiteFillAction {
  Login = 'login',
  Code = 'code',
}

export type ThisSiteFill =
  | { readonly kind: ThisSiteFillKind.Idle }
  | {
      readonly kind: ThisSiteFillKind.Pending | ThisSiteFillKind.Filled
      readonly item: SidePanelLoginItemId
      readonly action: ThisSiteFillAction
    }
  | {
      readonly kind: ThisSiteFillKind.Failed
      readonly item: SidePanelLoginItemId
      readonly action: ThisSiteFillAction
      readonly failure: ThisSiteFillFailure
    }

export enum ThisSiteFillChoiceKind {
  Fills = 'fills',
  ViewOnly = 'view-only',
}

/** The fill a row's Rust action asks for, or none for a view-only row. */
export type ThisSiteFillChoice =
  | {
      readonly kind: ThisSiteFillChoiceKind.Fills
      readonly action: ThisSiteFillAction
    }
  | { readonly kind: ThisSiteFillChoiceKind.ViewOnly }

/** One fill request: which fill, for which item, in which window. */
export type ThisSiteFillSend = {
  readonly action: ThisSiteFillAction
  readonly item: SidePanelLoginItemId
  readonly windowId: number
}

export enum ThisSiteLiveAnnouncementKind {
  Announced = 'announced',
  Silent = 'silent',
}

/** The live region's text key for the section's fill result, or silence. */
export type ThisSiteLiveAnnouncement =
  | {
      readonly kind: ThisSiteLiveAnnouncementKind.Announced
      readonly key: I18nKey
    }
  | { readonly kind: ThisSiteLiveAnnouncementKind.Silent }

/** Whether a Fill request is still on its way: one at a time, also after
 * the list it came from was dropped. */
export enum ThisSiteFillActivity {
  Idle = 'idle',
  Running = 'running',
}

/** The note above the list after a Fill could not use the login shown. */
export enum ThisSiteNoticeKind {
  None = 'none',
  /** The tab left the site the list was for. */
  SiteChanged = 'site-changed',
  /** The login is no longer saved for this site. */
  ItemMissing = 'item-missing',
  /** The authenticator is no longer saved for this site. */
  CodeMissing = 'code-missing',
}

/** Whether a change asks for the active tab's logins again. */
export enum ThisSiteReload {
  List = 'list',
  None = 'none',
}

export type ThisSiteFillOutcome = {
  readonly fill: ThisSiteFill
  readonly notice: ThisSiteNoticeKind
  readonly reload: ThisSiteReload
  readonly signal: ThisSitePanelSignal
}

/** Whether a row's login is the one the section's result is about. */
export enum ThisSiteRowResult {
  None = 'none',
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  Shown = 'shown',
}

type ThisSiteFillAnswerRequest = {
  readonly kind: SidePanelLoginFillKind
  readonly item: SidePanelLoginItemId
}

type ThisSiteCodeFillAnswerRequest = {
  readonly kind: SidePanelCodeFillKind
  readonly item: SidePanelLoginItemId
}

type ThisSiteListedRequest = {
  readonly host: string
  readonly listing: SiteSecretListing
}

type ThisSiteRowRequest = {
  readonly fill: ThisSiteFill
  readonly item: SidePanelLoginItemId
}

type ThisSiteFailedFillRequest = {
  readonly item: SidePanelLoginItemId
  readonly action: ThisSiteFillAction
  readonly failure: ThisSiteFillFailure
}

/** Body kinds that carry nothing but their kind. */
type ThisSiteBareBodyKind =
  | ThisSiteBodyKind.Loading
  | ThisSiteBodyKind.NotWeb
  | ThisSiteBodyKind.Restricted
  | ThisSiteBodyKind.NoFillingVault
  | ThisSiteBodyKind.Locked
  | ThisSiteBodyKind.Failed

type ThisSiteRelistRequest = {
  readonly notice: ThisSiteNoticeKind
  readonly signal: ThisSitePanelSignal
}

/** Maps the service worker's This-site answers to what the panel shows. */
export class ThisSiteViews {
  private constructor() {}

  static loading(): ThisSiteView {
    return ThisSiteViews.unnamed(ThisSiteBodyKind.Loading)
  }

  /** The window could not be named, so no tab can be listed. */
  static failed(): ThisSiteView {
    return ThisSiteViews.unnamed(ThisSiteBodyKind.Failed)
  }

  static listing(listing: SidePanelSiteListing): ThisSiteListingOutcome {
    switch (listing.kind) {
      case SidePanelSiteListingKind.Ready: {
        const listed: ThisSiteListedRequest = {
          host: listing.display_host,
          listing: listing.listing,
        }
        const ready: ThisSiteView = {
          host: { kind: ThisSiteHostKind.Named, host: listing.display_host },
          body: ThisSiteViews.listed(listed),
        }
        return ThisSiteViews.shown(ready)
      }
      case SidePanelSiteListingKind.NonWeb: {
        const nonWeb: ThisSiteView = {
          host: { kind: ThisSiteHostKind.NoWebsite },
          body: { kind: ThisSiteBodyKind.NotWeb },
        }
        return ThisSiteViews.shown(nonWeb)
      }
      case SidePanelSiteListingKind.PageUnavailable:
        return ThisSiteViews.shown(
          ThisSiteViews.unnamed(ThisSiteBodyKind.Restricted),
        )
      case SidePanelSiteListingKind.Forbidden:
      case SidePanelSiteListingKind.ListFailed:
        return ThisSiteViews.shown(ThisSiteViews.failed())
      case SidePanelSiteListingKind.Locked:
        return {
          view: ThisSiteViews.unnamed(ThisSiteBodyKind.Locked),
          signal: ThisSitePanelSignal.Locked,
        }
      case SidePanelSiteListingKind.Unpaired:
        return {
          view: ThisSiteViews.unnamed(ThisSiteBodyKind.NoFillingVault),
          signal: ThisSitePanelSignal.Unpaired,
        }
    }
  }

  static fill(answer: ThisSiteFillAnswerRequest): ThisSiteFillOutcome {
    const { kind, item } = answer
    const action = ThisSiteFillAction.Login
    switch (kind) {
      case SidePanelLoginFillKind.Filled: {
        const filled: ThisSiteFill = {
          kind: ThisSiteFillKind.Filled,
          item,
          action,
        }
        return ThisSiteViews.onRow(filled)
      }
      case SidePanelLoginFillKind.NoLoginForm: {
        const noForm: ThisSiteFailedFillRequest = {
          item,
          action,
          failure: ThisSiteFillFailure.NoLoginForm,
        }
        return ThisSiteViews.failedOnRow(noForm)
      }
      case SidePanelLoginFillKind.Forbidden:
      case SidePanelLoginFillKind.PageUnavailable:
      case SidePanelLoginFillKind.FillFailed: {
        const failed: ThisSiteFailedFillRequest = {
          item,
          action,
          failure: ThisSiteFillFailure.Other,
        }
        return ThisSiteViews.failedOnRow(failed)
      }
      case SidePanelLoginFillKind.Locked: {
        const locked: ThisSiteFailedFillRequest = {
          item,
          action,
          failure: ThisSiteFillFailure.Locked,
        }
        return ThisSiteViews.lockedOnRow(locked)
      }
      case SidePanelLoginFillKind.ItemNotFound: {
        const missing: ThisSiteRelistRequest = {
          notice: ThisSiteNoticeKind.ItemMissing,
          signal: ThisSitePanelSignal.None,
        }
        return ThisSiteViews.relist(missing)
      }
      case SidePanelLoginFillKind.TabChanged:
      case SidePanelLoginFillKind.NonWeb:
        return ThisSiteViews.relist(ThisSiteViews.moved)
      case SidePanelLoginFillKind.Unpaired:
        return ThisSiteViews.relist(ThisSiteViews.unpaired)
    }
  }

  static codeFill(answer: ThisSiteCodeFillAnswerRequest): ThisSiteFillOutcome {
    const { kind, item } = answer
    const action = ThisSiteFillAction.Code
    switch (kind) {
      case SidePanelCodeFillKind.Filled: {
        const filled: ThisSiteFill = {
          kind: ThisSiteFillKind.Filled,
          item,
          action,
        }
        return ThisSiteViews.onRow(filled)
      }
      case SidePanelCodeFillKind.NoCodeField: {
        const noField: ThisSiteFailedFillRequest = {
          item,
          action,
          failure: ThisSiteFillFailure.NoCodeField,
        }
        return ThisSiteViews.failedOnRow(noField)
      }
      case SidePanelCodeFillKind.Forbidden:
      case SidePanelCodeFillKind.PageUnavailable:
      case SidePanelCodeFillKind.FillFailed: {
        const failed: ThisSiteFailedFillRequest = {
          item,
          action,
          failure: ThisSiteFillFailure.Other,
        }
        return ThisSiteViews.failedOnRow(failed)
      }
      case SidePanelCodeFillKind.Locked: {
        const locked: ThisSiteFailedFillRequest = {
          item,
          action,
          failure: ThisSiteFillFailure.Locked,
        }
        return ThisSiteViews.lockedOnRow(locked)
      }
      case SidePanelCodeFillKind.ItemNotFound: {
        const missing: ThisSiteRelistRequest = {
          notice: ThisSiteNoticeKind.CodeMissing,
          signal: ThisSitePanelSignal.None,
        }
        return ThisSiteViews.relist(missing)
      }
      case SidePanelCodeFillKind.TabChanged:
      case SidePanelCodeFillKind.NonWeb:
        return ThisSiteViews.relist(ThisSiteViews.moved)
      case SidePanelCodeFillKind.Unpaired:
        return ThisSiteViews.relist(ThisSiteViews.unpaired)
    }
  }

  /** The row's result line text, when the result is about that row. */
  static resultKey(fill: ThisSiteFill): I18nKey {
    switch (fill.kind) {
      case ThisSiteFillKind.Idle:
      case ThisSiteFillKind.Pending:
        return I18N_KEYS.ExtensionActionFillPending
      case ThisSiteFillKind.Filled:
        return ThisSiteViews.filledKey(fill.action)
      case ThisSiteFillKind.Failed:
        return ThisSiteViews.failureKey(fill)
    }
  }

  /**
   * What the section's live region announces: pending and success with the
   * same text as the row; a failure is announced by the row's own alert.
   */
  static liveAnnouncement(fill: ThisSiteFill): ThisSiteLiveAnnouncement {
    switch (fill.kind) {
      case ThisSiteFillKind.Pending:
      case ThisSiteFillKind.Filled:
        return {
          kind: ThisSiteLiveAnnouncementKind.Announced,
          key: ThisSiteViews.resultKey(fill),
        }
      case ThisSiteFillKind.Idle:
      case ThisSiteFillKind.Failed:
        return { kind: ThisSiteLiveAnnouncementKind.Silent }
    }
  }

  /** The note above the list, when there is one. */
  static noticeKey(notice: ThisSiteNoticeKind): I18nKey {
    switch (notice) {
      case ThisSiteNoticeKind.None:
      case ThisSiteNoticeKind.SiteChanged:
        return I18N_KEYS.ExtensionActionFillSiteChanged
      case ThisSiteNoticeKind.ItemMissing:
        return I18N_KEYS.ExtensionActionFillItemMissing
      case ThisSiteNoticeKind.CodeMissing:
        return I18N_KEYS.ExtensionActionFillCodeMissing
    }
  }

  static rowResult(request: ThisSiteRowRequest): ThisSiteRowResult {
    const { fill, item } = request
    switch (fill.kind) {
      case ThisSiteFillKind.Idle:
        return ThisSiteRowResult.None
      case ThisSiteFillKind.Pending:
      case ThisSiteFillKind.Filled:
      case ThisSiteFillKind.Failed:
        break
    }
    switch (
      fill.item.vaultStoreId === item.vaultStoreId &&
      fill.item.secretId === item.secretId
    ) {
      case true:
        return ThisSiteRowResult.Shown
      case false:
        return ThisSiteRowResult.None
    }
  }

  /** Which request a row's action sends; passkeys and API keys send none. */
  static fillChoice(row: SiteSecretRow): ThisSiteFillChoice {
    switch (row.action.kind) {
      case 'FillLogin':
        return {
          kind: ThisSiteFillChoiceKind.Fills,
          action: ThisSiteFillAction.Login,
        }
      case 'FillCode':
        return {
          kind: ThisSiteFillChoiceKind.Fills,
          action: ThisSiteFillAction.Code,
        }
      case 'ViewOnly':
        return { kind: ThisSiteFillChoiceKind.ViewOnly }
    }
  }

  /** The opaque id a row's fill request carries. */
  static itemId(row: SiteSecretRow): SidePanelLoginItemId {
    return {
      vaultStoreId: row.item_id.vault_store_id,
      secretId: row.item_id.secret_id,
    }
  }

  /** Rows count across every section, whichever identity or vault. */
  static matchCount(sections: ThisSiteSections): ThisSiteMatchCount {
    const rows = sections.flatMap((section) =>
      ThisSiteViews.sectionRows(section.content),
    )
    switch (rows.length) {
      case 0:
        return ThisSiteMatchCount.None
      case 1:
        return ThisSiteMatchCount.One
      default:
        return ThisSiteMatchCount.Several
    }
  }

  /** A section's rows in Rust's order; none when its vault has none. */
  static sectionRows(content: SiteSecretSectionContent): ThisSiteRows {
    switch (content.kind) {
      case 'Listed':
        return content.rows
      case 'Empty':
        return []
    }
  }

  private static readonly moved: ThisSiteRelistRequest = {
    notice: ThisSiteNoticeKind.SiteChanged,
    signal: ThisSitePanelSignal.None,
  }

  private static readonly unpaired: ThisSiteRelistRequest = {
    notice: ThisSiteNoticeKind.None,
    signal: ThisSitePanelSignal.Unpaired,
  }

  private static filledKey(action: ThisSiteFillAction): I18nKey {
    switch (action) {
      case ThisSiteFillAction.Login:
        return I18N_KEYS.ExtensionActionFillDone
      case ThisSiteFillAction.Code:
        return I18N_KEYS.ExtensionActionFillCodeDone
    }
  }

  private static failureKey(fill: ThisSiteFailedFillRequest): I18nKey {
    switch (fill.failure) {
      case ThisSiteFillFailure.NoLoginForm:
        return I18N_KEYS.ExtensionActionFillNoForm
      case ThisSiteFillFailure.NoCodeField:
        return I18N_KEYS.ExtensionActionFillNoCodeField
      case ThisSiteFillFailure.Locked:
        return I18N_KEYS.ExtensionActionFillLocked
      case ThisSiteFillFailure.Other:
        return ThisSiteViews.otherFailureKey(fill.action)
    }
  }

  private static otherFailureKey(action: ThisSiteFillAction): I18nKey {
    switch (action) {
      case ThisSiteFillAction.Login:
        return I18N_KEYS.ExtensionActionFillFailed
      case ThisSiteFillAction.Code:
        return I18N_KEYS.ExtensionActionFillCodeFailed
    }
  }

  private static unnamed(body: ThisSiteBareBodyKind): ThisSiteView {
    return { host: { kind: ThisSiteHostKind.Unnamed }, body: { kind: body } }
  }

  private static shown(view: ThisSiteView): ThisSiteListingOutcome {
    return { view, signal: ThisSitePanelSignal.None }
  }

  private static onRow(fill: ThisSiteFill): ThisSiteFillOutcome {
    return {
      fill,
      notice: ThisSiteNoticeKind.None,
      reload: ThisSiteReload.None,
      signal: ThisSitePanelSignal.None,
    }
  }

  private static failedOnRow(
    request: ThisSiteFailedFillRequest,
  ): ThisSiteFillOutcome {
    const failed: ThisSiteFill = { kind: ThisSiteFillKind.Failed, ...request }
    return ThisSiteViews.onRow(failed)
  }

  /** The row says so even if the panel's re-read finds it unlocked. */
  private static lockedOnRow(
    request: ThisSiteFailedFillRequest,
  ): ThisSiteFillOutcome {
    return {
      fill: { kind: ThisSiteFillKind.Failed, ...request },
      notice: ThisSiteNoticeKind.None,
      reload: ThisSiteReload.None,
      signal: ThisSitePanelSignal.FillLocked,
    }
  }

  /** The item shown no longer fits the tab: list the site again. */
  private static relist(request: ThisSiteRelistRequest): ThisSiteFillOutcome {
    return {
      fill: { kind: ThisSiteFillKind.Idle },
      notice: request.notice,
      reload: ThisSiteReload.List,
      signal: request.signal,
    }
  }

  /** Every section shows; Rust's empty state leads them when none lists a row. */
  private static listed(request: ThisSiteListedRequest): ThisSiteBody {
    const { host, listing } = request
    const { summary, sections } = listing
    const count = ThisSiteViews.matchCount(sections)
    switch (summary.kind) {
      case 'Empty':
        return {
          kind: ThisSiteBodyKind.Empty,
          host,
          empty: summary,
          sections,
          count,
        }
      case 'Listed':
        return { kind: ThisSiteBodyKind.Matches, sections, count }
    }
  }
}

/** Everything This site shows; it lives only in the panel's memory. */
export type ThisSiteState = {
  readonly view: ThisSiteView
  readonly fill: ThisSiteFill
  readonly notice: ThisSiteNoticeKind
}

/** Whether a change dropped what This site showed. */
export enum ThisSiteMemoryKind {
  Kept = 'kept',
  /** Shown logins, results and answers still on their way are gone. */
  Dropped = 'dropped',
}

export type ThisSiteChangeResult = {
  readonly memory: ThisSiteMemoryKind
  readonly state: ThisSiteState
  readonly reload: ThisSiteReload
}

type ThisSiteChangeRequest = {
  readonly state: ThisSiteState
  readonly change: SidePanelChangeKind
}

type ThisSiteDropRequest = {
  readonly notice: ThisSiteNoticeKind
  readonly reload: ThisSiteReload
}

/** What This site keeps, drops and re-reads when the panel's surroundings
 * change: logins never outlive the tab, its address or the panel's
 * visibility; a note about a Fill outlives only the reload it caused. */
export class ThisSiteMemory {
  private constructor() {}

  static initial(): ThisSiteState {
    return {
      view: ThisSiteViews.loading(),
      fill: { kind: ThisSiteFillKind.Idle },
      notice: ThisSiteNoticeKind.None,
    }
  }

  static changed(request: ThisSiteChangeRequest): ThisSiteChangeResult {
    const { state, change } = request
    switch (change) {
      case SidePanelChangeKind.TabActivated:
      case SidePanelChangeKind.PanelHidden: {
        const drop: ThisSiteDropRequest = {
          notice: ThisSiteNoticeKind.None,
          reload: ThisSiteMemory.reloadAfter(change),
        }
        return ThisSiteMemory.dropped(drop)
      }
      case SidePanelChangeKind.TabNavigated:
      case SidePanelChangeKind.PanelShown: {
        const drop: ThisSiteDropRequest = {
          notice: state.notice,
          reload: ThisSiteReload.List,
        }
        return ThisSiteMemory.dropped(drop)
      }
      case SidePanelChangeKind.PanelFocused:
        // A click into the panel keeps the list under the pointer.
        return {
          memory: ThisSiteMemoryKind.Kept,
          state,
          reload: ThisSiteReload.None,
        }
      case SidePanelChangeKind.VaultChanged:
      case SidePanelChangeKind.PageChanged:
        // The vault or what the page offers changed: list again, showing
        // the current list meanwhile.
        return {
          memory: ThisSiteMemoryKind.Kept,
          state,
          reload: ThisSiteReload.List,
        }
    }
  }

  private static reloadAfter(change: SidePanelChangeKind): ThisSiteReload {
    switch (change) {
      case SidePanelChangeKind.PanelHidden:
        return ThisSiteReload.None
      case SidePanelChangeKind.TabActivated:
      case SidePanelChangeKind.TabNavigated:
      case SidePanelChangeKind.PanelShown:
      case SidePanelChangeKind.PanelFocused:
      case SidePanelChangeKind.VaultChanged:
      case SidePanelChangeKind.PageChanged:
        return ThisSiteReload.List
    }
  }

  private static dropped(request: ThisSiteDropRequest): ThisSiteChangeResult {
    return {
      memory: ThisSiteMemoryKind.Dropped,
      state: {
        view: ThisSiteViews.loading(),
        fill: { kind: ThisSiteFillKind.Idle },
        notice: request.notice,
      },
      reload: request.reload,
    }
  }
}
