import { afterAll, describe, expect, test } from 'bun:test'
import { evaluateCompanionAuthenticationPolicies } from '../../nook-web-shared/src/extension/companion-authentication-policy-evaluation'
import {
  CompanionWasmSessionMessageType,
  type CompanionWasmRuntimeMessage,
} from '../../nook-web-shared/src/extension/companion-wasm-runtime-messages'
import {
  CompanionWasmRuntimeDeliveryKind,
  type CompanionWasmRuntimeDelivery,
} from '../../nook-web-shared/src/extension/companion-wasm-runtime-transport'
import type {
  AuthenticationPageObservationFacts,
  AuthenticationDisplayProgress,
} from '../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

const originalChromeDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  'chrome',
)
const originalLocationDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  'location',
)

type PolicyRuntimeResult = {
  transportability: boolean[]
  advanceControls: boolean[]
  passkeyCandidates: boolean[]
  pageFactsPriorities: number[]
  pageFactsAdmissibility: boolean[]
  activityProgress: AuthenticationDisplayProgress[]
  implicitSubmissions: boolean[]
}

type PolicyRuntimeCallback = (response: {
  ok: true
  result: PolicyRuntimeResult
}) => void

enum TestGlobalPropertyName {
  Chrome = 'chrome',
  Location = 'location',
}

function authenticationFacts(
  destinationIdentity: string,
): AuthenticationPageObservationFacts {
  return {
    fields: {
      usernameFieldCount: 1,
      currentPasswordFieldCount: 0,
      newPasswordFieldCount: 0,
      genericPasswordFieldCount: 0,
      oneTimeCodeFieldCount: 0,
      actionablePasswordFieldCount: 0,
      readonlyPasswordFieldCount: 0,
    },
    ceremony: {
      oneTimeCodeProgression: 'advance-control-required',
      oneTimeCodeHandlerSignal: '',
      authenticationContext: {
        authenticationUsername: 'explicit',
        sourceOrigin: 'https://example.test',
        formIdentity: 'login',
        destinationIdentity,
      },
      manualCheckpoint: 'absent',
      advanceControl: 'absent',
    },
    authenticator: {
      authenticatorSetup: 'absent',
      backupCodesCopy: '',
      passkeyControl: 'absent',
      passkeyAccountAvailability: 'unavailable',
      matchingPasskeyAccountCount: 0,
      detailedPasskeyControl: { kind: 'absent' },
    },
    credentialSubmission: { kind: 'absent' },
    detailedAdvanceControl: { kind: 'absent' },
  }
}

function restoreGlobalProperty(
  name: TestGlobalPropertyName,
  descriptor: PropertyDescriptor | false,
): void {
  if (descriptor) {
    Object.defineProperty(globalThis, name, descriptor)
  } else {
    Reflect.deleteProperty(globalThis, name)
  }
}

afterAll(() => {
  restoreGlobalProperty(
    TestGlobalPropertyName.Chrome,
    originalChromeDescriptor || false,
  )
  restoreGlobalProperty(
    TestGlobalPropertyName.Location,
    originalLocationDescriptor || false,
  )
})

describe('authentication policy transport batching', () => {
  test('isolates an oversized fact before runtime delivery and preserves its sibling', async () => {
    const deliveredPageFactsCounts: number[] = []
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: { origin: 'https://example.test' },
    })
    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: {
        runtime: {
          lastError: false,
          sendMessage(
            message: CompanionWasmRuntimeMessage,
            callback: PolicyRuntimeCallback,
          ): void {
            if (
              message.type !==
              CompanionWasmSessionMessageType.EvaluateAuthenticationPolicies
            ) {
              throw new Error('expected an authentication policy message')
            }
            const payload = message.payload
            deliveredPageFactsCounts.push(payload.pageFacts.length)
            callback({
              ok: true,
              result: {
                transportability: payload.transportability.map(() => true),
                advanceControls: payload.advanceControls.map(() => true),
                passkeyCandidates: payload.passkeyCandidates.map(() => true),
                pageFactsPriorities: payload.pageFacts.map(() => 7),
                pageFactsAdmissibility: payload.pageFacts.map(() => true),
                activityProgress: [],
                implicitSubmissions: payload.implicitSubmissions.map(
                  () => true,
                ),
              },
            })
          },
        },
      },
    })
    const oversized = authenticationFacts(
      `https://example.test/login?state=${'a'.repeat(140_000)}`,
    )
    const valid = authenticationFacts('https://example.test/login')
    const delivery: CompanionWasmRuntimeDelivery =
      await evaluateCompanionAuthenticationPolicies(globalThis, {
        transportability: [],
        advanceControls: [],
        passkeyCandidates: [],
        pageFacts: [oversized, valid],
        implicitSubmissions: [],
      })

    expect(delivery.kind).toBe(CompanionWasmRuntimeDeliveryKind.Delivered)
    if (
      delivery.kind !== CompanionWasmRuntimeDeliveryKind.Delivered ||
      typeof delivery.response !== 'object' ||
      !('pageFactsPriorities' in delivery.response) ||
      !('pageFactsAdmissibility' in delivery.response)
    ) {
      throw new Error('expected a typed authentication policy response')
    }
    expect(deliveredPageFactsCounts).toEqual([1])
    expect(delivery.response.pageFactsPriorities).toEqual([0, 7])
    expect(delivery.response.pageFactsAdmissibility).toEqual([false, true])
  })
})
