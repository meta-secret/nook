import { Effect } from 'effect'

/** The part of `chrome.sidePanel` the toolbar behavior needs. */
export type SidePanelBehaviorPort = {
  setPanelBehavior(behavior: chrome.sidePanel.PanelBehavior): Promise<void>
}

/** The part of the console a rejected behavior is reported on. */
export type SidePanelBehaviorReporter = Pick<Console, 'warn'>

export type ToolbarSidePanelRequest = {
  readonly sidePanel: SidePanelBehaviorPort
  readonly reporter: SidePanelBehaviorReporter
}

export enum ToolbarSidePanelOutcome {
  Applied = 'applied',
  /** The browser refused; there is no popup to fall back to. */
  Rejected = 'rejected',
}

/**
 * The toolbar button opens the Nook side panel. This is the only toolbar
 * surface: the manifest declares no popup, so a refusal stays visible as a
 * constant warning instead of being replaced by another path.
 */
export class ToolbarSidePanelBehavior {
  static readonly REJECTED_WARNING =
    'Extension could not make the toolbar button open the side panel'

  private static readonly BEHAVIOR: chrome.sidePanel.PanelBehavior = {
    openPanelOnActionClick: true,
  }

  constructor(private readonly request: ToolbarSidePanelRequest) {}

  apply(): Effect.Effect<ToolbarSidePanelOutcome> {
    const { sidePanel, reporter } = this.request
    return Effect.tryPromise(() =>
      sidePanel.setPanelBehavior(ToolbarSidePanelBehavior.BEHAVIOR),
    ).pipe(
      Effect.as(ToolbarSidePanelOutcome.Applied),
      Effect.orElseSucceed(() => {
        reporter.warn(ToolbarSidePanelBehavior.REJECTED_WARNING)
        return ToolbarSidePanelOutcome.Rejected
      }),
    )
  }
}
