import { describe, expect, test } from 'bun:test'
import {
  isWebsiteAuthenticatorBackupAttachMessage,
  isWebsiteAuthenticatorEnrollConfirmMessage,
  isWebsiteAuthenticatorEnrollPreviewMessage,
} from '../src/lib/enrollment-messages'
import { extractBackupCodeCandidates } from '../src/lib/backup-code-candidates'

describe('enrollment message guards', () => {
  test('accepts bounded otpauth preview and confirm payloads', () => {
    expect(
      isWebsiteAuthenticatorEnrollPreviewMessage({
        type: 'nook:website-authenticator-enroll-preview',
        payload: {
          origin: 'https://example.test',
          otpauthUri:
            'otpauth://totp/Example:alice?secret=JBSWY3DPEHPK3PXP&issuer=Example',
        },
      }),
    ).toBe(true)

    expect(
      isWebsiteAuthenticatorEnrollConfirmMessage({
        type: 'nook:website-authenticator-enroll-confirm',
        payload: {
          origin: 'https://example.test',
          vaultStoreId: 'store-1',
          otpauthUri:
            'otpauth://totp/Example:alice?secret=JBSWY3DPEHPK3PXP&issuer=Example',
        },
      }),
    ).toBe(true)
  })

  test('rejects hotp, missing vault, and invalid backup attach modes', () => {
    expect(
      isWebsiteAuthenticatorEnrollPreviewMessage({
        type: 'nook:website-authenticator-enroll-preview',
        payload: {
          origin: 'https://example.test',
          otpauthUri: 'otpauth://hotp/Example:alice?secret=JBSWY3DPEHPK3PXP',
        },
      }),
    ).toBe(false)

    expect(
      isWebsiteAuthenticatorBackupAttachMessage({
        type: 'nook:website-authenticator-backup-attach',
        payload: {
          origin: 'https://example.test',
          vaultStoreId: 'store-1',
          secretId: 'secret_1',
          codes: ['A1B2-C3D4'],
          mode: 'append',
        },
      }),
    ).toBe(false)

    expect(
      isWebsiteAuthenticatorBackupAttachMessage({
        type: 'nook:website-authenticator-backup-attach',
        payload: {
          origin: 'https://example.test',
          vaultStoreId: 'store-1',
          secretId: 'secret_1',
          codes: ['A1B2-C3D4'],
          mode: 'replace',
        },
      }),
    ).toBe(true)
  })
})

describe('backup code candidate extraction', () => {
  test('extracts recovery-looking lines and ignores prose', () => {
    const text = [
      'Save your backup codes',
      'Keep these recovery codes safe.',
      'A1B2-C3D4-E5F6',
      'G7H8-I9J0-K1L2',
      'This sentence should not become a code.',
      'https://example.test/recovery',
      'alice@example.test',
    ].join('\n')

    expect(extractBackupCodeCandidates(text)).toEqual([
      'A1B2-C3D4-E5F6',
      'G7H8-I9J0-K1L2',
    ])
  })
})
