import { describe, expect, test } from 'vitest'
import {
  APPLE_CLOUDKIT_SCRIPT_SRC,
  GOOGLE_GIS_FRAME_SRC,
  GOOGLE_GIS_SCRIPT_SRC,
  GOOGLE_GIS_STYLE_SRC,
  vaultAppContentSecurityPolicy,
  vaultAppHeaders,
} from '../../../../nook-web-shared/src/vault-app/security-headers'

describe('vault app security headers', () => {
  test('CSP allows Google Identity Services and Apple CloudKit scripts', () => {
    const csp = vaultAppContentSecurityPolicy()
    expect(csp).toContain(
      `script-src 'self' 'wasm-unsafe-eval' ${GOOGLE_GIS_SCRIPT_SRC} ${APPLE_CLOUDKIT_SCRIPT_SRC}`,
    )
    expect(csp).toContain(`frame-src ${GOOGLE_GIS_FRAME_SRC}`)
    expect(csp).toContain(
      `style-src 'self' 'unsafe-inline' ${GOOGLE_GIS_STYLE_SRC}`,
    )
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("object-src 'none'")
  })

  test('_headers includes CSP and popup-friendly COOP for OAuth', () => {
    const headers = vaultAppHeaders()
    expect(headers).toContain('Content-Security-Policy:')
    expect(headers).toContain(GOOGLE_GIS_SCRIPT_SRC)
    expect(headers).toContain(APPLE_CLOUDKIT_SCRIPT_SRC)
    expect(headers).toContain(
      'Cross-Origin-Opener-Policy: same-origin-allow-popups',
    )
    expect(headers).toContain('X-Content-Type-Options: nosniff')
  })
})
