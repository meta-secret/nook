import { expect, test } from 'bun:test'
import { EnrollmentRevokeOutcome } from '../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import {
  beginActiveEnrollmentCeremony,
  cancelActiveEnrollmentCeremony,
  type EnrollmentFlowHost,
} from '../src/content/enrollment-flow'

test('failed cancellation retains the same stage identity for Cancel-only retry', async () => {
  const stageIds: string[] = []
  const outcomes = [
    EnrollmentRevokeOutcome.Committing,
    EnrollmentRevokeOutcome.Revoked,
  ]
  const host = {
    sendAuthenticatorEnrollmentDismissRuntimeMessage: async (message) => {
      stageIds.push(message.payload.stageId)
      return outcomes.shift() || EnrollmentRevokeOutcome.Committing
    },
  } as EnrollmentFlowHost
  const uri = { value: 'otpauth://pending-secret' }
  beginActiveEnrollmentCeremony({
    host,
    stageId: 'retained-stage',
    sensitiveMaterial: {
      uri,
      payload: { otpauthUri: uri.value },
      candidate: { sourceLabel: 'QR', otpauthUri: uri.value },
    },
  })

  expect(await cancelActiveEnrollmentCeremony()).toBe(false)
  expect(await cancelActiveEnrollmentCeremony()).toBe(true)
  expect(stageIds).toEqual(['retained-stage', 'retained-stage'])
})
