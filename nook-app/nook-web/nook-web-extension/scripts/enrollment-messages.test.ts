import { companionWasmReady } from '../../nook-web-shared/src/extension/companion-ready'

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
import { handleCompanionWasmMessage } from '../src/offscreen/session-companion-wasm-operations'
import {
  CompanionWasmSessionMessageType,
  type CompanionWasmSessionMessage,
  type CompanionWasmRuntimeMessage,
  type CompanionWasmSessionResponse,
} from '../../nook-web-shared/src/extension/companion-wasm-runtime-messages'

type ExtractionRuntimeResponse =
  { ok: true; result: CompanionWasmSessionResponse } | { ok: false }

describe('enrollment message guards', () => {
  test('accepts bounded otpauth preview, stage, and confirm payloads', () => {
    expect(
      Effect.runSync(
        Effect.result(
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
    ).toBe('Success')

    expect(
      Effect.runSync(
        Effect.result(
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
    ).toBe('Success')

    expect(
      Effect.runSync(
        Effect.result(
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
    ).toBe('Success')

    expect(
      Effect.runSync(
        Effect.result(
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
    ).toBe('Failure')
  })

  test('rejects hotp, missing vault, and invalid backup attach modes', () => {
    expect(
      Effect.runSync(
        Effect.result(
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
    ).toBe('Failure')

    expect(
      Effect.runSync(
        Effect.result(
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
    ).toBe('Failure')

    expect(
      Effect.runSync(
        Effect.result(
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
    ).toBe('Success')
  })
})

describe('backup code candidate extraction', () => {
  test('extracts recovery-looking lines through the actual offscreen owner and ignores prose', async () => {
    const previousChrome = globalThis.chrome
    const previousLocation = globalThis.location
    Object.assign(globalThis, {
      location: new URL('https://example.test/recovery'),
      chrome: {
        runtime: {
          sendMessage: (
            message: CompanionWasmRuntimeMessage,
            callback: (response: ExtractionRuntimeResponse) => void,
          ) => {
            void handleCompanionWasmMessage(message).then((result) =>
              result.match(
                (value) => callback({ ok: true, result: value }),
                () => callback({ ok: false }),
              ),
            )
          },
        },
      },
    })
    const text = [
      'Save your backup codes',
      'Keep these recovery codes safe.',
      'A1B2-C3D4-E5F6',
      'G7H8-I9J0-K1L2',
      'This sentence should not become a code.',
      'https://example.test/recovery',
      'alice@example.test',
    ].join('\n')

    try {
      expect(
        await recoveryCopyObservation.extractDocumentBackupCodeCandidates(text),
      ).toEqual(['A1B2-C3D4-E5F6', 'G7H8-I9J0-K1L2'])
    } finally {
      Object.assign(globalThis, {
        chrome: previousChrome,
        location: previousLocation,
      })
    }
  })

  test('keeps recovery metadata strict through the actual offscreen projection', async () => {
    for (const copy of [
      'Email: alice-2fa@nook.test',
      'Enable 2FA codes for your account',
    ]) {
      const request: CompanionWasmSessionMessage = {
        type: CompanionWasmSessionMessageType.AuthenticationRecoveryCopyEvidence,
        payload: { texts: [copy] },
      }
      const result = await handleCompanionWasmMessage(request)
      result.match(
        (response) => expect(response).toEqual({ copy: '', hint: 'absent' }),
        () => {
          throw new Error('Expected admitted recovery metadata')
        },
      )
    }
    const request: CompanionWasmSessionMessage = {
      type: CompanionWasmSessionMessageType.AuthenticationRecoveryCopyEvidence,
      payload: { texts: ['Save your backup codes'] },
    }
    const result = await handleCompanionWasmMessage(request)
    result.match(
      (response) =>
        expect(response).toEqual({
          copy: 'Save your backup codes',
          hint: 'present',
        }),
      () => {
        throw new Error('Expected admitted preservation instruction')
      },
    )
  })
})
