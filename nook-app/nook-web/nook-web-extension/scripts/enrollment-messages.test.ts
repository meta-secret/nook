import { companionWasmReady } from '../../nook-web-shared/src/extension/companion-ready'
import type { AuthenticationRecoveryCopyEvidence } from '../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

await companionWasmReady
import { describe, expect, test } from 'bun:test'
import { Effect } from 'effect'
import {
  WebsiteAuthenticatorBackupAttachMessage as WebsiteAuthenticatorBackupAttachMessageSchema,
  WebsiteAuthenticatorEnrollConfirmMessage as WebsiteAuthenticatorEnrollConfirmMessageSchema,
  WebsiteAuthenticatorEnrollPreviewMessage as WebsiteAuthenticatorEnrollPreviewMessageSchema,
  WebsiteAuthenticatorEnrollStageMessage as WebsiteAuthenticatorEnrollStageMessageSchema,
} from '../src/lib/enrollment-messages'
import { recoveryCopyObservation } from '../src/lib/backup-code-candidates'

describe('enrollment message guards', () => {
  test('accepts bounded otpauth preview, stage, and confirm payloads', () => {
    expect(
      Effect.runSync(
        Effect.either(
          WebsiteAuthenticatorEnrollPreviewMessageSchema.decode({
            type: 'nook:website-authenticator-enroll-preview',
            payload: {
              origin: 'https://example.test',
              otpauthUri:
                'otpauth://totp/Example:alice?secret=JBSWY3DPEHPK3PXP&issuer=Example',
            },
          }),
        ),
      )._tag,
    ).toBe('Right')

    expect(
      Effect.runSync(
        Effect.either(
          WebsiteAuthenticatorEnrollStageMessageSchema.decode({
            type: 'nook:website-authenticator-enroll-stage',
            payload: {
              origin: 'https://example.test',
              vaultStoreId: 'store-1',
              otpauthUri:
                'otpauth://totp/Example:alice?secret=JBSWY3DPEHPK3PXP&issuer=Example',
            },
          }),
        ),
      )._tag,
    ).toBe('Right')

    expect(
      Effect.runSync(
        Effect.either(
          WebsiteAuthenticatorEnrollConfirmMessageSchema.decode({
            type: 'nook:website-authenticator-enroll-confirm',
            payload: {
              origin: 'https://example.test',
              vaultStoreId: 'store-1',
              stageId: 'stage-1',
            },
          }),
        ),
      )._tag,
    ).toBe('Right')

    expect(
      Effect.runSync(
        Effect.either(
          WebsiteAuthenticatorEnrollConfirmMessageSchema.decode({
            type: 'nook:website-authenticator-enroll-confirm',
            payload: {
              origin: 'https://example.test',
              vaultStoreId: 'store-1',
              otpauthUri:
                'otpauth://totp/Example:alice?secret=JBSWY3DPEHPK3PXP&issuer=Example',
            },
          }),
        ),
      )._tag,
    ).toBe('Left')
  })

  test('rejects hotp, missing vault, and invalid backup attach modes', () => {
    expect(
      Effect.runSync(
        Effect.either(
          WebsiteAuthenticatorEnrollPreviewMessageSchema.decode({
            type: 'nook:website-authenticator-enroll-preview',
            payload: {
              origin: 'https://example.test',
              otpauthUri:
                'otpauth://hotp/Example:alice?secret=JBSWY3DPEHPK3PXP',
            },
          }),
        ),
      )._tag,
    ).toBe('Left')

    expect(
      Effect.runSync(
        Effect.either(
          WebsiteAuthenticatorBackupAttachMessageSchema.decode({
            type: 'nook:website-authenticator-backup-attach',
            payload: {
              origin: 'https://example.test',
              vaultStoreId: 'store-1',
              secretId: 'secret_1',
              codes: ['A1B2-C3D4'],
              mode: 'append',
            },
          }),
        ),
      )._tag,
    ).toBe('Left')

    expect(
      Effect.runSync(
        Effect.either(
          WebsiteAuthenticatorBackupAttachMessageSchema.decode({
            type: 'nook:website-authenticator-backup-attach',
            payload: {
              origin: 'https://example.test',
              vaultStoreId: 'store-1',
              secretId: 'secret_1',
              codes: ['A1B2-C3D4'],
              mode: 'replace',
            },
          }),
        ),
      )._tag,
    ).toBe('Right')
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

    expect(
      recoveryCopyObservation.extractDocumentBackupCodeCandidates(text),
    ).toEqual(['A1B2-C3D4-E5F6', 'G7H8-I9J0-K1L2'])
  })

  test('does not treat 2fa inside emails as a backup-code page hint', async () => {
    // happy-dom/document unavailable in bun unit tests — exercise the regex
    // through the same exported helper with a stubbed body when present.
    const documentWasPresent = 'document' in globalThis
    const previous = globalThis.document
    const body = { innerText: 'Email: alice-2fa@nook.test\nPassword: secret' }
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: { body },
    })
    Object.assign(globalThis, {
      location: new URL('https://example.test/backup-codes'),
      chrome: {
        runtime: {
          sendMessage: (
            message: { payload: { texts: string[] } },
            callback: (response: {
              ok: true
              result: AuthenticationRecoveryCopyEvidence
            }) => void,
          ) => {
            const copy = message.payload.texts.join('\n')
            callback({
              ok: true,
              result: {
                copy,
                hint:
                  copy.includes('Save your backup codes') &&
                  copy.includes('A1B2-C3D4-E5F6')
                    ? 'present'
                    : 'absent',
              },
            })
          },
        },
      },
    })
    try {
      await recoveryCopyObservation.prepareAuthenticationRecoveryEvidence()
      expect(recoveryCopyObservation.pageHasDocumentBackupCodeHint()).toBe(
        false,
      )
      body.innerText = 'Save your backup codes\nA1B2-C3D4-E5F6'
      await recoveryCopyObservation.prepareAuthenticationRecoveryEvidence()
      expect(recoveryCopyObservation.pageHasDocumentBackupCodeHint()).toBe(true)
      body.innerText = 'Enable 2FA codes for your account'
      await recoveryCopyObservation.prepareAuthenticationRecoveryEvidence()
      expect(recoveryCopyObservation.pageHasDocumentBackupCodeHint()).toBe(
        false,
      )
    } finally {
      if (!documentWasPresent) {
        Reflect.deleteProperty(globalThis, 'document')
      } else {
        Object.defineProperty(globalThis, 'document', {
          configurable: true,
          value: previous,
        })
      }
    }
  })
})
