import { describe, expect, test } from 'bun:test'
import { companionWasmReady } from '../../nook-web-shared/src/extension/companion-ready'
import type { AuthenticationWorkflowRoutingResponse } from '../src/background/service-worker/authentication-workflow-routing'
import { type WebsiteLoginMatchAvailability } from '../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  PilotVaultConnectionKind,
  WidgetVaultPresentationKind,
  WidgetVaultPresentationProjection,
  type PilotVaultConnection,
  type WidgetVaultPresentation,
  type WidgetVaultPresentationProjectionArgs,
} from '../src/content/autofill/widget-presentation-state'
import { authenticationWidgetWorkflowKey } from '../src/content/autofill/widget-workflow-key'
import type {
  AuthenticationPageObservationFacts,
  AuthenticationWorkflowSnapshot,
} from '../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

await companionWasmReady

const connectedVault: PilotVaultConnection = {
  kind: PilotVaultConnectionKind.Connected,
  vaultName: 'Mock auth vault',
}

type WidgetRoutingPresentationCase = {
  response: AuthenticationWorkflowRoutingResponse
  expected: WidgetVaultPresentation
}

describe('authentication widget vault presentation', () => {
  test('keeps an unconnected vault distinct from runtime availability', () => {
    const loginMatches: WebsiteLoginMatchAvailability = {
      kind: 'ready',
      count: 1,
    }
    const projectionRequest: WidgetVaultPresentationProjectionArgs = {
      vaultConnection: { kind: PilotVaultConnectionKind.NotConnected },
      loginMatches,
    }
    const projection = new WidgetVaultPresentationProjection(projectionRequest)

    expect(projection.state()).toEqual({
      kind: WidgetVaultPresentationKind.NotConnected,
    })
  })

  test('projects a locked session separately from an unavailable session', () => {
    const lockedMatches: WebsiteLoginMatchAvailability = {
      kind: 'locked',
    }
    const unavailableMatches: WebsiteLoginMatchAvailability = {
      kind: 'unavailable',
    }

    const lockedRequest: WidgetVaultPresentationProjectionArgs = {
      vaultConnection: connectedVault,
      loginMatches: lockedMatches,
    }
    expect(
      new WidgetVaultPresentationProjection(lockedRequest).state(),
    ).toEqual({
      kind: WidgetVaultPresentationKind.Locked,
      vaultName: connectedVault.vaultName,
    })
    const unavailableRequest: WidgetVaultPresentationProjectionArgs = {
      vaultConnection: connectedVault,
      loginMatches: unavailableMatches,
    }
    expect(
      new WidgetVaultPresentationProjection(unavailableRequest).state(),
    ).toEqual({
      kind: WidgetVaultPresentationKind.Unavailable,
      vaultName: connectedVault.vaultName,
    })
  })

  test('distinguishes no matching credentials from an available credential', () => {
    const noMatch: WebsiteLoginMatchAvailability = {
      kind: 'ready',
      count: 0,
    }
    const available: WebsiteLoginMatchAvailability = {
      kind: 'ready',
      count: 1,
    }

    const noMatchRequest: WidgetVaultPresentationProjectionArgs = {
      vaultConnection: connectedVault,
      loginMatches: noMatch,
    }
    expect(
      new WidgetVaultPresentationProjection(noMatchRequest).state(),
    ).toEqual({
      kind: WidgetVaultPresentationKind.NoMatchingCredential,
      vaultName: connectedVault.vaultName,
    })
    const availableRequest: WidgetVaultPresentationProjectionArgs = {
      vaultConnection: connectedVault,
      loginMatches: available,
    }
    expect(
      new WidgetVaultPresentationProjection(availableRequest).state(),
    ).toEqual({
      kind: WidgetVaultPresentationKind.CredentialAvailable,
      vaultName: connectedVault.vaultName,
    })
  })

  test('maps typed routing outcomes to locked and no-match widget states', () => {
    const routingCases: ReadonlyArray<WidgetRoutingPresentationCase> = [
      {
        response: {
          workflow: { ok: true },
          loginMatches: { kind: 'locked' },
          selectedFacts: { state: 'notApplicable' },
        },
        expected: {
          kind: WidgetVaultPresentationKind.Locked,
          vaultName: connectedVault.vaultName,
        },
      },
      {
        response: {
          workflow: { ok: true },
          loginMatches: { kind: 'ready', count: 0 },
          selectedFacts: { state: 'notApplicable' },
        },
        expected: {
          kind: WidgetVaultPresentationKind.NoMatchingCredential,
          vaultName: connectedVault.vaultName,
        },
      },
    ]

    for (const routingCase of routingCases) {
      const projectionRequest: WidgetVaultPresentationProjectionArgs = {
        vaultConnection: connectedVault,
        loginMatches: routingCase.response.loginMatches,
      }
      const presentation = new WidgetVaultPresentationProjection(
        projectionRequest,
      ).state()

      expect(presentation).toEqual(routingCase.expected)
      expect(presentation.kind).not.toBe(
        WidgetVaultPresentationKind.Unavailable,
      )
      expect(presentation.kind).not.toBe(WidgetVaultPresentationKind.Connected)
    }
  })

  test('replaces the widget when Rust-selected facts change', () => {
    const snapshot: AuthenticationWorkflowSnapshot = {
      kind: 0,
      stage: 0,
      action: 4,
      currentStep: 1,
      totalSteps: 1,
      observationIndex: 0,
      approvalRequirement: 'explicit-user-approval',
      savedLoginCapability: 'fill-saved-login',
    }
    const loginMatches: WebsiteLoginMatchAvailability = {
      kind: 'ready',
      count: 1,
    }
    const vaultPresentation = new WidgetVaultPresentationProjection({
      vaultConnection: connectedVault,
      loginMatches,
    }).state()
    const factsFor = (
      currentPasswordFieldCount: number,
    ): AuthenticationPageObservationFacts => ({
      fields: {
        usernameFieldCount: 1,
        currentPasswordFieldCount,
        newPasswordFieldCount: 0,
        genericPasswordFieldCount: 0,
        oneTimeCodeFieldCount: 0,
        actionablePasswordFieldCount: currentPasswordFieldCount,
        readonlyPasswordFieldCount: 0,
      },
      ceremony: {
        oneTimeCodeProgression: 'advance-control-required',
        oneTimeCodeHandlerSignal: '',
        authenticationContext: {
          authenticationUsername: 'explicit',
          sourceOrigin: 'https://login.example.test',
          formIdentity: 'login',
          destinationIdentity: '/login',
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
    })
    const initialKey = authenticationWidgetWorkflowKey({
      snapshot,
      loginMatches,
      vaultPresentation,
      facts: factsFor(0),
    })
    const refreshedKey = authenticationWidgetWorkflowKey({
      snapshot,
      loginMatches,
      vaultPresentation,
      facts: factsFor(1),
    })

    expect(refreshedKey).not.toBe(initialKey)
  })
})
