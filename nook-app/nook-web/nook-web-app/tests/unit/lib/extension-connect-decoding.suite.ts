import { describe, expect, test } from 'vitest'
import { Effect } from 'effect'
import { companionResponseDecoder } from '$lib/extension/connect'

describe('extension runtime response decoding', () => {
  test('rejects launcher acknowledgements with unrelated fields', () => {
    const decoded = Effect.runSync(
      Effect.result(
        companionResponseDecoder.decodeLauncher({ ok: true, stale: true }),
      ),
    )

    expect(decoded._tag).toBe('Failure')
  })
})
