import { Effect } from 'effect'
import {
  classify_browser_tab_target,
  type BrowserTabTarget,
  type BrowserTabUrlObservation,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { companionWasmReady } from '../../../../nook-web-shared/src/extension/companion-ready'
import type { SidePanelWindowSelection } from '../../lib/side-panel-site'

export enum SidePanelTabTargetKind {
  Web = 'web',
  NonWeb = 'non-web',
  PageUnavailable = 'page-unavailable',
  /** Reading the active tab or classifying it failed; not a page state. */
  Failed = 'failed',
}

/** A website tab: its id and the origin and host Rust derived from its URL. */
export interface SidePanelWebTabTarget {
  readonly kind: SidePanelTabTargetKind.Web
  readonly tabId: number
  readonly origin: string
  readonly display_host: string
}

/** The active tab of the panel's window, as the worker resolved and Rust classified it. */
export type SidePanelTabTarget =
  | SidePanelWebTabTarget
  | { readonly kind: SidePanelTabTargetKind.NonWeb }
  | { readonly kind: SidePanelTabTargetKind.PageUnavailable }
  | { readonly kind: SidePanelTabTargetKind.Failed }

/** Rust owns which kind of page a tab shows. */
export interface SidePanelTabClassifier {
  classify(observation: BrowserTabUrlObservation): Promise<BrowserTabTarget>
}

/** The production classifier: the companion WASM export, once it is ready. */
export class CompanionSidePanelTabClassifier implements SidePanelTabClassifier {
  async classify(
    observation: BrowserTabUrlObservation,
  ): Promise<BrowserTabTarget> {
    await companionWasmReady
    return classify_browser_tab_target(observation)
  }
}

enum SidePanelWindowEligibility {
  Eligible = 'eligible',
  Ineligible = 'ineligible',
}

type ActiveTabs = readonly chrome.tabs.Tab[]

enum ActiveTabSelectionKind {
  Selected = 'selected',
  Unavailable = 'unavailable',
}

type ActiveTabSelection =
  | {
      readonly kind: ActiveTabSelectionKind.Selected
      readonly tabId: number
      readonly observation: BrowserTabUrlObservation
    }
  | { readonly kind: ActiveTabSelectionKind.Unavailable }

type SidePanelTabTargetResolverConfiguration = {
  readonly classifier: SidePanelTabClassifier
}

/**
 * Resolves the panel's window selector into the tab Fill and the listing act
 * on. The panel's window id only selects a window: the worker checks that it
 * is a normal window of this extension's profile, reads that window's single
 * active tab and its URL itself, and lets Rust classify the URL. A selector
 * naming no usable window or no single active tab is page-unavailable; a
 * failure to query tabs or to classify is reported as Failed, never as a
 * page state.
 */
export class SidePanelTabTargetResolver {
  private readonly unavailable: SidePanelTabTarget = {
    kind: SidePanelTabTargetKind.PageUnavailable,
  }
  private readonly failed: SidePanelTabTarget = {
    kind: SidePanelTabTargetKind.Failed,
  }
  private readonly generatorContext: SidePanelTabTargetResolverGeneratorContext =
    { self: this }

  constructor(
    private readonly configuration: SidePanelTabTargetResolverConfiguration,
  ) {}

  resolve(selection: SidePanelWindowSelection): Promise<SidePanelTabTarget> {
    return Effect.runPromise(
      this.target(selection).pipe(
        Effect.catch(() => Effect.succeed(this.failed)),
      ),
    )
  }

  private target = Effect.fn(
    this.generatorContext,
    function* (selection: SidePanelWindowSelection) {
      // A window id that names no window is an unusable selector, not a failure.
      const window = yield* Effect.result(
        Effect.tryPromise(() => chrome.windows.get(selection.windowId)),
      )
      switch (window._tag) {
        case 'Failure':
          return this.unavailable
        case 'Success':
          break
      }
      switch (this.windowEligibility(window.success)) {
        case SidePanelWindowEligibility.Ineligible:
          return this.unavailable
        case SidePanelWindowEligibility.Eligible:
          break
      }
      const query: chrome.tabs.QueryInfo = {
        active: true,
        windowId: selection.windowId,
      }
      const tabs: ActiveTabs = yield* Effect.tryPromise(() =>
        chrome.tabs.query(query),
      )
      const selected = this.activeTab(tabs)
      switch (selected.kind) {
        case ActiveTabSelectionKind.Unavailable:
          return this.unavailable
        case ActiveTabSelectionKind.Selected:
          break
      }
      const classified = yield* Effect.tryPromise(() =>
        this.configuration.classifier.classify(selected.observation),
      )
      const projection: SidePanelTabProjection = {
        tabId: selected.tabId,
        target: classified,
      }
      return this.project(projection)
    },
  )

  private windowEligibility(
    window: chrome.windows.Window,
  ): SidePanelWindowEligibility {
    const eligible =
      window.type === 'normal' &&
      window.incognito === chrome.extension.inIncognitoContext
    switch (eligible) {
      case true:
        return SidePanelWindowEligibility.Eligible
      case false:
        return SidePanelWindowEligibility.Ineligible
    }
  }

  private activeTab(tabs: ActiveTabs): ActiveTabSelection {
    const [tab] = tabs
    switch (true) {
      case tabs.length === 1 &&
        !!tab &&
        typeof tab.id === 'number' &&
        Number.isInteger(tab.id):
        return {
          kind: ActiveTabSelectionKind.Selected,
          tabId: tab.id,
          observation: this.urlObservation(tab),
        }
      case true:
      default:
        return { kind: ActiveTabSelectionKind.Unavailable }
    }
  }

  /** Passes the browser's URL to Rust unchanged; TypeScript never parses it. */
  private urlObservation(tab: chrome.tabs.Tab): BrowserTabUrlObservation {
    switch (true) {
      case typeof tab.url === 'string':
        return { kind: 'Observed', url: tab.url }
      case true:
      default:
        return { kind: 'Unavailable' }
    }
  }

  private project({
    tabId,
    target,
  }: SidePanelTabProjection): SidePanelTabTarget {
    switch (target.kind) {
      case 'Web':
        return {
          kind: SidePanelTabTargetKind.Web,
          tabId,
          origin: target.origin,
          display_host: target.display_host,
        }
      case 'NonWeb':
        return { kind: SidePanelTabTargetKind.NonWeb }
      case 'NookVaultApp':
        return this.unavailable
    }
  }
}

type SidePanelTabProjection = {
  readonly tabId: number
  readonly target: BrowserTabTarget
}

type SidePanelTabTargetResolverGeneratorContext = {
  readonly self: SidePanelTabTargetResolver
}
