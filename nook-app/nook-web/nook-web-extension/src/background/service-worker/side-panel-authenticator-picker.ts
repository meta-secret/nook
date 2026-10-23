import { Effect } from 'effect'
import type { BrowserRuntimeMessage } from '../../lib/browser-runtime-message'
import {
  SidePanelAuthenticatorPickerKind,
  SidePanelAuthenticatorPickerMessages,
  type SidePanelAuthenticatorPicker,
} from '../../lib/side-panel-authenticator-picker'
import type { PendingAuthenticatorPicker } from './account-picker-session-codec'
import {
  AuthenticatorPickerLoadKind,
  accountPickerSessions,
  type AuthenticatorPickerLoad,
} from './account-pickers'
import {
  SchemaRuntimeMessageRoute,
  type BackgroundRuntimeMessageRoute,
  type RuntimeMessageSchema,
} from './schema-runtime-message-route'
import { SidePanelSender, SidePanelSenderAdmission } from './side-panel-sender'

/** Where a requesting tab is now: tabs move between windows and close. */
export enum AuthenticatorPickerTabPlacementKind {
  Window = 'window',
  Gone = 'gone',
}

export type AuthenticatorPickerTabPlacement =
  | {
      readonly kind: AuthenticatorPickerTabPlacementKind.Window
      readonly windowId: number
    }
  | { readonly kind: AuthenticatorPickerTabPlacementKind.Gone }

export type SidePanelAuthenticatorPickerDependencies = {
  readonly admission: (
    sender: chrome.runtime.MessageSender,
  ) => SidePanelSenderAdmission
  /** Every Fill 2FA code request stored for this session. */
  readonly storedRequestIds: () => Promise<readonly string[]>
  /** A request that is still current: unexpired and from this unlock. */
  readonly load: (requestId: string) => Promise<AuthenticatorPickerLoad>
  readonly placement: (
    tabId: number,
  ) => Promise<AuthenticatorPickerTabPlacement>
}

type SidePanelAuthenticatorPickerRequest = {
  readonly message: BrowserRuntimeMessage
  readonly sender: chrome.runtime.MessageSender
}

/**
 * The side panel's question: which page of its window waits for a 2FA code.
 * The Nook Pilot's Fill 2FA code stores a request bound to its tab, frame
 * and origin and opens the panel; the panel then shows the picker for the
 * newest current request whose tab is in the panel's window. Choosing an
 * item still goes through the request, which fills only that page.
 */
export class SidePanelAuthenticatorPickerLookup {
  private static readonly none: SidePanelAuthenticatorPicker = {
    kind: SidePanelAuthenticatorPickerKind.None,
  }
  private static readonly forbidden: SidePanelAuthenticatorPicker = {
    kind: SidePanelAuthenticatorPickerKind.Forbidden,
  }

  constructor(
    private readonly dependencies: SidePanelAuthenticatorPickerDependencies,
  ) {}

  async run({
    message,
    sender,
  }: SidePanelAuthenticatorPickerRequest): Promise<SidePanelAuthenticatorPicker> {
    switch (this.dependencies.admission(sender)) {
      case SidePanelSenderAdmission.Forbidden:
        return SidePanelAuthenticatorPickerLookup.forbidden
      case SidePanelSenderAdmission.Admitted:
        break
    }
    const decoded = await Effect.runPromise(
      Effect.result(
        SidePanelAuthenticatorPickerMessages.decodeMessage(message),
      ),
    )
    if (decoded._tag === 'Failure')
      return SidePanelAuthenticatorPickerLookup.forbidden
    const { windowId } = decoded.success.payload
    let answer = SidePanelAuthenticatorPickerLookup.none
    let newestExpiry = 0
    for (const requestId of await this.dependencies.storedRequestIds()) {
      const loaded = await this.dependencies.load(requestId)
      if (loaded.kind === AuthenticatorPickerLoadKind.Unavailable) continue
      const request: PendingAuthenticatorPicker = loaded.request
      const placement = await this.dependencies.placement(request.tabId)
      if (
        placement.kind === AuthenticatorPickerTabPlacementKind.Window &&
        placement.windowId === windowId &&
        request.expiresAt > newestExpiry
      ) {
        newestExpiry = request.expiresAt
        answer = {
          kind: SidePanelAuthenticatorPickerKind.Pending,
          requestId: request.requestId,
        }
      }
    }
    return answer
  }
}

/** The worker's route for the panel's question, on the live session. */
export class SidePanelAuthenticatorPickerRoute {
  private static readonly schema: RuntimeMessageSchema<BrowserRuntimeMessage> =
    { decode: SidePanelAuthenticatorPickerMessages.matches }
  private static readonly none: SidePanelAuthenticatorPicker = {
    kind: SidePanelAuthenticatorPickerKind.None,
  }
  private static readonly gone: AuthenticatorPickerTabPlacement = {
    kind: AuthenticatorPickerTabPlacementKind.Gone,
  }

  private static async placement(
    tabId: number,
  ): Promise<AuthenticatorPickerTabPlacement> {
    try {
      const tab = await chrome.tabs.get(tabId)
      return {
        kind: AuthenticatorPickerTabPlacementKind.Window,
        windowId: tab.windowId,
      }
    } catch {
      // The requesting tab closed: its request has no page left to fill.
      return SidePanelAuthenticatorPickerRoute.gone
    }
  }

  static route(): BackgroundRuntimeMessageRoute {
    const dependencies: SidePanelAuthenticatorPickerDependencies = {
      admission: (sender) => new SidePanelSender(sender).admission(),
      storedRequestIds: () =>
        accountPickerSessions.storedAuthenticatorPickerIds(),
      load: (requestId) =>
        accountPickerSessions.loadAuthenticatorPicker(requestId),
      placement: SidePanelAuthenticatorPickerRoute.placement,
    }
    const lookup = new SidePanelAuthenticatorPickerLookup(dependencies)
    return SchemaRuntimeMessageRoute.matching(
      SidePanelAuthenticatorPickerRoute.schema,
    )
      .respondWith(lookup.run.bind(lookup))
      .onRejected(() => SidePanelAuthenticatorPickerRoute.none)
  }
}
