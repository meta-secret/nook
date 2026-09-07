import { describe, expect, test } from 'bun:test'
import { shouldUseSpaFallback } from './static-host'

describe('mock auth static host', () => {
  test('uses the SPA shell only for client-side routes', () => {
    expect(shouldUseSpaFallback('/linkedin')).toBe(true)
    expect(shouldUseSpaFallback('/template/linkedin')).toBe(true)
    expect(shouldUseSpaFallback('/assets/index.js')).toBe(false)
    expect(shouldUseSpaFallback('/assets/styles.css')).toBe(false)
  })
})
