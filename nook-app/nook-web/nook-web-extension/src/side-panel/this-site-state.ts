import {
  I18N_KEYS,
  type I18nKey,
} from '../../../nook-web-shared/src/generated/i18n-keys'
import {
  SidePanelLoginFillKind,
  SidePanelSiteListingKind,
  type SidePanelLoginItemId,
  type SidePanelSiteListing,
  type SidePanelSiteLogins,
} from '../lib/side-panel-site'
import { SidePanelChangeKind } from './side-panel-runtime'

/**
 * This site: the saved logins for the active tab of the panel's window, as
 * the service worker and Rust answer them. The panel keeps them in memory
 * only, in Rust's order, and drops them when the tab, its address, the
 * panel's visibility or the lock state changes. Every answer ends in
 * something visible: logins, an empty or unavailable page, or a failure.
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

/** Whether one login or several match: one match gets the primary Fill. */
export enum ThisSiteMatchCount {
  One = 'one',
  Several = 'several',
}

export type ThisSiteBody =
  | { readonly kind: ThisSiteBodyKind.Loading }
  | {
      readonly kind: ThisSiteBodyKind.Matches
      readonly items: SidePanelSiteLogins
      readonly count: ThisSiteMatchCount
    }
  | { readonly kind: ThisSiteBodyKind.Empty; readonly host: string }
  | { readonly kind: ThisSiteBodyKind.NotWeb }
  | { readonly kind: ThisSiteBodyKind.Restricted }
  | { readonly kind: ThisSiteBodyKind.NoFillingVault }
  | { readonly kind: ThisSiteBodyKind.Locked }
  | { readonly kind: ThisSiteBodyKind.Failed }

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
  /** The session locked before the fill. */
  Locked = 'locked',
  Other = 'other',
}

export type ThisSiteFill =
  | { readonly kind: ThisSiteFillKind.Idle }
  | {
      readonly kind: ThisSiteFillKind.Pending | ThisSiteFillKind.Filled
      readonly item: SidePanelLoginItemId
    }
  | {
      readonly kind: ThisSiteFillKind.Failed
      readonly item: SidePanelLoginItemId
      readonly failure: ThisSiteFillFailure
    }

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

type ThisSiteMatchesRequest = {
  readonly host: string
  readonly items: SidePanelSiteLogins
}

type ThisSiteRowRequest = {
  readonly fill: ThisSiteFill
  readonly item: SidePanelLoginItemId
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
        const matches: ThisSiteMatchesRequest = {
          host: listing.display_host,
          items: listing.items,
        }
        const ready: ThisSiteView = {
          host: { kind: ThisSiteHostKind.Named, host: listing.display_host },
          body: ThisSiteViews.matches(matches),
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
    switch (kind) {
      case SidePanelLoginFillKind.Filled: {
        const filled: ThisSiteFill = { kind: ThisSiteFillKind.Filled, item }
        return ThisSiteViews.onRow(filled)
      }
      case SidePanelLoginFillKind.NoLoginForm: {
        const noForm: ThisSiteFill = {
          kind: ThisSiteFillKind.Failed,
          item,
          failure: ThisSiteFillFailure.NoLoginForm,
        }
        return ThisSiteViews.onRow(noForm)
      }
      case SidePanelLoginFillKind.Forbidden:
      case SidePanelLoginFillKind.PageUnavailable:
      case SidePanelLoginFillKind.FillFailed: {
        const failed: ThisSiteFill = {
          kind: ThisSiteFillKind.Failed,
          item,
          failure: ThisSiteFillFailure.Other,
        }
        return ThisSiteViews.onRow(failed)
      }
      case SidePanelLoginFillKind.Locked:
        // The row says so even if the panel's re-read finds it unlocked.
        return {
          fill: {
            kind: ThisSiteFillKind.Failed,
            item,
            failure: ThisSiteFillFailure.Locked,
          },
          notice: ThisSiteNoticeKind.None,
          reload: ThisSiteReload.None,
          signal: ThisSitePanelSignal.FillLocked,
        }
      case SidePanelLoginFillKind.ItemNotFound: {
        const missing: ThisSiteRelistRequest = {
          notice: ThisSiteNoticeKind.ItemMissing,
          signal: ThisSitePanelSignal.None,
        }
        return ThisSiteViews.relist(missing)
      }
      case SidePanelLoginFillKind.TabChanged:
      case SidePanelLoginFillKind.NonWeb: {
        const moved: ThisSiteRelistRequest = {
          notice: ThisSiteNoticeKind.SiteChanged,
          signal: ThisSitePanelSignal.None,
        }
        return ThisSiteViews.relist(moved)
      }
      case SidePanelLoginFillKind.Unpaired: {
        const unpaired: ThisSiteRelistRequest = {
          notice: ThisSiteNoticeKind.None,
          signal: ThisSitePanelSignal.Unpaired,
        }
        return ThisSiteViews.relist(unpaired)
      }
    }
  }

  /** The row's result line text, when the result is about that row. */
  static resultKey(fill: ThisSiteFill): I18nKey {
    switch (fill.kind) {
      case ThisSiteFillKind.Idle:
      case ThisSiteFillKind.Pending:
        return I18N_KEYS.ExtensionActionFillPending
      case ThisSiteFillKind.Filled:
        return I18N_KEYS.ExtensionActionFillDone
      case ThisSiteFillKind.Failed:
        return ThisSiteViews.failureKey(fill.failure)
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

  static matchCount(items: SidePanelSiteLogins): ThisSiteMatchCount {
    switch (items.length) {
      case 1:
        return ThisSiteMatchCount.One
      default:
        return ThisSiteMatchCount.Several
    }
  }

  private static failureKey(failure: ThisSiteFillFailure): I18nKey {
    switch (failure) {
      case ThisSiteFillFailure.NoLoginForm:
        return I18N_KEYS.ExtensionActionFillNoForm
      case ThisSiteFillFailure.Locked:
        return I18N_KEYS.ExtensionActionFillLocked
      case ThisSiteFillFailure.Other:
        return I18N_KEYS.ExtensionActionFillFailed
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

  /** The login shown no longer fits the tab: list the site again. */
  private static relist(request: ThisSiteRelistRequest): ThisSiteFillOutcome {
    return {
      fill: { kind: ThisSiteFillKind.Idle },
      notice: request.notice,
      reload: ThisSiteReload.List,
      signal: request.signal,
    }
  }

  private static matches(request: ThisSiteMatchesRequest): ThisSiteBody {
    const { host, items } = request
    switch (items.length) {
      case 0:
        return { kind: ThisSiteBodyKind.Empty, host }
      default:
        return {
          kind: ThisSiteBodyKind.Matches,
          items,
          count: ThisSiteViews.matchCount(items),
        }
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
