import { describe, expect, test } from 'bun:test'
import type {
  SiteSecretListingSummary,
  SiteSecretRow,
  SiteSecretSection,
} from '../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { I18N_KEYS } from '../../nook-web-shared/src/generated/i18n-keys'
import {
  SidePanelCodeFillKind,
  SidePanelLoginFillKind,
  SidePanelSiteListingKind,
  type SidePanelLoginItemId,
  type SidePanelSiteListing,
  type SidePanelSiteListingFailureKind,
} from '../src/lib/side-panel-site'
import { SidePanelChangeKind } from '../src/side-panel/side-panel-runtime'
import {
  ThisSiteBodyKind,
  ThisSiteFillAction,
  ThisSiteFillChoiceKind,
  ThisSiteFillFailure,
  ThisSiteFillKind,
  ThisSiteHostKind,
  ThisSiteLiveAnnouncementKind,
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

/** Display rows as Rust presents them: no secret, every text chosen by key. */
class Rows {
  static login(secretId: string, account: string): SiteSecretRow {
    return {
      kind: 'Login',
      item_id: { vault_store_id: 'store-work', secret_id: secretId },
      type_label_key: I18N_KEYS.VaultTypesLogin,
      title: 'accounts.example.com',
      account,
      saved_host: 'accounts.example.com',
      action: {
        kind: 'FillLogin',
        label_key: I18N_KEYS.ExtensionActionFill,
        accessible_label_key: I18N_KEYS.ExtensionActionFillLogin,
      },
    }
  }

  static authenticator(): SiteSecretRow {
    return {
      kind: 'Authenticator',
      item_id: { vault_store_id: 'store-work', secret_id: 'totp-work' },
      type_label_key: I18N_KEYS.VaultTypesAuthenticator,
      title: 'Example',
      account: 'alice@company.example',
      saved_host: 'accounts.example.com',
      action: {
        kind: 'FillCode',
        label_key: I18N_KEYS.ExtensionActionFillCode,
        accessible_label_key: I18N_KEYS.ExtensionActionFillCodeFor,
      },
    }
  }

  static passkey(): SiteSecretRow {
    return {
      kind: 'Passkey',
      item_id: { vault_store_id: 'store-personal', secret_id: 'passkey-one' },
      type_label_key: I18N_KEYS.VaultTypesPasskey,
      title: 'Example',
      account: 'alice',
      saved_host: 'accounts.example.com',
      action: { kind: 'ViewOnly' },
    }
  }
}

/** One vault that lists rows: which vault, and its rows in Rust's order. */
type ListedSectionRequest = {
  readonly vaultStoreId: string
  readonly rows: SiteSecretRow[]
}

/** Identity:vault sections as Rust presents them, in Rust's order. */
class Sections {
  static listed(request: ListedSectionRequest): SiteSecretSection {
    return {
      vault_store_id: request.vaultStoreId,
      identity: { kind: 'Named', name: 'work' },
      vault: { kind: 'Named', name: 'Work' },
      content: { kind: 'Listed', rows: request.rows },
    }
  }

  /** A vault with nothing the page needs: Rust's muted line. */
  static empty(vaultStoreId: string): SiteSecretSection {
    return {
      vault_store_id: vaultStoreId,
      identity: {
        kind: 'Unnamed',
        message_key: I18N_KEYS.ExtensionCompanionOtherVaults,
      },
      vault: {
        kind: 'Unnamed',
        message_key: I18N_KEYS.LoginVaultPickerUnnamed,
      },
      content: {
        kind: 'Empty',
        message_key: I18N_KEYS.ExtensionActionSiteVaultEmpty,
      },
    }
  }
}

const work = Rows.login('login-work', 'alice@company.example')
const personal = Rows.login('login-personal', 'alice@example.com')
const workId: SidePanelLoginItemId = ThisSiteViews.itemId(work)
const workVault: ListedSectionRequest = {
  vaultStoreId: 'store-work',
  rows: [work, personal, Rows.authenticator()],
}
const personalVault: ListedSectionRequest = {
  vaultStoreId: 'store-personal',
  rows: [Rows.passkey()],
}
const sections: SiteSecretSection[] = [
  Sections.listed(workVault),
  Sections.listed(personalVault),
  Sections.empty('store-archive'),
]

function fillAnswer(kind: SidePanelLoginFillKind) {
  const request: Parameters<typeof ThisSiteViews.fill>[0] = {
    kind,
    item: workId,
  }
  return ThisSiteViews.fill(request)
}

function codeAnswer(kind: SidePanelCodeFillKind) {
  const request: Parameters<typeof ThisSiteViews.codeFill>[0] = {
    kind,
    item: workId,
  }
  return ThisSiteViews.codeFill(request)
}

function shownState(): ThisSiteState {
  const filled: ThisSiteFill = {
    kind: ThisSiteFillKind.Filled,
    item: workId,
    action: ThisSiteFillAction.Login,
  }
  return {
    view: {
      host: { kind: ThisSiteHostKind.Named, host: 'accounts.example.com' },
      body: {
        kind: ThisSiteBodyKind.Matches,
        sections,
        count: ThisSiteMatchCount.Several,
      },
    },
    fill: filled,
    notice: ThisSiteNoticeKind.SiteChanged,
  }
}

describe('This site listing', () => {
  test("shows every identity:vault section Rust presented, empty ones included, in Rust's order", () => {
    const listing: SidePanelSiteListing = {
      kind: SidePanelSiteListingKind.Ready,
      display_host: 'accounts.example.com',
      listing: { summary: { kind: 'Listed' }, sections },
    }
    expect(ThisSiteViews.listing(listing)).toEqual({
      view: {
        host: { kind: ThisSiteHostKind.Named, host: 'accounts.example.com' },
        body: {
          kind: ThisSiteBodyKind.Matches,
          sections,
          count: ThisSiteMatchCount.Several,
        },
      },
      signal: ThisSitePanelSignal.None,
    })
  })

  test("with no row anywhere, Rust's empty state names the site above the sections", () => {
    const empty: SiteSecretListingSummary = {
      kind: 'Empty',
      message_key: I18N_KEYS.ExtensionActionSiteEmptyTotp,
      hint: {
        kind: 'Shown',
        message_key: I18N_KEYS.ExtensionActionSiteEmptyHint,
      },
    }
    const vaults = [Sections.empty('store-work'), Sections.empty('store-home')]
    const listing: SidePanelSiteListing = {
      kind: SidePanelSiteListingKind.Ready,
      display_host: 'www.namecheap.com',
      listing: { summary: empty, sections: vaults },
    }
    expect(ThisSiteViews.listing(listing)).toEqual({
      view: {
        host: { kind: ThisSiteHostKind.Named, host: 'www.namecheap.com' },
        body: {
          kind: ThisSiteBodyKind.Empty,
          host: 'www.namecheap.com',
          empty,
          sections: vaults,
          count: ThisSiteMatchCount.None,
        },
      },
      signal: ThisSitePanelSignal.None,
    })
  })

  test('a ready answer with no connected vault shows its empty state and no section', () => {
    const empty: SiteSecretListingSummary = {
      kind: 'Empty',
      message_key: I18N_KEYS.ExtensionActionSiteEmptyAny,
      hint: { kind: 'Absent' },
    }
    const listing: SidePanelSiteListing = {
      kind: SidePanelSiteListingKind.Ready,
      display_host: 'news.example.org',
      listing: { summary: empty, sections: [] },
    }
    expect(ThisSiteViews.listing(listing).view.body).toEqual({
      kind: ThisSiteBodyKind.Empty,
      host: 'news.example.org',
      empty,
      sections: [],
      count: ThisSiteMatchCount.None,
    })
  })

  test('each row action chooses its request; passkeys and API keys send none', () => {
    expect(ThisSiteViews.fillChoice(work)).toEqual({
      kind: ThisSiteFillChoiceKind.Fills,
      action: ThisSiteFillAction.Login,
    })
    expect(ThisSiteViews.fillChoice(Rows.authenticator())).toEqual({
      kind: ThisSiteFillChoiceKind.Fills,
      action: ThisSiteFillAction.Code,
    })
    expect(ThisSiteViews.fillChoice(Rows.passkey())).toEqual({
      kind: ThisSiteFillChoiceKind.ViewOnly,
    })
    expect(ThisSiteViews.itemId(Rows.authenticator())).toEqual({
      vaultStoreId: 'store-work',
      secretId: 'totp-work',
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
      item: workId,
      action: ThisSiteFillAction.Login,
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
      item: workId,
      action: ThisSiteFillAction.Login,
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
        item: workId,
        action: ThisSiteFillAction.Login,
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
      item: workId,
      action: ThisSiteFillAction.Login,
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
      item: workId,
      action: ThisSiteFillAction.Login,
    }
    const workRow: Parameters<typeof ThisSiteViews.rowResult>[0] = {
      fill: pending,
      item: workId,
    }
    const otherItem: SidePanelLoginItemId = {
      vaultStoreId: workId.vaultStoreId,
      secretId: personal.item_id.secret_id,
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

  test('a code fill reports its own outcomes on the authenticator row', () => {
    const filled = codeAnswer(SidePanelCodeFillKind.Filled)
    expect(filled.fill).toEqual({
      kind: ThisSiteFillKind.Filled,
      item: workId,
      action: ThisSiteFillAction.Code,
    })
    expect(ThisSiteViews.resultKey(filled.fill)).toBe(
      I18N_KEYS.ExtensionActionFillCodeDone,
    )
    const noField = codeAnswer(SidePanelCodeFillKind.NoCodeField)
    expect(noField.fill).toEqual({
      kind: ThisSiteFillKind.Failed,
      item: workId,
      action: ThisSiteFillAction.Code,
      failure: ThisSiteFillFailure.NoCodeField,
    })
    expect(ThisSiteViews.resultKey(noField.fill)).toBe(
      I18N_KEYS.ExtensionActionFillNoCodeField,
    )
    const failed = codeAnswer(SidePanelCodeFillKind.FillFailed)
    expect(ThisSiteViews.resultKey(failed.fill)).toBe(
      I18N_KEYS.ExtensionActionFillCodeFailed,
    )
    const locked = codeAnswer(SidePanelCodeFillKind.Locked)
    expect(locked.signal).toBe(ThisSitePanelSignal.FillLocked)
    expect(ThisSiteViews.resultKey(locked.fill)).toBe(
      I18N_KEYS.ExtensionActionFillLocked,
    )
    expect(codeAnswer(SidePanelCodeFillKind.ItemNotFound)).toEqual({
      fill: { kind: ThisSiteFillKind.Idle },
      notice: ThisSiteNoticeKind.CodeMissing,
      reload: ThisSiteReload.List,
      signal: ThisSitePanelSignal.None,
    })
    expect(ThisSiteViews.noticeKey(ThisSiteNoticeKind.CodeMissing)).toBe(
      I18N_KEYS.ExtensionActionFillCodeMissing,
    )
    expect(codeAnswer(SidePanelCodeFillKind.TabChanged).notice).toBe(
      ThisSiteNoticeKind.SiteChanged,
    )
  })

  test('the live region announces each fill with its own text and leaves failures to the row', () => {
    const pending: ThisSiteFill = {
      kind: ThisSiteFillKind.Pending,
      item: workId,
      action: ThisSiteFillAction.Code,
    }
    expect(ThisSiteViews.liveAnnouncement(pending)).toEqual({
      kind: ThisSiteLiveAnnouncementKind.Announced,
      key: I18N_KEYS.ExtensionActionFillPending,
    })
    // A filled code is not announced as a filled login.
    expect(
      ThisSiteViews.liveAnnouncement(
        codeAnswer(SidePanelCodeFillKind.Filled).fill,
      ),
    ).toEqual({
      kind: ThisSiteLiveAnnouncementKind.Announced,
      key: I18N_KEYS.ExtensionActionFillCodeDone,
    })
    expect(
      ThisSiteViews.liveAnnouncement(
        fillAnswer(SidePanelLoginFillKind.Filled).fill,
      ),
    ).toEqual({
      kind: ThisSiteLiveAnnouncementKind.Announced,
      key: I18N_KEYS.ExtensionActionFillDone,
    })
    for (const fill of [
      codeAnswer(SidePanelCodeFillKind.FillFailed).fill,
      ThisSiteMemory.initial().fill,
    ]) {
      expect(ThisSiteViews.liveAnnouncement(fill)).toEqual({
        kind: ThisSiteLiveAnnouncementKind.Silent,
      })
    }
  })

  test('one match gets the primary Fill, several share secondary ones', () => {
    // Empty sections list no row; the one row elsewhere stays primary.
    const workOnly: ListedSectionRequest = {
      vaultStoreId: 'store-work',
      rows: [work],
    }
    const one: SiteSecretSection[] = [
      Sections.empty('store-home'),
      Sections.listed(workOnly),
      Sections.empty('store-archive'),
    ]
    expect(ThisSiteViews.matchCount(one)).toBe(ThisSiteMatchCount.One)
    // Rows count across sections, whichever identity or vault lists them.
    const acrossVaults: SiteSecretSection[] = [
      Sections.listed(workOnly),
      Sections.listed(personalVault),
    ]
    expect(ThisSiteViews.matchCount(acrossVaults)).toBe(
      ThisSiteMatchCount.Several,
    )
    expect(ThisSiteViews.matchCount(sections)).toBe(ThisSiteMatchCount.Several)
    expect(ThisSiteViews.matchCount([Sections.empty('store-home')])).toBe(
      ThisSiteMatchCount.None,
    )
    expect(ThisSiteViews.matchCount([])).toBe(ThisSiteMatchCount.None)
  })

  test("a section lists its own rows in Rust's order, or none with its empty line", () => {
    const twoLogins: ListedSectionRequest = {
      vaultStoreId: 'store-work',
      rows: [work, personal],
    }
    const listed = Sections.listed(twoLogins)
    expect(ThisSiteViews.sectionRows(listed.content)).toEqual([work, personal])
    expect(
      ThisSiteViews.sectionRows(Sections.empty('store-archive').content),
    ).toEqual([])
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
  test('a vault change lists the site again while the current list stays shown', () => {
    const state = shownState()
    const request: Parameters<typeof ThisSiteMemory.changed>[0] = {
      state,
      change: SidePanelChangeKind.VaultChanged,
    }
    expect(ThisSiteMemory.changed(request)).toEqual({
      memory: ThisSiteMemoryKind.Kept,
      state,
      reload: ThisSiteReload.List,
    })
  })
})
