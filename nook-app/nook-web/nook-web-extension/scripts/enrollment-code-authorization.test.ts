import { describe, expect, test } from 'bun:test'
import { AuthenticatorCodeResponseKind } from '../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { fillStagedEnrollmentCode } from '../src/content/enrollment-outcome'
import {
  type AuthenticatorCodeResponse,
  RuntimeMessageDeliveryKind,
} from '../src/content/autofill/login-passkey-actions'

describe('staged enrollment code authorization', () => {
  test('scrubs a code returned after enrollment authorization changes', async () => {
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: { origin: 'https://login.example.test' },
    })
    const response: AuthenticatorCodeResponse = {
      kind: AuthenticatorCodeResponseKind.Ready,
      code: '123456',
    }
    const host: Parameters<typeof fillStagedEnrollmentCode>[0]['host'] = {
      sendAuthenticatorCodeRuntimeMessage: async () => ({
        kind: RuntimeMessageDeliveryKind.Delivered,
        response,
      }),
      sendAuthenticationOutcomeRuntimeMessage: async () => {
        throw new Error('Outcome classification is not part of code fill.')
      },
    }
    const request: Parameters<typeof fillStagedEnrollmentCode>[0] = {
      host,
      stageId: 'stage_1',
      authorizationIsCurrent: () => false,
    }

    try {
      expect(await fillStagedEnrollmentCode(request)).toBe(false)
      expect(response.code).toBe('')
    } finally {
      Reflect.deleteProperty(globalThis, 'location')
    }
  })
})
