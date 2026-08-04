import { describe, expect, test } from 'vitest'
import { sentinelGenesisLinkBaseForWorkspace } from '$lib/enrollment/sentinel-genesis-link'

describe('Sentinel Genesis links', () => {
  test('uses the configured public origin and the current canonical workspace', () => {
    expect(
      sentinelGenesisLinkBaseForWorkspace(
        'https://public.nook.example/app/',
        'https://preview.internal.example/vault/?preview=919#ignored',
      ),
    ).toBe('https://public.nook.example/vault')
  })
})
