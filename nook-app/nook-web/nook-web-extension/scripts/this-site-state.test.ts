import { describe, expect, test } from 'bun:test'
import { I18N_KEYS } from '../../nook-web-shared/src/generated/i18n-keys'
import {
  SidePanelLoginFillKind,
  SidePanelSiteListingKind,
  type SidePanelLoginItemId,
  type SidePanelSiteLogin,
  type SidePanelSiteListing,
  type SidePanelSiteListingFailureKind,
} from '../src/lib/side-panel-site'
import { SidePanelChangeKind } from '../src/side-panel/side-panel-runtime'
import {
  ThisSiteBodyKind,
  ThisSiteFillFailure,
  ThisSiteFillKind,
  ThisSiteHostKind,
  ThisSiteMatchCount,
  ThisSiteMemory,
  ThisSiteMemoryKind,
  ThisSiteNoticeKind,
  ThisSitePanelSignal,
  ThisSiteReload,
  ThisSiteRowResult,
  ThisSiteViews,
  type ThisSiteFill,
  type ThisSiteState,
} from '../src/side-panel/this-site-state'

const work: SidePanelSiteLogin = {
  itemId: { vaultStoreId: 'store-work', secretId: 'login-work' },
  username: 'alice@company.example',
  vaultLabel: 'Work',
}
const personal: SidePanelSiteLogin = {
  itemId: { vaultStoreId: 'store-personal', secretId: 'login-personal' },
  username: 'alice@example.com',
  vaultLabel: 'Personal',
}

function fillAnswer(kind: SidePanelLoginFillKind) {
  const request: Parameters<typeof ThisSiteViews.fill>[0] = {
    kind,
    item: work.itemId,
  }
  return ThisSiteViews.fill(request)
}

function shownState(): ThisSiteState {
  const filled: ThisSiteFill = {
    kind: ThisSiteFillKind.Filled,
    item: work.itemId,
  }
  return {
    view: {
      host: { kind: ThisSiteHostKind.Named, host: 'accounts.example.com' },
      body: {
        kind: ThisSiteBodyKind.Matches,
        items: [work, personal],
        count: ThisSiteMatchCount.Several,
        passkeys: [],
      },
    },
    fill: filled,
    notice: ThisSiteNoticeKind.SiteChanged,
  }
}

describe('This site listing', () => {
  test('shows the logins for the host Rust named, in Rust order', () => {
    const listing: SidePanelSiteListing = {
      kind: SidePanelSiteListingKind.Ready,
      display_host: 'accounts.example.com',
      items: [work, personal],
      passkeys: [],
    }
    expect(ThisSiteViews.listing(listing)).toEqual({
      view: {
        host: { kind: ThisSiteHostKind.Named, host: 'accounts.example.com' },
        body: {
          kind: ThisSiteBodyKind.Matches,
          items: [work, personal],
          count: ThisSiteMatchCount.Several,
          passkeys: [],
        },
      },
      signal: ThisSitePanelSignal.None,
    })
  })

  test('passkeys alone still list the site instead of saying nothing is saved', () => {
    const passkey = {
      userName: 'person@example.org',
      userDisplayName: 'Person',
      vaultLabel: 'Personal',
    }
    const listing: SidePanelSiteListing = {
      kind: SidePanelSiteListingKind.Ready,
      display_host: 'news.example.org',
      items: [],
      passkeys: [passkey],
    }
    expect(ThisSiteViews.listing(listing)).toEqual({
      view: {
        host: { kind: ThisSiteHostKind.Named, host: 'news.example.org' },
        body: {
          kind: ThisSiteBodyKind.Matches,
          items: [],
          count: ThisSiteMatchCount.Several,
          passkeys: [passkey],
        },
      },
      signal: ThisSitePanelSignal.None,
    })
  })

  test('an empty list names the site; only a ready answer can be empty', () => {
    const listing: SidePanelSiteListing = {
      kind: SidePanelSiteListingKind.Ready,
      display_host: 'news.example.org',
      items: [],
      passkeys: [],
    }
    expect(ThisSiteViews.listing(listing)).toEqual({
      view: {
        host: { kind: ThisSiteHostKind.Named, host: 'news.example.org' },
        body: { kind: ThisSiteBodyKind.Empty, host: 'news.example.org' },
      },
      signal: ThisSitePanelSignal.None,
    })
  })

  test('a failed or refused listing is a failure, never "no saved logins"', () => {
    const refusals: readonly SidePanelSiteListingFailureKind[] = [
      SidePanelSiteListingKind.ListFailed,
      SidePanelSiteListingKind.Forbidden,
    ]
    for (const kind of refusals) {
      const listing: SidePanelSiteListing = { kind }
      expect(ThisSiteViews.listing(listing)).toEqual({
        view: {
          host: { kind: ThisSiteHostKind.Unnamed },
          body: { kind: ThisSiteBodyKind.Failed },
        },
        signal: ThisSitePanelSignal.None,
      })
    }
  })

  test('tabs without a website, and pages Nook cannot fill, offer no Fill', () => {
    const nonWeb: SidePanelSiteListing = {
      kind: SidePanelSiteListingKind.NonWeb,
    }
    expect(ThisSiteViews.listing(nonWeb).view).toEqual({
      host: { kind: ThisSiteHostKind.NoWebsite },
      body: { kind: ThisSiteBodyKind.NotWeb },
    })
    const vaultApp: SidePanelSiteListing = {
      kind: SidePanelSiteListingKind.PageUnavailable,
    }
    expect(ThisSiteViews.listing(vaultApp).view).toEqual({
      host: { kind: ThisSiteHostKind.Unnamed },
      body: { kind: ThisSiteBodyKind.Restricted },
    })
  })

  test('locked and unpaired answers end visibly and ask the panel to re-read', () => {
    const locked: SidePanelSiteListing = {
      kind: SidePanelSiteListingKind.Locked,
    }
    expect(ThisSiteViews.listing(locked)).toEqual({
      view: {
        host: { kind: ThisSiteHostKind.Unnamed },
        body: { kind: ThisSiteBodyKind.Locked },
      },
      signal: ThisSitePanelSignal.Locked,
    })
    // Vaults paired for passkeys only: none of them fills passwords.
    const unpaired: SidePanelSiteListing = {
      kind: SidePanelSiteListingKind.Unpaired,
    }
    expect(ThisSiteViews.listing(unpaired)).toEqual({
      view: {
        host: { kind: ThisSiteHostKind.Unnamed },
        body: { kind: ThisSiteBodyKind.NoFillingVault },
      },
      signal: ThisSitePanelSignal.Unpaired,
    })
  })
})

describe('This site Fill', () => {
  test('a filled login says to review the page and sign in', () => {
    const filled: ThisSiteFill = {
      kind: ThisSiteFillKind.Filled,
      item: work.itemId,
    }
    expect(fillAnswer(SidePanelLoginFillKind.Filled)).toEqual({
      fill: filled,
      notice: ThisSiteNoticeKind.None,
      reload: ThisSiteReload.None,
      signal: ThisSitePanelSignal.None,
    })
    expect(ThisSiteViews.resultKey(filled)).toBe(
      I18N_KEYS.ExtensionActionFillDone,
    )
  })

  test('every failure is visible on the row, by its own reason', () => {
    const noForm = fillAnswer(SidePanelLoginFillKind.NoLoginForm)
    expect(noForm.fill).toEqual({
      kind: ThisSiteFillKind.Failed,
      item: work.itemId,
      failure: ThisSiteFillFailure.NoLoginForm,
    })
    expect(ThisSiteViews.resultKey(noForm.fill)).toBe(
      I18N_KEYS.ExtensionActionFillNoForm,
    )
    for (const kind of [
      SidePanelLoginFillKind.FillFailed,
      SidePanelLoginFillKind.Forbidden,
      SidePanelLoginFillKind.PageUnavailable,
    ]) {
      const outcome = fillAnswer(kind)
      expect(outcome.fill).toEqual({
        kind: ThisSiteFillKind.Failed,
        item: work.itemId,
        failure: ThisSiteFillFailure.Other,
      })
      expect(outcome.reload).toBe(ThisSiteReload.None)
      expect(ThisSiteViews.resultKey(outcome.fill)).toBe(
        I18N_KEYS.ExtensionActionFillFailed,
      )
    }
  })

  test('a locked fill stays on the row while the panel re-reads the lock', () => {
    const outcome = fillAnswer(SidePanelLoginFillKind.Locked)
    expect(outcome.fill).toEqual({
      kind: ThisSiteFillKind.Failed,
      item: work.itemId,
      failure: ThisSiteFillFailure.Locked,
    })
    expect(outcome.signal).toBe(ThisSitePanelSignal.FillLocked)
    expect(ThisSiteViews.resultKey(outcome.fill)).toBe(
      I18N_KEYS.ExtensionActionFillLocked,
    )
  })

  test('a tab that moved on and a login that is gone say so and relist', () => {
    for (const kind of [
      SidePanelLoginFillKind.TabChanged,
      SidePanelLoginFillKind.NonWeb,
    ]) {
      expect(fillAnswer(kind)).toEqual({
        fill: { kind: ThisSiteFillKind.Idle },
        notice: ThisSiteNoticeKind.SiteChanged,
        reload: ThisSiteReload.List,
        signal: ThisSitePanelSignal.None,
      })
    }
    // A deleted login on the same site is not a tab that moved.
    expect(fillAnswer(SidePanelLoginFillKind.ItemNotFound)).toEqual({
      fill: { kind: ThisSiteFillKind.Idle },
      notice: ThisSiteNoticeKind.ItemMissing,
      reload: ThisSiteReload.List,
      signal: ThisSitePanelSignal.None,
    })
    expect(ThisSiteViews.noticeKey(ThisSiteNoticeKind.ItemMissing)).toBe(
      I18N_KEYS.ExtensionActionFillItemMissing,
    )
    expect(ThisSiteViews.noticeKey(ThisSiteNoticeKind.SiteChanged)).toBe(
      I18N_KEYS.ExtensionActionFillSiteChanged,
    )
    expect(fillAnswer(SidePanelLoginFillKind.Unpaired)).toEqual({
      fill: { kind: ThisSiteFillKind.Idle },
      notice: ThisSiteNoticeKind.None,
      reload: ThisSiteReload.List,
      signal: ThisSitePanelSignal.Unpaired,
    })
  })

  test('the result shows on the filled row only', () => {
    const pending: ThisSiteFill = {
      kind: ThisSiteFillKind.Pending,
      item: work.itemId,
    }
    const workRow: Parameters<typeof ThisSiteViews.rowResult>[0] = {
      fill: pending,
      item: work.itemId,
    }
    const otherItem: SidePanelLoginItemId = {
      vaultStoreId: work.itemId.vaultStoreId,
      secretId: personal.itemId.secretId,
    }
    const otherRow: Parameters<typeof ThisSiteViews.rowResult>[0] = {
      fill: pending,
      item: otherItem,
    }
    expect(ThisSiteViews.rowResult(workRow)).toBe(ThisSiteRowResult.Shown)
    expect(ThisSiteViews.rowResult(otherRow)).toBe(ThisSiteRowResult.None)
    expect(ThisSiteViews.resultKey(pending)).toBe(
      I18N_KEYS.ExtensionActionFillPending,
    )
  })

  test('one match gets the primary Fill, several share secondary ones', () => {
    expect(ThisSiteViews.matchCount([work])).toBe(ThisSiteMatchCount.One)
    expect(ThisSiteViews.matchCount([work, personal])).toBe(
      ThisSiteMatchCount.Several,
    )
  })
})

describe('This site memory', () => {
  test('a tab switch drops logins, results and the site note, then lists again', () => {
    const request: Parameters<typeof ThisSiteMemory.changed>[0] = {
      state: shownState(),
      change: SidePanelChangeKind.TabActivated,
    }
    expect(ThisSiteMemory.changed(request)).toEqual({
      memory: ThisSiteMemoryKind.Dropped,
      state: ThisSiteMemory.initial(),
      reload: ThisSiteReload.List,
    })
  })

  test('a new address drops logins and results but keeps the site note', () => {
    const request: Parameters<typeof ThisSiteMemory.changed>[0] = {
      state: shownState(),
      change: SidePanelChangeKind.TabNavigated,
    }
    const result = ThisSiteMemory.changed(request)
    expect(result.memory).toBe(ThisSiteMemoryKind.Dropped)
    expect(result.state.view.body).toEqual({ kind: ThisSiteBodyKind.Loading })
    expect(result.state.fill).toEqual({ kind: ThisSiteFillKind.Idle })
    expect(result.state.notice).toBe(ThisSiteNoticeKind.SiteChanged)
    expect(result.reload).toBe(ThisSiteReload.List)
  })

  test('a hidden panel keeps nothing about the page and waits to be shown', () => {
    const hidden: Parameters<typeof ThisSiteMemory.changed>[0] = {
      state: shownState(),
      change: SidePanelChangeKind.PanelHidden,
    }
    expect(ThisSiteMemory.changed(hidden)).toEqual({
      memory: ThisSiteMemoryKind.Dropped,
      state: ThisSiteMemory.initial(),
      reload: ThisSiteReload.None,
    })
    const shown: Parameters<typeof ThisSiteMemory.changed>[0] = {
      state: ThisSiteMemory.initial(),
      change: SidePanelChangeKind.PanelShown,
    }
    expect(ThisSiteMemory.changed(shown).reload).toBe(ThisSiteReload.List)
  })

  test('a click into the panel keeps the list under the pointer', () => {
    const state = shownState()
    const request: Parameters<typeof ThisSiteMemory.changed>[0] = {
      state,
      change: SidePanelChangeKind.PanelFocused,
    }
    expect(ThisSiteMemory.changed(request)).toEqual({
      memory: ThisSiteMemoryKind.Kept,
      state,
      reload: ThisSiteReload.None,
    })
  })
})
