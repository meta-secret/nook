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

  test.each([7, [], { payload: {} }, { type: '' }])(
    'rejects a non-message browser value: %p',
    (value) => {
      expect(BrowserRuntimeMessage.from(value)).toEqual({
        kind: BrowserRuntimeMessageAdmissionKind.Rejected,
      })
    },
  )
})
