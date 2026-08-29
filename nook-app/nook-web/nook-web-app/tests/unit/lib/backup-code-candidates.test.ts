import { afterEach, describe, expect, test } from 'vitest'
import {
  authenticationRecoveryCopy,
  pageHasDocumentBackupCodeHint,
} from '../../../../nook-web-extension/src/lib/backup-code-candidates'

afterEach(() => {
  document.body.replaceChildren()
})

describe('backup-code presentation evidence', () => {
  test('keeps recovery secrets out of pre-consent classifier input', () => {
    document.body.innerHTML = `
      <h1>Save your recovery codes</h1>
      <ul><li>A1B2-C3D4-E5F6</li></ul>
    `

    expect(authenticationRecoveryCopy()).toBe('Save your recovery codes  ')
    expect(authenticationRecoveryCopy()).not.toContain('A1B2-C3D4-E5F6')
    expect(pageHasDocumentBackupCodeHint()).toBe(true)
  })

  test('rejects backup-code login and ordinary OTP copy', () => {
    for (const heading of [
      'Use a backup code instead',
      'Authenticator code',
      'One-time code',
    ]) {
      document.body.innerHTML = `<h1>${heading}</h1>`
      expect(pageHasDocumentBackupCodeHint()).toBe(false)
    }
  })
})
