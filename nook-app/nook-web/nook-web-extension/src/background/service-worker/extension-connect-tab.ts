import { Effect, Schema } from 'effect'

/**
 * The one Nook tab a connect runs in. The requesting extension page names
 * its own window; the service worker checks that window itself, reuses an
 * open Simple Vault tab there (navigating it to the fresh connect URL) or
 * opens the connect route in a new tab of that window, focuses it, and
 * returns its tab id. Nothing else opens a page during the connect.
 */
export enum ExtensionConnectTabFailureKind {
  /** The window does not exist, is not a normal window, or belongs to
   * another incognito context. */
  WindowUnavailable = 'window-unavailable',
  /** The browser did not name the tab it opened. */
  TabUnavailable = 'tab-unavailable',
  /** A browser tab or window call failed. */
  Browser = 'browser',
}

type ExtensionConnectTabFailureSchemaFields = {
  readonly kind: Schema.Codec<ExtensionConnectTabFailureKind>
}

const extensionConnectTabFailureFields: ExtensionConnectTabFailureSchemaFields =
  { kind: Schema.Enum(ExtensionConnectTabFailureKind) }

export class ExtensionConnectTabFailure extends Schema.TaggedError<ExtensionConnectTabFailure>()(
  'ExtensionConnectTabFailure',
  extensionConnectTabFailureFields,
) {}

/** The Simple Vault origin rule; Rust/WASM owns it. */
export interface ExtensionConnectTabOrigin {
  isRuntimeSimpleVaultUrl(candidateUrl: string): Promise<boolean>
}

export type ExtensionConnectTabRequest = {
  readonly windowId: number
  /** The fresh connect URL, with its new handoff nonce. */
  readonly url: string
}

/** Whether a tab is the active one of its window. */
export enum ExtensionConnectTabFocus {
  Active = 'active',
  Background = 'background',
}

export enum ExtensionConnectTabRecencyKind {
  Known = 'known',
  /** The browser did not report when the tab was last active. */
  Unreported = 'unreported',
}

export type ExtensionConnectTabRecency =
  | {
      readonly kind: ExtensionConnectTabRecencyKind.Known
      readonly lastAccessed: number
    }
  | { readonly kind: ExtensionConnectTabRecencyKind.Unreported }

/** A Simple Vault tab of the requesting window. */
export type ExtensionConnectTabCandidate = {
  readonly tabId: number
  readonly index: number
  readonly focus: ExtensionConnectTabFocus
  readonly recency: ExtensionConnectTabRecency
}

export type ExtensionConnectTabCandidates =
  readonly ExtensionConnectTabCandidate[]

export enum ExtensionConnectTabSelectionKind {
  Reuse = 'reuse',
  Open = 'open',
}

export type ExtensionConnectTabSelection =
  | {
      readonly kind: ExtensionConnectTabSelectionKind.Reuse
      readonly tabId: number
    }
  | { readonly kind: ExtensionConnectTabSelectionKind.Open }

type ExtensionConnectTabRanking = {
  readonly first: ExtensionConnectTabCandidate
  readonly second: ExtensionConnectTabCandidate
}

enum ExtensionConnectTabLeaderKind {
  None = 'none',
  Leading = 'leading',
}

type ExtensionConnectTabLeader =
  | { readonly kind: ExtensionConnectTabLeaderKind.None }
  | {
      readonly kind: ExtensionConnectTabLeaderKind.Leading
      readonly candidate: ExtensionConnectTabCandidate
    }

type ExtensionConnectTabChallenge = {
  readonly leader: ExtensionConnectTabLeader
  readonly candidate: ExtensionConnectTabCandidate
}

enum ExtensionConnectTabPreference {
  First = 'first',
  Second = 'second',
}

/**
 * Which open Simple Vault tab a connect reuses: the window's active tab
 * when it is one, otherwise the one most recently active, and the first in
 * tab-strip order when that still ties. A tab whose last activity the
 * browser did not report ranks after every tab whose activity it did.
 * No Simple Vault tab in the window: a new tab opens there.
 */
export class ExtensionConnectTabChoice {
  constructor(private readonly candidates: ExtensionConnectTabCandidates) {}

  selection(): ExtensionConnectTabSelection {
    let leader: ExtensionConnectTabLeader = {
      kind: ExtensionConnectTabLeaderKind.None,
    }
    for (const candidate of this.candidates) {
      const challenge: ExtensionConnectTabChallenge = { leader, candidate }
      leader = ExtensionConnectTabChoice.lead(challenge)
    }
    switch (leader.kind) {
      case ExtensionConnectTabLeaderKind.None:
        return { kind: ExtensionConnectTabSelectionKind.Open }
      case ExtensionConnectTabLeaderKind.Leading:
        return {
          kind: ExtensionConnectTabSelectionKind.Reuse,
          tabId: leader.candidate.tabId,
        }
    }
  }

  private static lead(
    challenge: ExtensionConnectTabChallenge,
  ): ExtensionConnectTabLeader {
    const { leader, candidate } = challenge
    switch (leader.kind) {
      case ExtensionConnectTabLeaderKind.None:
        return { kind: ExtensionConnectTabLeaderKind.Leading, candidate }
      case ExtensionConnectTabLeaderKind.Leading:
        break
    }
    const ranking: ExtensionConnectTabRanking = {
      first: candidate,
      second: leader.candidate,
    }
    switch (ExtensionConnectTabChoice.preference(ranking)) {
      case ExtensionConnectTabPreference.First:
        return { kind: ExtensionConnectTabLeaderKind.Leading, candidate }
      case ExtensionConnectTabPreference.Second:
        return leader
    }
  }

  private static preference(
    ranking: ExtensionConnectTabRanking,
  ): ExtensionConnectTabPreference {
    const { first, second } = ranking
    const order = [
      ExtensionConnectTabChoice.focusRank(first.focus) -
        ExtensionConnectTabChoice.focusRank(second.focus),
      ExtensionConnectTabChoice.recencyOrder(ranking),
      second.index - first.index,
    ].find((difference) => difference !== 0)
    switch (typeof order === 'number' && order > 0) {
      case true:
        return ExtensionConnectTabPreference.First
      case false:
        return ExtensionConnectTabPreference.Second
    }
  }

  private static focusRank(focus: ExtensionConnectTabFocus): number {
    switch (focus) {
      case ExtensionConnectTabFocus.Active:
        return 1
      case ExtensionConnectTabFocus.Background:
        return 0
    }
  }

  /** Positive when the first tab was active more recently. */
  private static recencyOrder(ranking: ExtensionConnectTabRanking): number {
    const { first, second } = ranking
    switch (first.recency.kind) {
      case ExtensionConnectTabRecencyKind.Unreported:
        return ExtensionConnectTabChoice.unreportedOrder(second.recency)
      case ExtensionConnectTabRecencyKind.Known:
        break
    }
    switch (second.recency.kind) {
      case ExtensionConnectTabRecencyKind.Unreported:
        return 1
      case ExtensionConnectTabRecencyKind.Known:
        return first.recency.lastAccessed - second.recency.lastAccessed
    }
  }

  /** An unreported tab against another tab's recency. */
  private static unreportedOrder(other: ExtensionConnectTabRecency): number {
    switch (other.kind) {
      case ExtensionConnectTabRecencyKind.Unreported:
        return 0
      case ExtensionConnectTabRecencyKind.Known:
        return -1
    }
  }
}

enum ExtensionConnectWindowEligibility {
  Eligible = 'eligible',
  Ineligible = 'ineligible',
}

enum ExtensionConnectTabOriginMatch {
  SimpleVault = 'simple-vault',
  Other = 'other',
}

type ExtensionConnectTabsGeneratorContext = {
  readonly self: ExtensionConnectTabs
}

/** Opens or reuses the connect tab in the requesting window. */
export class ExtensionConnectTabs {
  private readonly generatorContext: ExtensionConnectTabsGeneratorContext = {
    self: this,
  }

  constructor(private readonly origin: ExtensionConnectTabOrigin) {}

  /** The connect tab's id once it shows the connect URL, focused. */
  open = Effect.fn(
    this.generatorContext,
    function* (request: ExtensionConnectTabRequest) {
      const { windowId } = request
      const windowRead: ExtensionConnectTabAttempt<chrome.windows.Window> = {
        try: () => chrome.windows.get(windowId),
        // A window id that names no window is an unusable selector.
        catch: () =>
          ExtensionConnectTabs.error(
            ExtensionConnectTabFailureKind.WindowUnavailable,
          ),
      }
      const window = yield* Effect.tryPromise(windowRead)
      switch (ExtensionConnectTabs.eligibility(window)) {
        case ExtensionConnectWindowEligibility.Ineligible:
          return yield* ExtensionConnectTabs.failure(
            ExtensionConnectTabFailureKind.WindowUnavailable,
          )
        case ExtensionConnectWindowEligibility.Eligible:
          break
      }
      const query: chrome.tabs.QueryInfo = { windowId }
      const tabs = yield* ExtensionConnectTabs.browser(() =>
        chrome.tabs.query(query),
      )
      const candidates = yield* this.candidates(tabs)
      const selection = new ExtensionConnectTabChoice(candidates).selection()
      const show: ExtensionConnectTabShowRequest = { selection, request }
      const tabId = yield* ExtensionConnectTabs.show(show)
      const focused: chrome.windows.UpdateInfo = { focused: true }
      yield* ExtensionConnectTabs.browser(() =>
        chrome.windows.update(windowId, focused),
      )
      return tabId
    },
  )

  private candidates(
    tabs: readonly chrome.tabs.Tab[],
  ): Effect.Effect<ExtensionConnectTabCandidates, ExtensionConnectTabFailure> {
    const allConcurrent: { readonly concurrency: 'unbounded' } = {
      concurrency: 'unbounded',
    }
    return Effect.all(
      tabs.map((tab) => this.candidate(tab)),
      allConcurrent,
    ).pipe(Effect.map((found) => found.flat()))
  }

  /** A tab with an id showing the Simple Vault origin, as Rust classifies
   * its URL; any other tab is no candidate. */
  private candidate(
    tab: chrome.tabs.Tab,
  ): Effect.Effect<ExtensionConnectTabCandidates, ExtensionConnectTabFailure> {
    const { id, url } = tab
    const none: ExtensionConnectTabCandidates = []
    switch (typeof id) {
      case 'number':
        break
      case 'undefined':
      case 'string':
      case 'bigint':
      case 'boolean':
      case 'symbol':
      case 'object':
      case 'function':
        return Effect.succeed(none)
    }
    // A tab whose address this extension cannot read is no candidate.
    switch (typeof url) {
      case 'string':
        break
      case 'undefined':
      case 'number':
      case 'bigint':
      case 'boolean':
      case 'symbol':
      case 'object':
      case 'function':
        return Effect.succeed(none)
    }
    return ExtensionConnectTabs.browser(() =>
      this.origin.isRuntimeSimpleVaultUrl(url),
    ).pipe(
      Effect.map((simpleVault) => {
        switch (ExtensionConnectTabs.originMatch(simpleVault)) {
          case ExtensionConnectTabOriginMatch.Other:
            return []
          case ExtensionConnectTabOriginMatch.SimpleVault: {
            const found: ExtensionConnectTabCandidateRequest = {
              tab,
              tabId: id,
            }
            return [ExtensionConnectTabs.candidateOf(found)]
          }
        }
      }),
    )
  }

  private static candidateOf(
    request: ExtensionConnectTabCandidateRequest,
  ): ExtensionConnectTabCandidate {
    const { tab, tabId } = request
    return {
      tabId,
      index: tab.index,
      focus: ExtensionConnectTabs.focus(tab.active),
      recency: ExtensionConnectTabs.recency(tab.lastAccessed),
    }
  }

  private static show(
    request: ExtensionConnectTabShowRequest,
  ): Effect.Effect<number, ExtensionConnectTabFailure> {
    const { selection, request: connect } = request
    switch (selection.kind) {
      case ExtensionConnectTabSelectionKind.Reuse: {
        const update: chrome.tabs.UpdateProperties = {
          url: connect.url,
          active: true,
        }
        // Updating a tab that closed meanwhile rejects; the id stays the
        // chosen tab's.
        return ExtensionConnectTabs.browser(() =>
          chrome.tabs.update(selection.tabId, update),
        ).pipe(Effect.as(selection.tabId))
      }
      case ExtensionConnectTabSelectionKind.Open: {
        const create: chrome.tabs.CreateProperties = {
          windowId: connect.windowId,
          url: connect.url,
          active: true,
        }
        return ExtensionConnectTabs.browser(() =>
          chrome.tabs.create(create),
        ).pipe(Effect.flatMap((tab) => ExtensionConnectTabs.tabId(tab)))
      }
    }
  }

  private static tabId(
    tab: chrome.tabs.Tab,
  ): Effect.Effect<number, ExtensionConnectTabFailure> {
    const { id } = tab
    switch (typeof id) {
      case 'number':
        return Effect.succeed(id)
      case 'undefined':
      case 'string':
      case 'bigint':
      case 'boolean':
      case 'symbol':
      case 'object':
      case 'function':
        return ExtensionConnectTabs.failure(
          ExtensionConnectTabFailureKind.TabUnavailable,
        )
    }
  }

  private static eligibility(
    window: chrome.windows.Window,
  ): ExtensionConnectWindowEligibility {
    const eligible =
      window.type === 'normal' &&
      window.incognito === chrome.extension.inIncognitoContext
    switch (eligible) {
      case true:
        return ExtensionConnectWindowEligibility.Eligible
      case false:
        return ExtensionConnectWindowEligibility.Ineligible
    }
  }

  private static originMatch(
    simpleVault: boolean,
  ): ExtensionConnectTabOriginMatch {
    switch (simpleVault) {
      case true:
        return ExtensionConnectTabOriginMatch.SimpleVault
      case false:
        return ExtensionConnectTabOriginMatch.Other
    }
  }

  private static focus(active: boolean): ExtensionConnectTabFocus {
    switch (active) {
      case true:
        return ExtensionConnectTabFocus.Active
      case false:
        return ExtensionConnectTabFocus.Background
    }
  }

  /** Chrome reports lastAccessed from version 121 on. */
  private static recency(
    lastAccessed: chrome.tabs.Tab['lastAccessed'],
  ): ExtensionConnectTabRecency {
    switch (typeof lastAccessed) {
      case 'number':
        return { kind: ExtensionConnectTabRecencyKind.Known, lastAccessed }
      case 'undefined':
      case 'string':
      case 'bigint':
      case 'boolean':
      case 'symbol':
      case 'object':
      case 'function':
        return { kind: ExtensionConnectTabRecencyKind.Unreported }
    }
  }

  private static browser<Value>(
    call: () => Promise<Value>,
  ): Effect.Effect<Value, ExtensionConnectTabFailure> {
    const attempt: ExtensionConnectTabAttempt<Value> = {
      try: call,
      catch: () =>
        ExtensionConnectTabs.error(ExtensionConnectTabFailureKind.Browser),
    }
    return Effect.tryPromise(attempt)
  }

  private static error(
    kind: ExtensionConnectTabFailureKind,
  ): ExtensionConnectTabFailure {
    const fields: ExtensionConnectTabFailureFields = { kind }
    return new ExtensionConnectTabFailure(fields)
  }

  private static failure(
    kind: ExtensionConnectTabFailureKind,
  ): Effect.Effect<never, ExtensionConnectTabFailure> {
    return Effect.fail(ExtensionConnectTabs.error(kind))
  }
}

type ExtensionConnectTabAttempt<Value> = {
  readonly try: () => Promise<Value>
  readonly catch: () => ExtensionConnectTabFailure
}

type ExtensionConnectTabFailureFields = {
  readonly kind: ExtensionConnectTabFailureKind
}

type ExtensionConnectTabCandidateRequest = {
  readonly tab: chrome.tabs.Tab
  readonly tabId: number
}

type ExtensionConnectTabShowRequest = {
  readonly selection: ExtensionConnectTabSelection
  readonly request: ExtensionConnectTabRequest
}
