import { expect, type Worker } from '@playwright/test'
import { Effect } from 'effect'
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

type SidePanelFillSelection = Omit<SidePanelFillRequest, 'messageType'>
type SelectedAccountSubscription = {
  readonly observation: SelectedAccountObservation
  readonly resolve: (account: SidePanelPageFillAccount) => void
}
type SidePanelFillContext = { readonly self: NamecheapSidePanelFill }

/**
 * The real worker-to-content half of Fill code. The native docked panel is
 * not a Playwright page; side-panel-behavior.spec.ts separately covers its
 * row click/message contract, and side-panel-routes.test.ts its admission.
 * This helper never impersonates a panel sender or relaxes its admission.
 */
export class NamecheapSidePanelFill {
  private readonly generatorContext: SidePanelFillContext = { self: this }

  constructor(private readonly worker: Worker) {}

  observeSelectedAccount(origin: string): Promise<SidePanelPageFillAccount> {
    const request: SelectedAccountObservation = {
      messageType:
        WebsiteAuthenticatorFillMessageType.NookWebsiteAuthenticatorFill,
      origin,
    }
    return this.worker.evaluate(this.observe, request)
  }

  private observe(
    observation: SelectedAccountObservation,
  ): Promise<SidePanelPageFillAccount> {
    class SelectedAccountListener {
      private readonly selected = this.receive.bind(this)

      constructor(private readonly request: SelectedAccountSubscription) {}

      subscribe(): void {
        chrome.runtime.onMessage.addListener(this.selected)
      }

      private receive(message: WebsiteAuthenticatorFillMessage): false {
        const { observation } = this.request
        switch (true) {
          case message.type === observation.messageType &&
            message.payload.origin === observation.origin &&
            typeof message.payload.authorizationGeneration === 'string': {
            chrome.runtime.onMessage.removeListener(this.selected)
            const account: SidePanelPageFillAccount = {
              vaultStoreId: message.payload.vaultStoreId,
              secretId: message.payload.secretId,
              authorizationGeneration: message.payload.authorizationGeneration,
            }
            this.request.resolve(account)
            break
          }
          case true:
          default:
            break
        }
        return false
      }
    }
    return new Promise<SidePanelPageFillAccount>((resolve) => {
      const subscription: SelectedAccountSubscription = {
        observation,
        resolve,
      }
      new SelectedAccountListener(subscription).subscribe()
    })
  }

  /** Serialized into the actual extension worker; no host imports are captured. */
  private async deliver(
    fill: SidePanelFillRequest,
  ): Promise<SidePanelPageCodeFillReply> {
    const query: chrome.tabs.QueryInfo = { url: fill.url }
    const tabs = await chrome.tabs.query(query)
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
        const options: chrome.tabs.MessageSendOptions = { frameId: 0 }
        return chrome.tabs.sendMessage<
          SidePanelPageCodeFillMessage,
          SidePanelPageCodeFillReply
        >(tab.id, message, options)
      }
      case true:
      default:
        throw new Error('Expected the synthetic OTP challenge tab')
    }
  }

  fill(request: SidePanelFillSelection): Promise<void> {
    return Effect.runPromise(this.filled(request))
  }

  private filled = Effect.fn(
    this.generatorContext,
    function* (request: SidePanelFillSelection) {
      const trigger: SidePanelFillRequest = {
        ...request,
        messageType: SidePanelPageFillMessageType.FillCode,
      }
      const reply = yield* Effect.tryPromise(() =>
        this.worker.evaluate(this.deliver, trigger),
      )
      expect(reply.kind).toBe(SidePanelPageCodeFillReplyKind.Filled)
    },
  )
}
