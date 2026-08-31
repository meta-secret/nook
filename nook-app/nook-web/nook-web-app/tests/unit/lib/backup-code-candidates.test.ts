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

    expect(authenticationRecoveryCopy()).toBe('Save your recovery codes')
    expect(authenticationRecoveryCopy()).not.toContain('A1B2-C3D4-E5F6')
    expect(pageHasDocumentBackupCodeHint()).toBe(true)
  })

  test('drops mixed instructional copy that contains an inline secret', () => {
    document.body.innerHTML = `
      <p>Save your recovery codes: A1B2-C3D4-E5F6</p>
      <h1>Backup codes</h1>
    `

    expect(authenticationRecoveryCopy()).toBe('Backup codes')
    expect(authenticationRecoveryCopy()).not.toContain('A1B2-C3D4-E5F6')
    expect(pageHasDocumentBackupCodeHint()).toBe(true)
  })

  test('keeps digit-format instructions without mixing separate elements', () => {
    document.body.innerHTML = `
      <p>Save your 8-digit backup codes somewhere secure.</p>
      <p>Enter one of your backup codes</p>
      <p>Save this device</p>
    `

    expect(authenticationRecoveryCopy()).toBe(
      'Save your 8-digit backup codes somewhere secure.',
    )
    expect(pageHasDocumentBackupCodeHint()).toBe(true)
  })

  test('uses visible instructional paragraphs but excludes hidden and code-bearing copy', () => {
    document.body.innerHTML = `
      <h1>Backup codes</h1>
      <p>Save these recovery codes somewhere secure.</p>
      <p hidden>Save your hidden backup codes</p>
      <div aria-hidden="true"><p>Save your inactive backup codes</p></div>
      <button>Copy A1B2-C3D4-E5F6</button>
    `

    expect(authenticationRecoveryCopy()).toBe(
      'Save these recovery codes somewhere secure. Backup codes',
    )
    expect(authenticationRecoveryCopy()).not.toContain('hidden')
    expect(authenticationRecoveryCopy()).not.toContain('inactive')
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

  test('prioritizes recovery evidence after long unrelated copy', () => {
    document.body.innerHTML = `
      <h1>${'Unrelated account details '.repeat(8)}</h1>
      <p>Save these recovery codes somewhere secure.</p>
    `

    expect(authenticationRecoveryCopy()).toContain('Save these recovery codes')
    expect(pageHasDocumentBackupCodeHint()).toBe(true)
  })
})
