import { describe, expect, test } from 'bun:test'
import { MockAuthStaticHostPolicy } from './static-host'

describe('mock auth static host', () => {
  test('uses the SPA shell only for client-side routes', () => {
    expect(MockAuthStaticHostPolicy.shouldUseSpaFallback('/linkedin')).toBe(
      true,
    )
    expect(
      MockAuthStaticHostPolicy.shouldUseSpaFallback('/template/linkedin'),
    ).toBe(true)
    expect(
      MockAuthStaticHostPolicy.shouldUseSpaFallback('/assets/index.js'),
    ).toBe(false)
    expect(
      MockAuthStaticHostPolicy.shouldUseSpaFallback('/assets/styles.css'),
    ).toBe(false)
  })
})
