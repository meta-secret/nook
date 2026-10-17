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
 * panel's visibility or the lock state changes.
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
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  Failed = 'failed',
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
  | { readonly kind: ThisSiteBodyKind.Failed }

export type ThisSiteView = {
  readonly host: ThisSiteHost
  readonly body: ThisSiteBody
}

/** What a listing answer asks of the panel. */
export enum ThisSiteListingOutcomeKind {
  Show = 'show',
  /** The extension locked: the panel shows its locked view. */
  Locked = 'locked',
  /** No identity is paired any more: the panel re-reads its vaults. */
  Unpaired = 'unpaired',
}

export type ThisSiteListingOutcome =
  | {
      readonly kind: ThisSiteListingOutcomeKind.Show
      readonly view: ThisSiteView
    }
  | { readonly kind: ThisSiteListingOutcomeKind.Locked }
  | { readonly kind: ThisSiteListingOutcomeKind.Unpaired }

/** Fill shows one result at a time for the whole section. */
export enum ThisSiteFillKind {
  Idle = 'idle',
  Pending = 'pending',
  Filled = 'filled',
  Failed = 'failed',
}

export enum ThisSiteFillFailure {
  NoLoginForm = 'no-login-form',
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

/** What a Fill answer asks of the panel. */
export enum ThisSiteFillOutcomeKind {
  /** Show the result on the row. */
  Result = 'result',
  /** The tab moved on: say so above the list and list the site again. */
  SiteChanged = 'site-changed',
  /** The extension locked before filling. */
  Locked = 'locked',
  Unpaired = 'unpaired',
}

export type ThisSiteFillOutcome =
  | {
      readonly kind: ThisSiteFillOutcomeKind.Result
      readonly fill: ThisSiteFill
    }
  | { readonly kind: ThisSiteFillOutcomeKind.SiteChanged }
  | { readonly kind: ThisSiteFillOutcomeKind.Locked }
  | { readonly kind: ThisSiteFillOutcomeKind.Unpaired }

/** Whether a row's login is the one the section's result is about. */
export enum ThisSiteRowResult {
  None = 'none',
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  Shown = 'shown',
}

/** Whether one login or several match: one match gets the primary Fill. */
export enum ThisSiteMatchCount {
  One = 'one',
  Several = 'several',
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

/** Maps the service worker's This-site answers to what the panel shows. */
export class ThisSiteViews {
  private constructor() {}

  static loading(): ThisSiteView {
    return {
      host: { kind: ThisSiteHostKind.Unnamed },
      body: { kind: ThisSiteBodyKind.Loading },
    }
  }

  /** The window could not be named, so no tab can be listed. */
  static failed(): ThisSiteView {
    return {
      host: { kind: ThisSiteHostKind.Unnamed },
      body: { kind: ThisSiteBodyKind.Failed },
    }
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
        return ThisSiteViews.show(ready)
      }
      case SidePanelSiteListingKind.NonWeb: {
        const nonWeb: ThisSiteView = {
          host: { kind: ThisSiteHostKind.NoWebsite },
          body: { kind: ThisSiteBodyKind.NotWeb },
        }
        return ThisSiteViews.show(nonWeb)
      }
      case SidePanelSiteListingKind.PageUnavailable: {
        const restricted: ThisSiteView = {
          host: { kind: ThisSiteHostKind.Unnamed },
          body: { kind: ThisSiteBodyKind.Restricted },
        }
        return ThisSiteViews.show(restricted)
      }
      case SidePanelSiteListingKind.Forbidden:
      case SidePanelSiteListingKind.ListFailed:
        return ThisSiteViews.show(ThisSiteViews.failed())
      case SidePanelSiteListingKind.Locked:
        return { kind: ThisSiteListingOutcomeKind.Locked }
      case SidePanelSiteListingKind.Unpaired:
        return { kind: ThisSiteListingOutcomeKind.Unpaired }
    }
  }

  static fill(answer: ThisSiteFillAnswerRequest): ThisSiteFillOutcome {
    const { kind, item } = answer
    switch (kind) {
      case SidePanelLoginFillKind.Filled: {
        const filled: ThisSiteFill = { kind: ThisSiteFillKind.Filled, item }
        return ThisSiteViews.result(filled)
      }
      case SidePanelLoginFillKind.NoLoginForm: {
        const noForm: ThisSiteFill = {
          kind: ThisSiteFillKind.Failed,
          item,
          failure: ThisSiteFillFailure.NoLoginForm,
        }
        return ThisSiteViews.result(noForm)
      }
      case SidePanelLoginFillKind.Forbidden:
      case SidePanelLoginFillKind.PageUnavailable:
      case SidePanelLoginFillKind.FillFailed: {
        const failed: ThisSiteFill = {
          kind: ThisSiteFillKind.Failed,
          item,
          failure: ThisSiteFillFailure.Other,
        }
        return ThisSiteViews.result(failed)
      }
      // The login no longer belongs to the tab's site, or the tab left it.
      case SidePanelLoginFillKind.ItemNotFound:
      case SidePanelLoginFillKind.TabChanged:
      case SidePanelLoginFillKind.NonWeb:
        return { kind: ThisSiteFillOutcomeKind.SiteChanged }
      case SidePanelLoginFillKind.Locked:
        return { kind: ThisSiteFillOutcomeKind.Locked }
      case SidePanelLoginFillKind.Unpaired:
        return { kind: ThisSiteFillOutcomeKind.Unpaired }
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
      case ThisSiteFillFailure.Other:
        return I18N_KEYS.ExtensionActionFillFailed
    }
  }

  private static show(view: ThisSiteView): ThisSiteListingOutcome {
    return { kind: ThisSiteListingOutcomeKind.Show, view }
  }

  private static result(fill: ThisSiteFill): ThisSiteFillOutcome {
    return { kind: ThisSiteFillOutcomeKind.Result, fill }
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

/** The note above the list after a Fill found the tab on another site. */
export enum ThisSiteNoticeKind {
  None = 'none',
  SiteChanged = 'site-changed',
}

/** Everything This site shows; it lives only in the panel's memory. */
export type ThisSiteState = {
  readonly view: ThisSiteView
  readonly fill: ThisSiteFill
  readonly notice: ThisSiteNoticeKind
}

/** Whether a change asks for the active tab's logins again. */
export enum ThisSiteReload {
  List = 'list',
  None = 'none',
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

/** What This site keeps, drops and re-reads when the panel's surroundings
 * change: logins never outlive the tab, its address or the panel's
 * visibility; a site-changed note outlives only the reload it caused. */
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

type ThisSiteDropRequest = {
  readonly notice: ThisSiteNoticeKind
  readonly reload: ThisSiteReload
}
