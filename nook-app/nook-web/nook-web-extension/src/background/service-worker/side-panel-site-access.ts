import { Effect } from 'effect'
import {
  extensionSessionGrantIdentity,
  type StoredExtensionPairingGrant,
} from '../pairing-grants'
import type { ExtensionSessionResponse } from '../../offscreen/session'
import {
  extensionSessionInteractiveDeadline,
  type ExtensionSessionTransportRequest,
} from '../../offscreen/session-request-adapter'
import { ExtensionSessionMessageType } from '../../lib/extension-session-message-type'
import type { WebsiteLoginAccountOption } from '../../lib/login-fill-messages'
import type { BrowserRuntimeMessageValue } from '../../lib/browser-runtime-message'
import type { SidePanelPageFillMessage } from '../../lib/side-panel-page-fill'
import type {
  SidePanelSitePasskey,
  SidePanelSitePasskeys,
  SidePanelWindowSelection,
} from '../../lib/side-panel-site'
import type { accountPickerSessions } from './account-pickers'
import type { ExtensionSessionTransportResult } from './session-document'
import {
  SESSION_INTERACTIVE_QUEUE_TIMEOUT_MS,
  extensionSessionLifecycle,
} from './session-lifecycle'
import type { SidePanelSenderAdmission } from './side-panel-sender'
import type { SidePanelTabTarget } from './side-panel-tab-target'
import {
  decode_website_passkey_account_list,
  WebsitePasskeyAccountListKind,
} from './passkey-session-adapter'

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
  readonly passkeyPairingGrants: () => Promise<SidePanelPairingGrants>
  /** Rust's relying-party ids for a page at this origin, nearest first. */
  readonly passkeyRelyingPartyIds: (
    origin: string,
  ) => Promise<readonly string[]>
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

export enum SidePanelPasskeysKind {
  Listed = 'listed',
  Failed = 'failed',
}

export type SidePanelPasskeys =
  | {
      readonly kind: SidePanelPasskeysKind.Listed
      readonly passkeys: SidePanelSitePasskeys
    }
  | { readonly kind: SidePanelPasskeysKind.Failed }

export interface SidePanelPasskeysRequest {
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

  /**
   * The vault passkeys a page at this origin can use: Rust's listing for each
   * relying party the origin may claim. Any failed lookup fails them all.
   */
  passkeys = Effect.fn(
    this.generatorContext,
    function* (request: SidePanelPasskeysRequest) {
      const failed: SidePanelPasskeys = { kind: SidePanelPasskeysKind.Failed }
      const grants = yield* Effect.tryPromise(() =>
        this.dependencies.passkeyPairingGrants(),
      )
      const rpIds = yield* Effect.tryPromise(() =>
        this.dependencies.passkeyRelyingPartyIds(request.origin),
      )
      const passkeys: SidePanelSitePasskey[] = []
      for (const grant of grants) {
        for (const rpId of rpIds) {
          const lookup: ExtensionSessionTransportRequest = {
            type: ExtensionSessionMessageType.ListPasskeys,
            payload: {
              ...extensionSessionGrantIdentity(grant),
              rpId,
              origin: request.origin,
              queue: this.interactiveQueue(),
            },
          }
          const delivery = yield* Effect.tryPromise(() =>
            this.dependencies.sendSessionMessage(lookup),
          )
          if (delivery.isErr()) return failed
          const list = decode_website_passkey_account_list(delivery.value)
          if (
            list.kind !== WebsitePasskeyAccountListKind.Ready ||
            !('accounts' in list)
          ) {
            return failed
          }
          for (const account of list.accounts) {
            const passkey: SidePanelSitePasskey = {
              userName: account.userName,
              userDisplayName: account.userDisplayName,
              vaultLabel: grant.vaultName,
            }
            passkeys.push(passkey)
          }
        }
      }
      const listed: SidePanelPasskeys = {
        kind: SidePanelPasskeysKind.Listed,
        passkeys,
      }
      return listed
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
