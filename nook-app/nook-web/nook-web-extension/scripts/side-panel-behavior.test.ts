import { describe, expect, test } from 'bun:test'
import { Effect } from 'effect'
import {
  ToolbarSidePanelBehavior,
  ToolbarSidePanelOutcome,
  type SidePanelBehaviorPort,
  type SidePanelBehaviorReporter,
  type ToolbarSidePanelRequest,
} from '../src/background/service-worker/side-panel-behavior'

enum BrowserAnswer {
  Accepts = 'accepts',
  Refuses = 'refuses',
}

/** Records the behavior the service worker sets and what it reports. */
class SidePanelBehaviorFixture {
  readonly behaviors: chrome.sidePanel.PanelBehavior[] = []
  readonly warnings: string[] = []

  constructor(private readonly answer: BrowserAnswer) {}

  request(): ToolbarSidePanelRequest {
    const sidePanel: SidePanelBehaviorPort = {
      setPanelBehavior: (behavior) => {
        this.behaviors.push(behavior)
        switch (this.answer) {
          case BrowserAnswer.Accepts:
            return Promise.resolve()
          case BrowserAnswer.Refuses:
            return Promise.reject(new Error('sidePanel is unavailable'))
        }
      },
    }
    const reporter: SidePanelBehaviorReporter = {
      warn: (message: string) => this.warnings.push(message),
    }
    return { sidePanel, reporter }
  }
}

describe('toolbar side panel behavior', () => {
  test('the toolbar button opens the side panel, set once at startup', async () => {
    const fixture = new SidePanelBehaviorFixture(BrowserAnswer.Accepts)
    const outcome = await Effect.runPromise(
      new ToolbarSidePanelBehavior(fixture.request()).apply(),
    )
    expect(outcome).toBe(ToolbarSidePanelOutcome.Applied)
    expect(fixture.behaviors).toEqual([{ openPanelOnActionClick: true }])
    expect(fixture.warnings).toEqual([])
  })

  test('a refusal stays visible as a constant warning, with no other path', async () => {
    const fixture = new SidePanelBehaviorFixture(BrowserAnswer.Refuses)
    const outcome = await Effect.runPromise(
      new ToolbarSidePanelBehavior(fixture.request()).apply(),
    )
    expect(outcome).toBe(ToolbarSidePanelOutcome.Rejected)
    expect(fixture.behaviors).toEqual([{ openPanelOnActionClick: true }])
    expect(fixture.warnings).toEqual([
      ToolbarSidePanelBehavior.REJECTED_WARNING,
    ])
  })
})
