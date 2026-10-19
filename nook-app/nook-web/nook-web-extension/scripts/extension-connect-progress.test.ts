import { describe, expect, test } from 'bun:test'
import { Effect } from 'effect'
import {
  ExtensionConnectFailureReason,
  ExtensionConnectStepKind,
  ExtensionConnectSteps,
  type ExtensionConnectStep,
} from '../../nook-web-shared/src/extension/extension-connect-progress'
import { RuntimeMessageDecodeFailureKind } from '../../nook-web-shared/src/extension/runtime-message-decode-failure'
import type { BrowserRuntimeMessageValue } from '../src/lib/browser-runtime-message'

class StepDecoding {
  decode(message: BrowserRuntimeMessageValue) {
    return Effect.runSync(Effect.result(ExtensionConnectSteps.decode(message)))
  }
}

const decoding = new StepDecoding()

describe('connect page step protocol', () => {
  test('decodes every step the page reports', () => {
    const steps: ExtensionConnectStep[] = [
      { kind: ExtensionConnectStepKind.Opened },
      { kind: ExtensionConnectStepKind.Unlock },
      { kind: ExtensionConnectStepKind.Choosing },
      { kind: ExtensionConnectStepKind.Creating },
      { kind: ExtensionConnectStepKind.Consent },
      { kind: ExtensionConnectStepKind.Approved },
      ...Object.values(ExtensionConnectFailureReason).map(
        (reason): ExtensionConnectStep => ({
          kind: ExtensionConnectStepKind.Failed,
          reason,
        }),
      ),
    ]
    for (const step of steps) {
      const decoded = decoding.decode(step)
      expect(decoded._tag).toBe('Success')
      switch (decoded._tag) {
        case 'Success':
          expect(decoded.success).toEqual(step)
          break
        case 'Failure':
          break
      }
    }
  })

  test('rejects unknown steps, missing or unknown reasons, and other values', () => {
    const invalid: BrowserRuntimeMessageValue[] = [
      { kind: 'teleported' },
      { kind: ExtensionConnectStepKind.Failed },
      { kind: ExtensionConnectStepKind.Failed, reason: 'gremlins' },
      { type: ExtensionConnectStepKind.Opened },
      'opened',
      42,
      [{ kind: ExtensionConnectStepKind.Opened }],
    ]
    for (const message of invalid) {
      const decoded = decoding.decode(message)
      expect(decoded._tag).toBe('Failure')
      switch (decoded._tag) {
        case 'Failure':
          expect(decoded.failure.kind).toBe(
            RuntimeMessageDecodeFailureKind.ExtensionConnectStep,
          )
          break
        case 'Success':
          break
      }
    }
  })

  test('rejects unknown fields, so a step carries nothing else', () => {
    const withIdentity: BrowserRuntimeMessageValue = {
      kind: ExtensionConnectStepKind.Unlock,
      identity: 'Alice Martin',
    }
    const failedWithDetail: BrowserRuntimeMessageValue = {
      kind: ExtensionConnectStepKind.Failed,
      reason: ExtensionConnectFailureReason.Delivery,
      detail: 'event-log-import-failed',
    }
    expect(decoding.decode(withIdentity)._tag).toBe('Failure')
    expect(decoding.decode(failedWithDetail)._tag).toBe('Failure')
  })
})
