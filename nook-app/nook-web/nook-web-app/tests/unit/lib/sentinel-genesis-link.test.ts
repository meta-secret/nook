import { describe, expect, test } from 'vitest'
import { sentinelGenesisBrowser } from '$lib/enrollment/sentinel-genesis-link'

describe('Sentinel Genesis links', () => {
  test('uses the configured public origin and the current canonical workspace', () => {
    expect(
      sentinelGenesisBrowser.sentinelGenesisLinkBaseForWorkspace({
        enrollmentLinkBase: 'https://public.nook.example/app/',
        currentLocation:
          'https://preview.internal.example/vault/?preview=919#ignored',
      }),
    ).toBe('https://public.nook.example/vault')
  })

  test('strips the unified preview mount from the public ceremony link', () => {
    expect(
      sentinelGenesisBrowser.sentinelGenesisLinkBaseForWorkspace({
        enrollmentLinkBase: 'https://public.nook.example/',
        currentLocation:
          'https://preview.internal.example/sentinel/vault#ignored',
      }),
    ).toBe('https://public.nook.example/vault')
  })
})
