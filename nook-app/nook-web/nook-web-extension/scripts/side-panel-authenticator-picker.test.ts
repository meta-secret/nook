import { describe, expect, test } from 'bun:test'
import {
  AuthenticatorPickerTabPlacementKind,
  SidePanelAuthenticatorPickerLookup,
  type AuthenticatorPickerTabPlacement,
  type SidePanelAuthenticatorPickerDependencies,
} from '../src/background/service-worker/side-panel-authenticator-picker'
import {
  AuthenticatorPickerLoadKind,
  type AuthenticatorPickerLoad,
} from '../src/background/service-worker/account-pickers'
import type { PendingAuthenticatorPicker } from '../src/background/service-worker/account-picker-session-codec'
import { SidePanelSenderAdmission } from '../src/background/service-worker/side-panel-sender'
import {
  SidePanelAuthenticatorPickerKind,
  SidePanelAuthenticatorPickerMessageType,
  type SidePanelAuthenticatorPickerMessage,
} from '../src/lib/side-panel-authenticator-picker'

type StoredRequest = {
  readonly request: PendingAuthenticatorPicker
  /** The window the requesting tab is in now; closed tabs have none. */
  readonly windowId: number
}

/** Stored Fill 2FA code requests, as the worker's session holds them. */
class StoredRequests {
  readonly current = new Map<string, StoredRequest>()
  readonly expired = new Set<string>()
  admission = SidePanelSenderAdmission.Admitted

  add(stored: StoredRequest): void {
    this.current.set(stored.request.requestId, stored)
  }

  dependencies(): SidePanelAuthenticatorPickerDependencies {
    return {
      admission: () => this.admission,
      storedRequestIds: async () => [...this.current.keys(), ...this.expired],
      load: async (requestId): Promise<AuthenticatorPickerLoad> => {
        const stored = this.current.get(requestId)
        return stored
          ? {
              kind: AuthenticatorPickerLoadKind.Available,
              request: stored.request,
              authorizationGeneration: 'generation-1',
            }
          : { kind: AuthenticatorPickerLoadKind.Unavailable }
      },
      placement: async (tabId): Promise<AuthenticatorPickerTabPlacement> => {
        const stored = [...this.current.values()].find(
          (candidate) => candidate.request.tabId === tabId,
        )
        return stored
          ? {
              kind: AuthenticatorPickerTabPlacementKind.Window,
              windowId: stored.windowId,
            }
          : { kind: AuthenticatorPickerTabPlacementKind.Gone }
      },
    }
  }
}

function request(
  requestId: string,
  tabId: number,
  expiresAt: number,
): PendingAuthenticatorPicker {
  return {
    requestId,
    origin: 'https://www.namecheap.com',
    tabId,
    frameId: 0,
    allowedVaultStoreIds: ['store-personal'],
    expiresAt,
  }
}

function asked(windowId: number): SidePanelAuthenticatorPickerMessage {
  return {
    type: SidePanelAuthenticatorPickerMessageType.Pending,
    payload: { windowId },
  }
}

const panel: chrome.runtime.MessageSender = { id: 'nook-extension' }

describe("the side panel's 2FA picker request", () => {
  test("shows the newest request of the panel's own window", async () => {
    const stored = new StoredRequests()
    stored.add({ request: request('older', 4, 1_000), windowId: 7 })
    stored.add({ request: request('newer', 5, 2_000), windowId: 7 })
    stored.add({ request: request('other-window', 6, 3_000), windowId: 9 })

    const answer = await new SidePanelAuthenticatorPickerLookup(
      stored.dependencies(),
    ).run({ message: asked(7), sender: panel })

    expect(answer).toEqual({
      kind: SidePanelAuthenticatorPickerKind.Pending,
      requestId: 'newer',
    })
  })

  test('a window with no current request shows This site', async () => {
    const stored = new StoredRequests()
    stored.expired.add('expired')
    stored.add({ request: request('elsewhere', 6, 3_000), windowId: 9 })

    const answer = await new SidePanelAuthenticatorPickerLookup(
      stored.dependencies(),
    ).run({ message: asked(7), sender: panel })

    expect(answer).toEqual({ kind: SidePanelAuthenticatorPickerKind.None })
  })

  test('only the side panel may ask', async () => {
    const stored = new StoredRequests()
    stored.add({ request: request('newer', 5, 2_000), windowId: 7 })
    stored.admission = SidePanelSenderAdmission.Forbidden

    const answer = await new SidePanelAuthenticatorPickerLookup(
      stored.dependencies(),
    ).run({ message: asked(7), sender: panel })

    expect(answer).toEqual({ kind: SidePanelAuthenticatorPickerKind.Forbidden })
  })

  test('a malformed window is refused', async () => {
    const stored = new StoredRequests()
    stored.add({ request: request('newer', 5, 2_000), windowId: 7 })
    const malformed = {
      type: SidePanelAuthenticatorPickerMessageType.Pending,
      payload: { windowId: -1 },
    }

    const answer = await new SidePanelAuthenticatorPickerLookup(
      stored.dependencies(),
    ).run({ message: malformed, sender: panel })

    expect(answer).toEqual({ kind: SidePanelAuthenticatorPickerKind.Forbidden })
  })
})
