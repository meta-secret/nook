import { beforeAll, describe, expect, test } from 'bun:test'
import {
  SidePanelAddAuthenticatorKind,
  SidePanelAuthenticatorSetupMessageType,
  SidePanelPageAddAuthenticatorReplyKind,
} from '../src/lib/side-panel-authenticator-setup'
import {
  PageReplyKind,
  RouteData,
  SidePanelRouteFixture,
} from './side-panel-route-test-support'

beforeAll(async () => {
  const { companionWasmReady } =
    await import('../../nook-web-shared/src/extension/companion-ready')
  await companionWasmReady
})

describe('side-panel Add 2FA from this page', () => {
  test('sends the resolved tab a trigger naming only its origin and reports the start', async () => {
    const fixture = new SidePanelRouteFixture()

    expect(await fixture.addAuthenticator()).toEqual({
      kind: SidePanelAddAuthenticatorKind.Started,
    })
    expect(fixture.pageDeliveries).toEqual([
      {
        tabId: 41,
        message: {
          type: SidePanelAuthenticatorSetupMessageType.PageAdd,
          payload: { origin: 'https://www.example.com:8443' },
        },
      },
    ])
    // Starting reads no session and no vault: the page ceremony saves later.
    expect(fixture.sessionMessages).toEqual([])
  })

  test("reports the page's answer when nothing starts there", async () => {
    const answers: Array<
      [SidePanelPageAddAuthenticatorReplyKind, SidePanelAddAuthenticatorKind]
    > = [
      [
        SidePanelPageAddAuthenticatorReplyKind.NoSetup,
        SidePanelAddAuthenticatorKind.NoSetup,
      ],
      [
        SidePanelPageAddAuthenticatorReplyKind.TabChanged,
        SidePanelAddAuthenticatorKind.TabChanged,
      ],
    ]
    for (const [reply, kind] of answers) {
      const fixture = new SidePanelRouteFixture()
      fixture.addReply = RouteData.answered({ kind: reply })
      expect(await fixture.addAuthenticator()).toEqual({ kind })
    }
    const unreached = new SidePanelRouteFixture()
    unreached.addReply = { kind: PageReplyKind.NoReceiver }
    expect(await unreached.addAuthenticator()).toEqual({
      kind: SidePanelAddAuthenticatorKind.PageUnavailable,
    })
    const malformed = new SidePanelRouteFixture()
    malformed.addReply = RouteData.answered({
      kind: SidePanelPageAddAuthenticatorReplyKind.Started,
      otpauthUri: 'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP',
    })
    expect(await malformed.addAuthenticator()).toEqual({
      kind: SidePanelAddAuthenticatorKind.Failed,
    })
  })

  test('admits only the panel document and a window-only request', async () => {
    const foreign = new SidePanelRouteFixture()
    expect(
      await foreign.addAuthenticator({ id: 'other-extension', url: 'x' }),
    ).toEqual({ kind: SidePanelAddAuthenticatorKind.Forbidden })
    expect(foreign.tabsQuery).not.toHaveBeenCalled()
    expect(foreign.pageDeliveries).toEqual([])

    const naming = new SidePanelRouteFixture()
    expect(
      await naming.addAuthenticator(RouteData.panelSender, {
        windowId: 7,
        origin: 'https://evil.example',
      }),
    ).toEqual({ kind: SidePanelAddAuthenticatorKind.Forbidden })
    expect(naming.pageDeliveries).toEqual([])
  })

  test('a browser page is non-web and receives no trigger', async () => {
    const fixture = new SidePanelRouteFixture()
    fixture.activeTabs = [RouteData.tab(41, 'chrome://settings/')]
    expect(await fixture.addAuthenticator()).toEqual({
      kind: SidePanelAddAuthenticatorKind.NonWeb,
    })
    expect(fixture.pageDeliveries).toEqual([])
  })
})

describe('side-panel page change relay', () => {
  type Relayed = {
    readonly announcements: string[]
    readonly replies: unknown[]
  }

  async function relay(sender: chrome.runtime.MessageSender): Promise<Relayed> {
    new SidePanelRouteFixture().install()
    const { SidePanelSiteRoutes } =
      await import('../src/background/service-worker/side-panel-site-routes')
    const { VAULT_REVISION_CHANNEL } =
      await import('../src/lib/vault-revision-signal')
    const panel = new BroadcastChannel(VAULT_REVISION_CHANNEL)
    const announcements: string[] = []
    panel.addEventListener('message', (event) =>
      announcements.push(String(event.data)),
    )
    const replies: unknown[] = []
    SidePanelSiteRoutes.pageChanged().route({
      message: RouteData.message({
        type: SidePanelAuthenticatorSetupMessageType.PageChanged,
      }),
      sender,
      sendResponse: (reply: unknown) => replies.push(reply),
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    panel.close()
    return { announcements, replies }
  }

  test("a site tab's top document makes the panel list again", async () => {
    expect(
      await relay({
        id: RouteData.extensionId,
        tab: RouteData.tab(41, 'https://a.test/'),
        frameId: 0,
      }),
    ).toEqual({ announcements: ['page-changed'], replies: [{ ok: true }] })
  })

  test('a subframe or another sender announces nothing', async () => {
    for (const sender of [
      {
        id: RouteData.extensionId,
        tab: RouteData.tab(41, 'https://a.test/'),
        frameId: 3,
      },
      {
        id: 'other-extension',
        tab: RouteData.tab(41, 'https://a.test/'),
        frameId: 0,
      },
      RouteData.panelSender,
    ]) {
      expect(await relay(sender)).toEqual({
        announcements: [],
        replies: [{ ok: false }],
      })
    }
  })
})
