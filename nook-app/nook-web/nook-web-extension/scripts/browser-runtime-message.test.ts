import { describe, expect, test } from 'bun:test'
import {
  BrowserRuntimeMessage,
  BrowserRuntimeMessageAdmissionKind,
} from '../src/lib/browser-runtime-message'

describe('browser runtime message ingress', () => {
  test('admits a typed message envelope for schema-specific routing', () => {
    const admission = BrowserRuntimeMessage.from({ type: 'nook:test' })

    expect(admission.kind).toBe(BrowserRuntimeMessageAdmissionKind.Accepted)
    if (admission.kind === BrowserRuntimeMessageAdmissionKind.Accepted) {
      expect(admission.message.type).toBe('nook:test')
    }
  })

  test('rejects primitive browser values', () => {
    expect(BrowserRuntimeMessage.from(7)).toEqual({
      kind: BrowserRuntimeMessageAdmissionKind.Rejected,
    })
  })

  test('rejects browser arrays', () => {
    expect(BrowserRuntimeMessage.from([])).toEqual({
      kind: BrowserRuntimeMessageAdmissionKind.Rejected,
    })
  })

  test('rejects objects without a message type', () => {
    expect(BrowserRuntimeMessage.from({ payload: {} })).toEqual({
      kind: BrowserRuntimeMessageAdmissionKind.Rejected,
    })
  })

  test('rejects an empty message type', () => {
    expect(BrowserRuntimeMessage.from({ type: '' })).toEqual({
      kind: BrowserRuntimeMessageAdmissionKind.Rejected,
    })
  })
})
