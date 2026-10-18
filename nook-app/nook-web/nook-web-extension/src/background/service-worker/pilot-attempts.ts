import { Option } from 'effect'
import {
  PilotAttemptCodec,
  PilotAttemptLoadKind,
  PilotAttemptMessageType,
  type PilotAttempt,
  type PilotAttemptLoad,
  type PilotAttemptMessage,
} from '../../lib/pilot-attempt-messages'
import type { SchemaRuntimeMessageOperationRequest } from './schema-runtime-message-route'

/** Long enough to cover a submit's reload or redirect, short enough not to resurface later. */
const PILOT_ATTEMPT_MAX_AGE_MS = 2 * 60_000

type StoredPilotAttempt = {
  readonly origin: string
  readonly attempt: PilotAttempt
}

function storageKey(tabId: number): string {
  return `pilotAttempt:${tabId}`
}

/** One attempt per tab, bound to the top frame's origin, kept only in session storage. */
export class PilotAttempts {
  private constructor() {}

  static async handle(
    request: SchemaRuntimeMessageOperationRequest<PilotAttemptMessage>,
  ): Promise<PilotAttemptLoad> {
    const none: PilotAttemptLoad = { kind: PilotAttemptLoadKind.None }
    const { message, sender } = request
    if (
      !sender.tab ||
      typeof sender.tab.id !== 'number' ||
      sender.frameId !== 0 ||
      typeof sender.origin !== 'string'
    )
      return none
    const tabId = sender.tab.id
    const origin = sender.origin
    const key = storageKey(tabId)
    switch (message.type) {
      case PilotAttemptMessageType.Save: {
        const stored: StoredPilotAttempt = { origin, attempt: message.attempt }
        const items: Record<string, StoredPilotAttempt> = { [key]: stored }
        await chrome.storage.session.set(items)
        return none
      }
      case PilotAttemptMessageType.Clear:
        await chrome.storage.session.remove(key)
        return none
      case PilotAttemptMessageType.Load: {
        const items = await chrome.storage.session.get(key)
        const stored = PilotAttemptCodec.decodeStored(items[key])
        if (
          Option.isNone(stored) ||
          stored.value.origin !== origin ||
          Date.now() - stored.value.attempt.startedAt > PILOT_ATTEMPT_MAX_AGE_MS
        ) {
          await chrome.storage.session.remove(key)
          return none
        }
        return {
          kind: PilotAttemptLoadKind.Found,
          attempt: stored.value.attempt,
        }
      }
    }
  }

  static forgetClosedTab(tabId: number): void {
    void chrome.storage.session.remove(storageKey(tabId))
  }
}
