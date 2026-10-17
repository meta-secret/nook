import { Effect } from 'effect'
import type { StoredExtensionPairingGrant } from '../pairing-grants'
import type { ExtensionSessionResponse } from '../../offscreen/session'
import {
  extensionSessionInteractiveDeadline,
  type ExtensionSessionTransportRequest,
} from '../../offscreen/session-request-adapter'
import { ExtensionSessionMessageType } from '../../lib/extension-session-message-type'
import type { WebsiteLoginAccountOption } from '../../lib/login-fill-messages'
import type { BrowserRuntimeMessageValue } from '../../lib/browser-runtime-message'
import type { SidePanelPageFillMessage } from '../../lib/side-panel-page-fill'
import type { SidePanelWindowSelection } from '../../lib/side-panel-site'
import type { accountPickerSessions } from './account-pickers'
import type { ExtensionSessionTransportResult } from './session-document'
import {
  SESSION_INTERACTIVE_QUEUE_TIMEOUT_MS,
  extensionSessionLifecycle,
} from './session-lifecycle'
import type { SidePanelSenderAdmission } from './side-panel-sender'
import type { SidePanelTabTarget } from './side-panel-tab-target'

type LoginAvailabilityRequest = Parameters<
  typeof accountPickerSessions.loginAccountAvailabilityForOrigin
>[0]
type LoginAvailability = Awaited<
  ReturnType<typeof accountPickerSessions.loginAccountAvailabilityForOrigin>
>

/** One Fill trigger for frame 0 of the tab the worker resolved. */
export interface SidePanelPageDelivery {
  readonly tabId: number
  readonly message: SidePanelPageFillMessage
}

export type SidePanelPairingGrants = readonly StoredExtensionPairingGrant[]

/** The worker capabilities the side-panel routes act through. */
export interface SidePanelSiteDependencies {
  readonly senderAdmission: (
    sender: chrome.runtime.MessageSender,
  ) => SidePanelSenderAdmission
  readonly tabTarget: (
    selection: SidePanelWindowSelection,
  ) => Promise<SidePanelTabTarget>
  readonly authorizationGeneration: () => Promise<string>
  readonly authorizationIsCurrent: (generation: string) => boolean
  readonly authorizationCleanupPending: () => Promise<boolean>
  readonly passwordPairingGrants: () => Promise<SidePanelPairingGrants>
  readonly sendSessionMessage: (
    message: ExtensionSessionTransportRequest,
  ) => Promise<ExtensionSessionTransportResult<ExtensionSessionResponse>>
  readonly loginAccountAvailabilityForOrigin: (
    request: LoginAvailabilityRequest,
  ) => Promise<LoginAvailability>
  readonly sendPageMessage: (
    delivery: SidePanelPageDelivery,
  ) => Promise<BrowserRuntimeMessageValue>
  readonly now: () => number
}

export enum SidePanelAuthorizationKind {
  Current = 'current',
  Revoked = 'revoked',
}

export type SidePanelAuthorization =
  | {
      readonly kind: SidePanelAuthorizationKind.Current
      readonly generation: string
    }
  | { readonly kind: SidePanelAuthorizationKind.Revoked }

export enum SidePanelSessionKind {
  Unlocked = 'unlocked',
  Locked = 'locked',
  Unavailable = 'unavailable',
}

export enum SidePanelLoginsKind {
  Listed = 'listed',
  Failed = 'failed',
}

export type SidePanelSiteAccounts = readonly WebsiteLoginAccountOption[]

export type SidePanelLogins =
  | {
      readonly kind: SidePanelLoginsKind.Listed
      readonly accounts: SidePanelSiteAccounts
    }
  | { readonly kind: SidePanelLoginsKind.Failed }

export interface SidePanelLoginsRequest {
  readonly grants: SidePanelPairingGrants
  readonly origin: string
}

/**
 * The gates both side-panel routes share: the account-picker authorization
 * generation, the password-filling grants, the session status probe and the
 * fail-closed Rust listing. None of them opens the companion launcher.
 */
export class SidePanelSiteAccess {
  private readonly revoked: SidePanelAuthorization = {
    kind: SidePanelAuthorizationKind.Revoked,
  }
  private readonly generatorContext: SidePanelSiteAccessGeneratorContext = {
    self: this,
  }

  constructor(private readonly dependencies: SidePanelSiteDependencies) {}

  /** The current generation, or revoked while a lock cleanup is pending. */
  authorization = Effect.fn(this.generatorContext, function* () {
    const generation = yield* Effect.tryPromise(() =>
      this.dependencies.authorizationGeneration(),
    )
    return yield* this.stillCurrent(generation)
  })

  stillCurrent = Effect.fn(
    this.generatorContext,
    function* (generation: string) {
      const cleanupPending = yield* Effect.tryPromise(() =>
        this.dependencies.authorizationCleanupPending(),
      )
      const current =
        this.dependencies.authorizationIsCurrent(generation) && !cleanupPending
      switch (current) {
        case true: {
          const authorization: SidePanelAuthorization = {
            kind: SidePanelAuthorizationKind.Current,
            generation,
          }
          return authorization
        }
        case false:
          return this.revoked
      }
    },
  )

  grants = Effect.fn(this.generatorContext, function* () {
    return yield* Effect.tryPromise(() =>
      this.dependencies.passwordPairingGrants(),
    )
  })

  /** Probes the offscreen session; the panel renders its own unlock state. */
  session = Effect.fn(this.generatorContext, function* () {
    const request: ExtensionSessionTransportRequest = {
      type: ExtensionSessionMessageType.Status,
      payload: { queue: this.interactiveQueue() },
    }
    const delivery = yield* Effect.tryPromise(() =>
      this.dependencies.sendSessionMessage(request),
    )
    return delivery.match(
      (status) => this.sessionState(status),
      () => SidePanelSessionKind.Unavailable,
    )
  })

  /** Rust's Login-only listing for the origin; any grant failure fails it all. */
  logins = Effect.fn(
    this.generatorContext,
    function* (request: SidePanelLoginsRequest) {
      const listing: LoginAvailabilityRequest = {
        grants: [...request.grants],
        origin: request.origin,
        queue: this.interactiveQueue(),
        sendMessage: this.dependencies.sendSessionMessage,
      }
      const availability = yield* Effect.tryPromise(() =>
        this.dependencies.loginAccountAvailabilityForOrigin(listing),
      )
      switch (availability.ok) {
        case true: {
          const listed: SidePanelLogins = {
            kind: SidePanelLoginsKind.Listed,
            accounts: availability.accounts,
          }
          return listed
        }
        case false: {
          const failed: SidePanelLogins = { kind: SidePanelLoginsKind.Failed }
          return failed
        }
      }
    },
  )

  private interactiveQueue() {
    return extensionSessionInteractiveDeadline(
      this.dependencies.now() + SESSION_INTERACTIVE_QUEUE_TIMEOUT_MS,
    )
  }

  private sessionState(status: ExtensionSessionResponse): SidePanelSessionKind {
    switch (extensionSessionLifecycle.isUnlockedSessionStatus(status)) {
      case true:
        return SidePanelSessionKind.Unlocked
      case false:
        return SidePanelSessionKind.Locked
    }
  }
}

type SidePanelSiteAccessGeneratorContext = {
  readonly self: SidePanelSiteAccess
}
