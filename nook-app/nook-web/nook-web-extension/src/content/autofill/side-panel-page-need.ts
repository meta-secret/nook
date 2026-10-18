import type { BrowserRuntimeMessageValue } from '../../lib/browser-runtime-message'
import {
  SidePanelPageNeedMessages,
  SidePanelPageNeedReplyKind,
  type SidePanelPageNeedReply,
} from '../../lib/side-panel-page-need'
import {
  SidePanelPageSender,
  SidePanelPageSenderAdmission,
} from './side-panel-page-sender'
import {
  SidePanelPageWorkflowDiscovery,
  SidePanelPageWorkflowKind,
  type SidePanelPageWorkflow,
  type SidePanelPageWorkflowSource,
} from './side-panel-page-workflow'

export enum SidePanelPageNeedReception {
  Ignored = 'ignored',
  Responding = 'responding',
}

type SidePanelPageNeedResponse = (reply: SidePanelPageNeedReply) => void

export interface SidePanelPageNeedDelivery {
  readonly message: BrowserRuntimeMessageValue
  readonly sender: chrome.runtime.MessageSender
  readonly sendResponse: SidePanelPageNeedResponse
}

enum SidePanelPageNeedQueryAdmission {
  NotAQuery = 'not-a-query',
  OtherContext = 'other-context',
  Query = 'query',
}

/**
 * Answers the worker's page-need query in the top document: it classifies
 * the document's forms with Rust when the query arrives and replies with the
 * workflow kind Rust selected. Nothing is cached between queries, and the
 * reply carries no field, value or URL.
 */
export class SidePanelPageNeedReceiver {
  constructor(private readonly pages: SidePanelPageWorkflowSource) {}

  receive(delivery: SidePanelPageNeedDelivery): SidePanelPageNeedReception {
    switch (this.admission(delivery)) {
      case SidePanelPageNeedQueryAdmission.NotAQuery:
      case SidePanelPageNeedQueryAdmission.OtherContext:
        return SidePanelPageNeedReception.Ignored
      case SidePanelPageNeedQueryAdmission.Query:
        break
    }
    const answer = new SidePanelPageNeedAnswer(delivery)
    const decoded = SidePanelPageNeedMessages.decode(delivery.message)
    switch (decoded._tag) {
      case 'Failure':
        return answer.send(SidePanelPageNeedReplyKind.Unavailable)
      case 'Success':
        break
    }
    switch (decoded.success.payload.origin === location.origin) {
      case false:
        return answer.send(SidePanelPageNeedReplyKind.TabChanged)
      case true:
        break
    }
    void this.pages
      .pageWorkflow()
      .then((page) => delivery.sendResponse(this.reply(page)))
      .catch(() => answer.send(SidePanelPageNeedReplyKind.Unavailable))
    return SidePanelPageNeedReception.Responding
  }

  private reply(page: SidePanelPageWorkflow): SidePanelPageNeedReply {
    switch (page.kind) {
      case SidePanelPageWorkflowKind.Selected:
        return {
          kind: SidePanelPageNeedReplyKind.Classified,
          workflow: page.snapshot.kind,
        }
      case SidePanelPageWorkflowKind.None:
        return { kind: SidePanelPageNeedReplyKind.Unrecognized }
      case SidePanelPageWorkflowKind.Unavailable:
        return { kind: SidePanelPageNeedReplyKind.Unavailable }
    }
  }

  private admission(
    delivery: SidePanelPageNeedDelivery,
  ): SidePanelPageNeedQueryAdmission {
    switch (SidePanelPageNeedMessages.matches(delivery.message)._tag) {
      case 'Failure':
        return SidePanelPageNeedQueryAdmission.NotAQuery
      case 'Success':
        break
    }
    switch (new SidePanelPageSender(delivery.sender).admission()) {
      case SidePanelPageSenderAdmission.OwnTopDocument:
        return SidePanelPageNeedQueryAdmission.Query
      case SidePanelPageSenderAdmission.OtherContext:
        return SidePanelPageNeedQueryAdmission.OtherContext
    }
  }
}

type SidePanelBarePageNeedReplyKind = Exclude<
  SidePanelPageNeedReplyKind,
  SidePanelPageNeedReplyKind.Classified
>

/** Answers one admitted query that ends before any classification. */
class SidePanelPageNeedAnswer {
  constructor(private readonly delivery: SidePanelPageNeedDelivery) {}

  send(kind: SidePanelBarePageNeedReplyKind): SidePanelPageNeedReception {
    const reply: SidePanelPageNeedReply = { kind }
    this.delivery.sendResponse(reply)
    return SidePanelPageNeedReception.Responding
  }
}

/** The content script's single page-need receiver. */
export const sidePanelPageNeed = new SidePanelPageNeedReceiver(
  new SidePanelPageWorkflowDiscovery(),
)
