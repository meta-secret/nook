import { expect, type Page, type Worker } from '@playwright/test'
import {
  WebsiteAuthenticatorFillMessageType,
  type WebsiteAuthenticatorFillMessage,
} from '../src/lib/login-fill-messages'
import {
  SidePanelPageCodeFillReplyKind,
  SidePanelPageFillMessageType,
  type SidePanelPageCodeFillMessage,
  type SidePanelPageCodeFillReply,
  type SidePanelPageFillAccount,
} from '../src/lib/side-panel-page-fill'

type SelectedAccountObservation = {
  readonly messageType: WebsiteAuthenticatorFillMessageType
  readonly origin: string
}

type SidePanelFillRequest = {
  readonly account: SidePanelPageFillAccount
  readonly url: string
  readonly messageType: SidePanelPageFillMessageType.FillCode
}

/**
 * The real worker-to-content half of Fill code. The native docked panel is
 * not a Playwright page; side-panel-behavior.spec.ts separately covers its
 * row click/message contract, and side-panel-routes.test.ts its admission.
 * This helper never impersonates a panel sender or relaxes its admission.
 */
export class NamecheapSidePanelFill {
  constructor(private readonly worker: Worker) {}

  observeSelectedAccount(origin: string): Promise<SidePanelPageFillAccount> {
    const request: SelectedAccountObservation = {
      messageType:
        WebsiteAuthenticatorFillMessageType.NookWebsiteAuthenticatorFill,
      origin,
    }
    return this.worker.evaluate(
      (observation) =>
        new Promise<SidePanelPageFillAccount>((resolve) => {
          const selected = (message: WebsiteAuthenticatorFillMessage) => {
            switch (true) {
              case message.type === observation.messageType &&
                message.payload.origin === observation.origin &&
                typeof message.payload.authorizationGeneration === 'string':
                chrome.runtime.onMessage.removeListener(selected)
                resolve({
                  vaultStoreId: message.payload.vaultStoreId,
                  secretId: message.payload.secretId,
                  authorizationGeneration:
                    message.payload.authorizationGeneration,
                })
                break
              case true:
              default:
                break
            }
            return false
          }
          chrome.runtime.onMessage.addListener(selected)
        }),
      request,
    )
  }

  async fill(
    request: Omit<SidePanelFillRequest, 'messageType'>,
  ): Promise<void> {
    const trigger: SidePanelFillRequest = {
      ...request,
      messageType: SidePanelPageFillMessageType.FillCode,
    }
    const reply = await this.worker.evaluate(async (fill) => {
      const tabs = await chrome.tabs.query({ url: fill.url })
      const [tab] = tabs
      switch (true) {
        case tabs.length === 1 && typeof tab?.id === 'number': {
          const message: SidePanelPageCodeFillMessage = {
            type: fill.messageType,
            payload: {
              origin: new URL(fill.url).origin,
              account: fill.account,
            },
          }
          return chrome.tabs.sendMessage<
            SidePanelPageCodeFillMessage,
            SidePanelPageCodeFillReply
          >(tab.id, message, { frameId: 0 })
        }
        case true:
        default:
          throw new Error('Expected the synthetic OTP challenge tab')
      }
    }, trigger)
    expect(reply.kind).toBe(SidePanelPageCodeFillReplyKind.Filled)
  }

  static async saveAuthenticator(vaultPage: Page): Promise<void> {
    await vaultPage.getByTestId('add-secret-btn').click()
    await vaultPage.getByTestId('item-type-authenticator').click()
    await vaultPage.getByTestId('authenticator-issuer').fill('Namecheap')
    await vaultPage
      .getByTestId('authenticator-account')
      .fill('manual-fill@nook.test')
    await vaultPage
      .getByTestId('authenticator-website')
      .fill('https://namecheap.com')
    await vaultPage.getByTestId('authenticator-secret').fill('JBSWY3DPEHPK3PXP')
    await vaultPage.getByTestId('save-secret-btn').click()
    await expect(
      vaultPage
        .getByTestId('vault-group-authenticator')
        .getByTestId('secret-row'),
    ).toBeVisible()
  }
}
