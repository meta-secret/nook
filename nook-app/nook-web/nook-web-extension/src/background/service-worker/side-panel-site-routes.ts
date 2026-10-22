import type {
  BrowserRuntimeMessage,
  BrowserRuntimeMessageValue,
} from '../../lib/browser-runtime-message'
import {
  SidePanelCodeFillKind,
  SidePanelLoginFillKind,
  SidePanelSiteListingKind,
  SidePanelSiteMessages,
  type SidePanelCodeFillOutcome,
  type SidePanelLoginFillOutcome,
  type SidePanelSiteListing,
} from '../../lib/side-panel-site'
import {
  accountPickerAuthorizationCleanupPending,
  accountPickerAuthorizationGeneration,
  accountPickerAuthorizationIsCurrent,
  accountPickerSessions,
} from './account-pickers'
import { extensionPairingIdentity } from './pairing-identity'
import { SidePanelCodeFillOperation } from './side-panel-code-fill-operation'
import {
  SchemaRuntimeMessageRoute,
  type BackgroundRuntimeMessageRoute,
  type RuntimeMessageSchema,
} from './schema-runtime-message-route'
import { SidePanelSender } from './side-panel-sender'
import type {
  SidePanelPageDelivery,
  SidePanelSiteDependencies,
} from './side-panel-site-access'
import {
  SidePanelLoginFillOperation,
  SidePanelSiteListingOperation,
} from './side-panel-site-operations'
import {
  CompanionSidePanelTabClassifier,
  SidePanelTabTargetResolver,
} from './side-panel-tab-target'

/** The tab's top frame received the message, but no content script there
 * answered it. */
export class SidePanelPageUnanswered extends Error {
  constructor() {
    super('No content script answered in the top frame.')
  }
}

/** Delivers the Fill trigger to the top frame of the resolved tab only. */
export class SidePanelTopFrame {
  private readonly options: chrome.tabs.MessageSendOptions = { frameId: 0 }

  /**
   * Fails when no content script answers, as when none is there. A frame
   * whose listeners all leave the message alone (the vault bridge hears only
   * the extension's lock notice) resolves with no reply: nothing answered.
   */
  async send(
    delivery: SidePanelPageDelivery,
  ): Promise<BrowserRuntimeMessageValue> {
    const reply = await chrome.tabs.sendMessage<
      SidePanelPageDelivery['message'],
      BrowserRuntimeMessageValue
    >(delivery.tabId, delivery.message, this.options)
    if (!SidePanelTopFrame.answered(reply)) throw new SidePanelPageUnanswered()
    return reply
  }

  /** Chrome resolves with nothing, whatever the declared reply type, when no
   * listener answered. */
  private static answered(reply: BrowserRuntimeMessageValue): boolean {
    switch (typeof reply) {
      case 'string':
      case 'number':
      case 'boolean':
      case 'object':
        return true
      default:
        return false
    }
  }
}

type SidePanelTabTargetResolverConfiguration = ConstructorParameters<
  typeof SidePanelTabTargetResolver
>[0]

/** The service worker's side-panel This-site routes and their capabilities. */
export class SidePanelSiteRoutes {
  private constructor() {}

  private static readonly tabTargetConfiguration: SidePanelTabTargetResolverConfiguration =
    { classifier: new CompanionSidePanelTabClassifier() }
  private static readonly tabTargets = new SidePanelTabTargetResolver(
    SidePanelSiteRoutes.tabTargetConfiguration,
  )
  private static readonly topFrame = new SidePanelTopFrame()

  static readonly dependencies: SidePanelSiteDependencies = {
    senderAdmission: (sender) => new SidePanelSender(sender).admission(),
    tabTarget: SidePanelSiteRoutes.tabTargets.resolve.bind(
      SidePanelSiteRoutes.tabTargets,
    ),
    authorizationGeneration: accountPickerAuthorizationGeneration,
    authorizationIsCurrent: accountPickerAuthorizationIsCurrent,
    authorizationCleanupPending: accountPickerAuthorizationCleanupPending,
    passwordPairingGrants: extensionPairingIdentity.passwordPairingGrants.bind(
      extensionPairingIdentity,
    ),
    sendSessionMessage: extensionPairingIdentity.sendSessionMessage.bind(
      extensionPairingIdentity,
    ),
    loginAccountAvailabilityForOrigin:
      accountPickerSessions.loginAccountAvailabilityForOrigin.bind(
        accountPickerSessions,
      ),
    sendPageMessage: SidePanelSiteRoutes.topFrame.send.bind(
      SidePanelSiteRoutes.topFrame,
    ),
    now: () => Date.now(),
  }

  private static readonly listFailed: SidePanelSiteListing = {
    kind: SidePanelSiteListingKind.ListFailed,
  }
  private static readonly fillFailed: SidePanelLoginFillOutcome = {
    kind: SidePanelLoginFillKind.FillFailed,
  }
  private static readonly listLogins: RuntimeMessageSchema<BrowserRuntimeMessage> =
    { decode: SidePanelSiteMessages.matchesListLogins }
  private static readonly codeFillFailed: SidePanelCodeFillOutcome = {
    kind: SidePanelCodeFillKind.FillFailed,
  }
  private static readonly fillLogin: RuntimeMessageSchema<BrowserRuntimeMessage> =
    { decode: SidePanelSiteMessages.matchesFillLogin }
  private static readonly fillCode: RuntimeMessageSchema<BrowserRuntimeMessage> =
    { decode: SidePanelSiteMessages.matchesFillCode }

  /** The listing route; its operation decodes the request strictly. */
  static listing(): BackgroundRuntimeMessageRoute {
    const operation = new SidePanelSiteListingOperation(
      SidePanelSiteRoutes.dependencies,
    )
    return SchemaRuntimeMessageRoute.matching(SidePanelSiteRoutes.listLogins)
      .respondWith(operation.run.bind(operation))
      .onRejected(() => SidePanelSiteRoutes.listFailed)
  }

  /** The Fill route; its operation decodes the request strictly. */
  static fill(): BackgroundRuntimeMessageRoute {
    const operation = new SidePanelLoginFillOperation(
      SidePanelSiteRoutes.dependencies,
    )
    return SchemaRuntimeMessageRoute.matching(SidePanelSiteRoutes.fillLogin)
      .respondWith(operation.run.bind(operation))
      .onRejected(() => SidePanelSiteRoutes.fillFailed)
  }

  /** The Fill code route; its operation decodes the request strictly. */
  static codeFill(): BackgroundRuntimeMessageRoute {
    const operation = new SidePanelCodeFillOperation(
      SidePanelSiteRoutes.dependencies,
    )
    return SchemaRuntimeMessageRoute.matching(SidePanelSiteRoutes.fillCode)
      .respondWith(operation.run.bind(operation))
      .onRejected(() => SidePanelSiteRoutes.codeFillFailed)
  }
}
