/// <reference path="../../../../nook-web-extension/src/vite-env.d.ts" />

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE } from '../../../../nook-web-extension/src/offscreen/session-request-adapter'
import { ExtensionSessionMessageType } from '../../../../nook-web-extension/src/offscreen/session-message-dispatch'

const mocks = vi.hoisted(() => ({
  currentCode: vi.fn(),
  sendSessionMessage: vi.fn(),
}))

vi.mock(
  '../../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm',
  () => ({
    current_code_from_otpauth_uri: mocks.currentCode,
    preview_otpauth_uri: vi.fn(),
  }),
)

vi.mock(
  '../../../../nook-web-extension/src/background/service-worker/pairing-identity',
  () => ({ sendSessionMessage: mocks.sendSessionMessage }),
)

import { stagedAuthenticatorCodeFromSession } from '../../../../nook-web-extension/src/background/service-worker/authenticator-session-adapter'
import { handleAuthenticatorEnrollmentMessage } from '../../../../nook-web-extension/src/offscreen/authenticator-enrollment-session'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('authenticator code expiry transport', () => {
  test('carries the generated expiry out of the offscreen enrollment session', async () => {
    const free = vi.fn()
    mocks.currentCode.mockReturnValue({
      code: '123456',
      expiresAtUnixSeconds: 1_725_000_030,
      free,
    })
    const request: Parameters<typeof handleAuthenticatorEnrollmentMessage>[0] =
      {
        message: {
          type: ExtensionSessionMessageType.AuthenticatorEnrollCode,
          payload: {
            otpauthUri:
              'otpauth://totp/Nook:person@example.test?secret=JBSWY3DPEHPK3PXP',
            queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
          },
        },
        dependencies: {
          ensureWasm: vi.fn(),
          getManager: vi.fn(),
          extensionVaultGrant: vi.fn(),
        },
      }

    await expect(
      handleAuthenticatorEnrollmentMessage(request),
    ).resolves.toEqual({
      ok: true,
      code: '123456',
      expiresAt: 1_725_000_030_000,
    })
    expect(free).toHaveBeenCalledOnce()
  })

  test('keeps expiry on the staged-code service-worker response', async () => {
    const expiresAt = Date.now() + 30_000
    mocks.sendSessionMessage.mockResolvedValue({
      ok: true,
      code: '123456',
      expiresAt,
    })

    await expect(
      stagedAuthenticatorCodeFromSession(
        'otpauth://totp/Nook:person@example.test?secret=JBSWY3DPEHPK3PXP',
      ),
    ).resolves.toEqual({
      ok: true,
      code: '123456',
      expiresAt,
    })
  })

  test('rejects an expired staged code at the service-worker boundary', async () => {
    mocks.sendSessionMessage.mockResolvedValue({
      ok: true,
      code: '123456',
      expiresAt: Date.now() - 1,
    })

    await expect(
      stagedAuthenticatorCodeFromSession(
        'otpauth://totp/Nook:person@example.test?secret=JBSWY3DPEHPK3PXP',
      ),
    ).rejects.toThrow('Extension session returned an invalid staged code.')
  })
})
