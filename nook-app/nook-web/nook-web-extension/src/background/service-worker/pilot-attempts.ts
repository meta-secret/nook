import { Option } from 'effect'
import {
  PilotAttemptCodec,
  PilotAttemptLoadKind,
  PilotAttemptMessageType,
  type PilotAttemptLoad,
  type PilotAttemptMessage,
} from '../../lib/pilot-attempt-messages'
import type { SchemaRuntimeMessageOperationRequest } from './schema-runtime-message-route'

/** Long enough to cover a submit's reload or redirect, short enough not to resurface later. */
const PILOT_ATTEMPT_MAX_AGE_MS = 2 * 60_000

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
    const tabId = sender.tab?.id
    const origin = sender.origin
    if (tabId === undefined || sender.frameId !== 0 || origin === undefined)
      return none
    const key = storageKey(tabId)
    switch (message.type) {
      case PilotAttemptMessageType.Save: {
        const stored = { origin, attempt: message.attempt }
        await chrome.storage.session.set({ [key]: stored })
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
