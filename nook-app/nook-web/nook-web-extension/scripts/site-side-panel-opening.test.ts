import { describe, expect, test } from 'bun:test'
import {
  ExternalSidePanelSignal,
  SiteSidePanelOpening,
  type ExternalSidePanelResponse,
  type SiteSidePanelPort,
} from '../src/background/service-worker/site-side-panel-opening'
import { ExtensionSidePanelSignalType } from '../../nook-web-shared/src/extension/side-panel-signal-message'
import { SiteSidePanelOpenKind } from '../src/lib/site-side-panel-messages'

class RecordingSidePanel implements SiteSidePanelPort {
  readonly opened: chrome.sidePanel.OpenOptions[] = []
  refuse = false

  open(options: chrome.sidePanel.OpenOptions): Promise<void> {
    this.opened.push(options)
    return this.refuse
      ? Promise.reject(
          new Error('may only be called in response to a user gesture'),
        )
      : Promise.resolve()
  }
}

function siteSender(windowId: number): chrome.runtime.MessageSender {
  return {
    id: 'nook-extension',
    url: 'https://dashboard.stripe.com/login',
    tab: {
      id: 12,
      index: 0,
      windowId,
      highlighted: true,
      active: true,
      pinned: false,
      incognito: false,
      discarded: false,
      autoDiscardable: true,
      frozen: false,
      groupId: -1,
      selected: true,
      lastAccessed: 0,
    },
  }
}

describe('Site side panel opening', () => {
  test("opens the side panel in the site tab's window within the click", async () => {
    const sidePanel = new RecordingSidePanel()
    const answer = new SiteSidePanelOpening(sidePanel).open({
      sender: siteSender(7),
    })
    // Chrome admits the call only while the click gesture is current.
    expect(sidePanel.opened).toEqual([{ windowId: 7 }])
    expect(await answer).toEqual({ kind: SiteSidePanelOpenKind.Opened })
  })

  test('reports a refused opening instead of succeeding', async () => {
    const sidePanel = new RecordingSidePanel()
    sidePanel.refuse = true
    const answer = await new SiteSidePanelOpening(sidePanel).open({
      sender: siteSender(7),
    })
    expect(answer).toEqual({ kind: SiteSidePanelOpenKind.Failed })
  })

  test('a sender outside a browser tab opens nothing', async () => {
    const sidePanel = new RecordingSidePanel()
    const answer = await new SiteSidePanelOpening(sidePanel).open({
      sender: { id: 'nook-extension' },
    })
    expect(answer).toEqual({ kind: SiteSidePanelOpenKind.Failed })
    expect(sidePanel.opened).toEqual([])
  })
})

describe('Vault side panel signal', () => {
  const signal = { type: ExtensionSidePanelSignalType.NookOpenSidePanel }

  test("opens the panel in the vault tab's window at once and answers ok", async () => {
    const sidePanel = new RecordingSidePanel()
    const answers: ExternalSidePanelResponse[] = []
    const handled = new ExternalSidePanelSignal(
      new SiteSidePanelOpening(sidePanel),
    ).handled({
      message: signal,
      sender: siteSender(9),
      respond: (response) => answers.push(response),
    })
    expect(handled).toBe(true)
    // Before any await: the vault click's gesture is still current.
    expect(sidePanel.opened).toEqual([{ windowId: 9 }])
    await Promise.resolve()
    await Promise.resolve()
    expect(answers).toEqual([{ ok: true }])
  })

  test('a refused opening answers a failure the vault can show', async () => {
    const sidePanel = new RecordingSidePanel()
    sidePanel.refuse = true
    const answered = new Promise<ExternalSidePanelResponse>((resolve) => {
      new ExternalSidePanelSignal(new SiteSidePanelOpening(sidePanel)).handled({
        message: signal,
        sender: siteSender(9),
        respond: resolve,
      })
    })
    expect(await answered).toEqual({ ok: false, reason: 'side-panel-failed' })
  })

  test('other vault messages are left to the router', () => {
    const sidePanel = new RecordingSidePanel()
    const handled = new ExternalSidePanelSignal(
      new SiteSidePanelOpening(sidePanel),
    ).handled({
      message: { type: 'nook:open-companion-launcher' },
      sender: siteSender(9),
      respond: () => {},
    })
    expect(handled).toBe(false)
    expect(sidePanel.opened).toEqual([])
  })
})
