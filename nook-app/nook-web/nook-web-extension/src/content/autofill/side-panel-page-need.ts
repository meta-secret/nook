import type { AuthenticationWorkflowMatch } from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  AuthenticationEnrollmentWorkflowMatchResponseKind,
  CompanionWasmSessionMessageType,
  type CompanionWasmRuntimeMessage,
} from '../../../../nook-web-shared/src/extension/companion-wasm-runtime-messages'
import { passwordFieldDiscovery } from '../../../../nook-web-shared/src/extension/password-forms'
import { recoveryCopyObservation } from '../../lib/backup-code-candidates'
import { pageQrCapture } from '../../lib/page-qr-capture'
import {
  CompanionWasmRuntimeDeliveryKind,
  sendCompanionWasmRuntimeMessage,
} from '../../../../nook-web-shared/src/extension/companion-wasm-runtime-transport'
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

/** Asks Rust for the page need of a classified workflow match. */
export interface SidePanelPageNeedSource {
  pageNeed(
    workflowMatch: AuthenticationWorkflowMatch,
  ): Promise<SidePanelPageNeedReply>
}

/**
 * The content script reaches the companion WASM through the extension
 * runtime, as for every other companion decision, so Rust's site_page_need
 * runs in the offscreen document.
 */
export class CompanionSidePanelPageNeed implements SidePanelPageNeedSource {
  private readonly unavailable: SidePanelPageNeedReply = {
    kind: SidePanelPageNeedReplyKind.Unavailable,
  }

  async pageNeed(
    workflowMatch: AuthenticationWorkflowMatch,
  ): Promise<SidePanelPageNeedReply> {
    const message: CompanionWasmRuntimeMessage = {
      type: CompanionWasmSessionMessageType.SitePageNeed,
      payload: { workflowMatch },
      origin: location.origin,
    }
    const delivery = await sendCompanionWasmRuntimeMessage(globalThis, message)
    switch (delivery.kind) {
      case CompanionWasmRuntimeDeliveryKind.Unavailable:
        return this.unavailable
      case CompanionWasmRuntimeDeliveryKind.Delivered:
        break
    }
    const response = delivery.response
    switch (true) {
      case typeof response === 'object' &&
        !!response &&
        'sitePageNeed' in response:
        return {
          kind: SidePanelPageNeedReplyKind.Needed,
          need: response.sitePageNeed,
        }
      case true:
      default:
        return this.unavailable
    }
  }
}

/** Asks Rust whether a page without a selected form shows an authenticator setup. */
export interface SidePanelPageSetupSource {
  setupWorkflow(): Promise<AuthenticationWorkflowMatch>
}

/**
 * A setup dialog often has no form at all. Like Pilot's scan, this reads
 * only the pre-consent setup observation and recovery copy, never a QR
 * payload or setup key, and lets Rust match the enrollment workflow.
 */
export class CompanionSidePanelPageSetup implements SidePanelPageSetupSource {
  private readonly noMatch: AuthenticationWorkflowMatch = { kind: 'no-match' }

  async setupWorkflow(): Promise<AuthenticationWorkflowMatch> {
    const setup =
      await pageQrCapture.prepareAuthenticationAuthenticatorSetupObservation()
    switch (setup.observation) {
      case 'absent':
        return this.noMatch
      case 'present':
        break
    }
    await recoveryCopyObservation.prepareAuthenticationRecoveryEvidence()
    const message: CompanionWasmRuntimeMessage = {
      type: CompanionWasmSessionMessageType.AuthenticationEnrollmentWorkflowMatch,
      payload: {
        authenticatorSetupHint: true,
        backupCodesCopy:
          recoveryCopyObservation.authenticationRecoveryEvidence().copy,
        manualCheckpointPresent:
          passwordFieldDiscovery.pageHasManualCheckpoint(document),
      },
      origin: location.origin,
    }
    const delivery = await sendCompanionWasmRuntimeMessage(globalThis, message)
    switch (delivery.kind) {
      case CompanionWasmRuntimeDeliveryKind.Unavailable:
        throw new Error('Authenticator setup match unavailable.')
      case CompanionWasmRuntimeDeliveryKind.Delivered:
        break
    }
    const response = delivery.response
    switch (true) {
      case typeof response === 'object' &&
        !!response &&
        'kind' in response &&
        response.kind ===
          AuthenticationEnrollmentWorkflowMatchResponseKind.Matched &&
        'snapshot' in response:
        return { kind: 'matched', snapshot: response.snapshot }
      case true:
      default:
        return this.noMatch
    }
  }
}

/** The page discovery and the Rust page-need decision a query reads. */
export interface SidePanelPageNeedCollaborators {
  readonly pages: SidePanelPageWorkflowSource
  readonly needs: SidePanelPageNeedSource
  readonly setups: SidePanelPageSetupSource
}

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
 * page need Rust derives from that workflow. Nothing is cached between queries, and the
 * reply carries no field, value or URL.
 */
export class SidePanelPageNeedReceiver {
  constructor(private readonly collaborators: SidePanelPageNeedCollaborators) {}

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
    void this.collaborators.pages
      .pageWorkflow()
      .then((page) => this.reply(page))
      .then(delivery.sendResponse)
      .catch(() => answer.send(SidePanelPageNeedReplyKind.Unavailable))
    return SidePanelPageNeedReception.Responding
  }

  private reply(page: SidePanelPageWorkflow): Promise<SidePanelPageNeedReply> {
    switch (page.kind) {
      case SidePanelPageWorkflowKind.Selected: {
        const matched: AuthenticationWorkflowMatch = {
          kind: 'matched',
          snapshot: page.snapshot,
        }
        return this.collaborators.needs.pageNeed(matched)
      }
      case SidePanelPageWorkflowKind.None:
        return this.collaborators.setups
          .setupWorkflow()
          .then((setup) => this.collaborators.needs.pageNeed(setup))
      case SidePanelPageWorkflowKind.Unavailable: {
        const unavailable: SidePanelPageNeedReply = {
          kind: SidePanelPageNeedReplyKind.Unavailable,
        }
        return Promise.resolve(unavailable)
      }
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
  SidePanelPageNeedReplyKind.Needed
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
const sidePanelPageNeedCollaborators: SidePanelPageNeedCollaborators = {
  pages: new SidePanelPageWorkflowDiscovery(),
  needs: new CompanionSidePanelPageNeed(),
  setups: new CompanionSidePanelPageSetup(),
}

export const sidePanelPageNeed = new SidePanelPageNeedReceiver(
  sidePanelPageNeedCollaborators,
)
