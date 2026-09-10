import { beforeEach, describe, expect, test, vi } from 'vitest'

const routeDependencies = vi.hoisted(() => ({
  consumeGenesisRequest: vi.fn(() => 'genesis-request'),
  consumeParticipantResponse: vi.fn(() => 'participant-response'),
  consumeOnboarding: vi.fn(() => 'onboarding-package'),
  extensionConnectPath: vi.fn(() => true),
  extensionConnectIntent: vi.fn((supportsExtension: boolean) => ({
    kind: supportsExtension ? 'requested' : 'absent',
  })),
  legalRoute: vi.fn(() => ({ kind: 'application' })),
}))

vi.mock('$lib/app/route-state', () => ({
  initialExtensionConnectIntent: routeDependencies.extensionConnectIntent,
  initialLegalRoute: routeDependencies.legalRoute,
}))

vi.mock('$lib/enrollment/sentinel-genesis-link', () => ({
  sentinelGenesisBrowser: {
    consumeSentinelGenesisRequestFromLocation:
      routeDependencies.consumeGenesisRequest,
    consumeSentinelGenesisParticipantResponseFromLocation:
      routeDependencies.consumeParticipantResponse,
  },
}))

vi.mock('$lib/enrollment/sentinel-onboarding-link', () => ({
  sentinelOnboardingBrowser: {
    consumeSentinelOnboardingFromLocation: routeDependencies.consumeOnboarding,
  },
}))

vi.mock('$lib/extension/connect', () => ({
  extensionConnectionBrowser: {
    isExtensionConnectPath: routeDependencies.extensionConnectPath,
  },
}))

import { InitialApplicationRoute } from '$lib/app/initial-application-route'

beforeEach(() => {
  window.history.replaceState({}, '', '/extension-connect')
  vi.clearAllMocks()
})

describe('initial application route', () => {
  test.each([
    ['/logs', true, false],
    ['/app-logs', false, true],
  ])('projects legal and log routes from %s', (path, logsPage, appLogsPage) => {
    window.history.replaceState({}, '', path)
    routeDependencies.legalRoute.mockReturnValueOnce({ kind: 'legal' })

    const route = new InitialApplicationRoute({
      isSimpleApplication: true,
      supportsExtension: false,
    }).read()

    expect(route).toMatchObject({
      legalPage: { kind: 'legal' },
      logsPage,
      appLogsPage,
    })
  })

  test('selects extension startup and consumes Sentinel handoff payloads', () => {
    const route = new InitialApplicationRoute({
      isSimpleApplication: false,
      supportsExtension: true,
    }).read()

    expect(route).toMatchObject({
      extensionConnectRoute: true,
      sentinelInvitationRequest: 'genesis-request',
      sentinelParticipantResponse: 'participant-response',
      sentinelOnboardingPackage: 'onboarding-package',
    })
    expect(routeDependencies.extensionConnectIntent).toHaveBeenCalledWith(true)
    expect(routeDependencies.consumeGenesisRequest).toHaveBeenCalledOnce()
    expect(routeDependencies.consumeParticipantResponse).toHaveBeenCalledOnce()
    expect(routeDependencies.consumeOnboarding).toHaveBeenCalledOnce()
  })

  test('keeps extension and Sentinel startup flows unavailable in the simple app', () => {
    const route = new InitialApplicationRoute({
      isSimpleApplication: true,
      supportsExtension: false,
    }).read()

    expect(route).toMatchObject({
      extensionConnectRoute: false,
      sentinelInvitationRequest: '',
      sentinelParticipantResponse: '',
      sentinelOnboardingPackage: '',
    })
    expect(routeDependencies.extensionConnectIntent).toHaveBeenCalledWith(false)
    expect(routeDependencies.consumeGenesisRequest).not.toHaveBeenCalled()
    expect(routeDependencies.consumeParticipantResponse).not.toHaveBeenCalled()
    expect(routeDependencies.consumeOnboarding).not.toHaveBeenCalled()
  })
})
