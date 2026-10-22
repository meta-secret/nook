import { afterEach, describe, expect, test } from 'bun:test'
import {
  SidePanelPageUnanswered,
  SidePanelTopFrame,
} from '../src/background/service-worker/side-panel-site-routes'
import { SidePanelPageNeedMessageType } from '../src/lib/side-panel-page-need'
import { extensionTestBrowserHost } from './extension-test-browser-host'
import type { BrowserRuntimeMessageValue } from '../src/lib/browser-runtime-message'

/** The browser's tab messaging, answering every message with `reply`. */
function tabsAnswering(reply: Promise<BrowserRuntimeMessageValue>): void {
  Object.assign(globalThis, {
    chrome: { ...extensionTestBrowserHost, tabs: { sendMessage: () => reply } },
  })
}

/** A tab whose listeners all leave the message alone: Chrome resolves with
 * nothing. */
function tabsSilent(): void {
  Object.assign(globalThis, {
    chrome: {
      ...extensionTestBrowserHost,
      tabs: { sendMessage: async () => {} },
    },
  })
}

const delivery: Parameters<SidePanelTopFrame['send']>[0] = {
  tabId: 7,
  message: {
    type: SidePanelPageNeedMessageType.Query,
    payload: { origin: 'https://localhost:5173' },
  },
}

afterEach(() => {
  Object.assign(globalThis, { chrome: extensionTestBrowserHost })
})

describe('side panel top frame', () => {
  test('a content script answer is the reply', async () => {
    const answer = { kind: 'needed' }
    tabsAnswering(Promise.resolve(answer))

    expect(await new SidePanelTopFrame().send(delivery)).toEqual(answer)
  })

  test('a frame whose listeners leave the message alone answered nothing', async () => {
    tabsSilent()

    const failure = await new SidePanelTopFrame()
      .send(delivery)
      .catch((error: Error) => error)
    expect(failure).toBeInstanceOf(SidePanelPageUnanswered)
  })

  test('a frame without a content script stays unreached', async () => {
    tabsAnswering(Promise.reject(new Error('Receiving end does not exist.')))

    const failure = await new SidePanelTopFrame()
      .send(delivery)
      .catch((error: Error) => error)
    expect(failure).toBeInstanceOf(Error)
    expect(failure).not.toBeInstanceOf(SidePanelPageUnanswered)
  })
})
