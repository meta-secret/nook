import type { BrowserRuntimeMessageValue } from '../src/lib/browser-runtime-message'
import {
  SignInAttemptRoute,
  type SignInAttemptRouteDependencies,
} from '../src/background/service-worker/sign-in-attempt-route'
import {
  SignInAttemptTabRecords,
  type SignInAttemptStorageArea,
} from '../src/background/service-worker/sign-in-attempt-store'
import { companionWasmReady } from '../../nook-web-shared/src/extension/companion-ready'
import type {
  SignInAttemptMessage,
  SignInAttemptRuntimeResponse,
} from '../src/lib/sign-in-attempt-messages'
import {
  BrowserRuntimeMessage,
  BrowserRuntimeMessageAdmissionKind,
} from '../src/lib/browser-runtime-message'

type StoredValues = Record<string, BrowserRuntimeMessageValue>

/** In-memory `chrome.storage.session` with the same get/set/remove semantics. */
export class SessionStorageSimulation implements SignInAttemptStorageArea {
  readonly values: StoredValues = {}
  writes = 0
  removalFails = false

  get(key: string): Promise<StoredValues> {
    const result: StoredValues = Object.fromEntries(
      Object.entries(this.values).filter(([entry]) => entry === key),
    )
    return Promise.resolve(result)
  }

  set(values: StoredValues): Promise<void> {
    this.writes += 1
    Object.assign(this.values, values)
    return Promise.resolve()
  }

  remove(key: string): Promise<void> {
    switch (this.removalFails) {
      case true:
        return Promise.reject(new Error('storage unavailable'))
      case false:
        break
    }
    delete this.values[key]
    return Promise.resolve()
  }

  key(tab: number): string {
    return `${SignInAttemptTabRecords.KEY_PREFIX}${tab}`
  }
}

export type SignInAttemptSenderFixture = {
  readonly tab: number
  readonly frameId: number
  readonly url: string
  readonly extensionId: string
}

export type SignInAttemptRouteMessage =
  SignInAttemptMessage | BrowserRuntimeMessageValue
export type SignInAttemptRouteRequest = {
  readonly message: SignInAttemptRouteMessage
  readonly sender: SignInAttemptSenderFixture
}

type SignInAttemptAuthorization =
  SignInAttemptRouteDependencies['authorizesSender']

/**
 * A real route over simulated session storage and a controllable clock,
 * authorized by the production website-sender check.
 */
export class SignInAttemptRouteFixture {
  static readonly EXTENSION_ID = 'nook-extension'
  readonly storage = new SessionStorageSimulation()
  now = 1_800_000_000_000
  readonly route: SignInAttemptRoute

  private constructor(authorizesSender: SignInAttemptAuthorization) {
    const dependencies: SignInAttemptRouteDependencies = {
      records: new SignInAttemptTabRecords(this.storage),
      authorizesSender,
      companionReady: companionWasmReady,
      now: () => this.now,
    }
    this.route = new SignInAttemptRoute(dependencies)
  }

  static async create(): Promise<SignInAttemptRouteFixture> {
    Object.assign(globalThis, {
      __NOOK_SIMPLE_VAULT_URL__: 'https://simple.example.test/',
    })
    Object.assign(globalThis.chrome.runtime, {
      id: SignInAttemptRouteFixture.EXTENSION_ID,
    })
    const { extensionPairingIdentity } =
      await import('../src/background/service-worker/pairing-identity')
    return new SignInAttemptRouteFixture(
      extensionPairingIdentity.isAuthorizedWebsiteSender.bind(
        extensionPairingIdentity,
      ),
    )
  }

  respond(
    request: SignInAttemptRouteRequest,
  ): Promise<SignInAttemptRuntimeResponse> {
    const admission = BrowserRuntimeMessage.from(request.message)
    switch (admission.kind) {
      case BrowserRuntimeMessageAdmissionKind.Rejected:
        throw new Error('sign-in attempt fixture message must be admitted')
      case BrowserRuntimeMessageAdmissionKind.Accepted:
        break
    }
    const tab: chrome.tabs.Tab = {
      id: request.sender.tab,
      index: 0,
      pinned: false,
      highlighted: false,
      windowId: 1,
      active: true,
      incognito: false,
      selected: true,
      discarded: false,
      autoDiscardable: true,
      frozen: false,
      lastAccessed: 0,
      groupId: -1,
    }
    const sender: chrome.runtime.MessageSender = {
      id: request.sender.extensionId,
      tab,
      frameId: request.sender.frameId,
      url: request.sender.url,
    }
    return this.route.respond({ message: admission.message, sender })
  }
}
