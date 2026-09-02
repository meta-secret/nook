import {
  AuthenticationOutcomeVerdict,
  NookWebsiteLoginSaveDecision,
} from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import {
  AuthenticationWorkflowAction,
  AuthenticationWorkflowKind,
  AuthenticationWorkflowStage,
} from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm'
import type { AuthenticationApprovalRequirement } from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm'
import type {
  WebsiteLoginSaveActionResponse,
  WebsiteLoginSaveOfferResponse,
  WebsiteLoginSavePendingAvailable,
} from '../../../nook-web-extension/src/lib/login-save-messages'
import {
  WebsiteAuthenticatorOptionsMessageType,
  WebsiteAuthenticatorResponseStatus,
} from '../../../nook-web-extension/src/lib/login-fill-messages'
import { WebsiteAuthenticatorBackupAttachMessageType } from '../../../nook-web-extension/src/lib/enrollment-messages'
import { GeneratePasswordRequestType } from '../../../nook-web-shared/src/extension/runtime-messages'

type DemoLoginSaveResponses = {
  offerAvailable: WebsiteLoginSaveOfferResponse['kind']
  pendingAvailable: WebsiteLoginSavePendingAvailable['state']
  pendingUnavailable: WebsiteLoginSavePendingAvailable['state']
  completed: WebsiteLoginSaveActionResponse['kind']
}

export const demoLoginSaveCreateDecision = NookWebsiteLoginSaveDecision.Create
export const demoSufficientAuthenticationOutcome =
  AuthenticationOutcomeVerdict.Sufficient
export const demoInsufficientAuthenticationOutcome =
  AuthenticationOutcomeVerdict.Insufficient
const demoExplicitUserApproval =
  'explicit-user-approval' satisfies AuthenticationApprovalRequirement
export const demoDomainEnumArgs = {
  generatePasswordMessageType:
    GeneratePasswordRequestType.NookWebsiteGeneratePassword,
  loginSaveCreateDecision: demoLoginSaveCreateDecision,
  sufficientAuthenticationOutcome: demoSufficientAuthenticationOutcome,
  insufficientAuthenticationOutcome: demoInsufficientAuthenticationOutcome,
  authenticationWorkflow: {
    loginKind: AuthenticationWorkflowKind.Login,
    signupKind: AuthenticationWorkflowKind.Signup,
    totpChallengeKind: AuthenticationWorkflowKind.TotpChallenge,
    totpEnrollmentKind: AuthenticationWorkflowKind.TotpEnrollment,
    credentialsStage: AuthenticationWorkflowStage.Credentials,
    secondFactorStage: AuthenticationWorkflowStage.SecondFactor,
    recoveryStage: AuthenticationWorkflowStage.Recovery,
    continueAction: AuthenticationWorkflowAction.ContinueWithNook,
    generatePasswordAction: AuthenticationWorkflowAction.GeneratePassword,
    fillTotpAction: AuthenticationWorkflowAction.FillTotp,
    createPasskeyAction: AuthenticationWorkflowAction.CreatePasskey,
    saveBackupCodesAction: AuthenticationWorkflowAction.SaveBackupCodes,
    explicitUserApproval: demoExplicitUserApproval,
  },
  authenticatorProtocol: {
    optionsMessageType:
      WebsiteAuthenticatorOptionsMessageType.NookWebsiteAuthenticatorOptions,
    backupAttachMessageType:
      WebsiteAuthenticatorBackupAttachMessageType.NookWebsiteAuthenticatorBackupAttach,
    readyStatus: WebsiteAuthenticatorResponseStatus.Ready,
  },
  loginSaveResponses: {
    offerAvailable: 'offer-available',
    pendingAvailable: 'available',
    pendingUnavailable: 'unavailable',
    completed: 'completed',
  } satisfies DemoLoginSaveResponses,
}

export type ChromeMessage = { message: string }

export type DemoChromeStubArgs = {
  localizedMessages: Record<string, ChromeMessage>
  loginSaveCreateDecision: NookWebsiteLoginSaveDecision
  sufficientAuthenticationOutcome: AuthenticationOutcomeVerdict
  insufficientAuthenticationOutcome: AuthenticationOutcomeVerdict
  generatePasswordMessageType: GeneratePasswordRequestType
  authenticationWorkflow: {
    loginKind: AuthenticationWorkflowKind.Login
    signupKind: AuthenticationWorkflowKind.Signup
    totpChallengeKind: AuthenticationWorkflowKind.TotpChallenge
    totpEnrollmentKind: AuthenticationWorkflowKind.TotpEnrollment
    credentialsStage: AuthenticationWorkflowStage.Credentials
    secondFactorStage: AuthenticationWorkflowStage.SecondFactor
    recoveryStage: AuthenticationWorkflowStage.Recovery
    continueAction: AuthenticationWorkflowAction.ContinueWithNook
    generatePasswordAction: AuthenticationWorkflowAction.GeneratePassword
    fillTotpAction: AuthenticationWorkflowAction.FillTotp
    createPasskeyAction: AuthenticationWorkflowAction.CreatePasskey
    saveBackupCodesAction: AuthenticationWorkflowAction.SaveBackupCodes
  }
  authenticatorProtocol: {
    optionsMessageType: WebsiteAuthenticatorOptionsMessageType
    backupAttachMessageType: WebsiteAuthenticatorBackupAttachMessageType
    readyStatus: WebsiteAuthenticatorResponseStatus
  }
  loginSaveResponses: DemoLoginSaveResponses
  /** Static replies keyed by runtime message type. */
  responsesByType?: Record<string, unknown>
  /** Stateful login-pilot replies for Continue → unlock → chooser. */
  loginPilotFlow?: boolean
  /** Disconnected login reply that records the trusted companion launch. */
  unavailableLoginPilotFlow?: boolean
  /** Stateful post-submit save-offer replies for Pilot login capture. */
  savePilotFlow?: boolean
  /** Signup generate-password Pilot replies. */
  generatePilotFlow?: boolean
  /** Pilot-gated Create/Use passkey proposal replies. */
  passkeyPilotFlow?: boolean
  /** 2FA enrollment ceremony replies with evidence-gated confirm. */
  enrollPilotFlow?: boolean
  /** Extension-owned 2FA picker selection returned to the page HUD. */
  authenticatorPickerFlow?: boolean
  /** Record runtime message types so demos can assert cross-domain sequencing. */
  recordRuntimeMessageTypes?: boolean
  barcodeRawValue?: string
}

/** Self-contained init/evaluate helper shared by Pilot UI demos. */
export function installDemoChromeStub(args: DemoChromeStubArgs) {
  type RuntimeMessage = {
    type: string
    payload?: { secretId?: string; observations?: unknown[] }
  }
  type RuntimeCallback = (response?: unknown) => void
  type AuthenticationSnapshotResponse = {
    snapshot?: { observationIndex?: number }
  }
  type AuthenticationSnapshotResponseAdapterRequest = {
    message: RuntimeMessage
    response: unknown
  }
  type StagedSaveOffer = {
    offerId: string
    decision: NookWebsiteLoginSaveDecision.Create
    vaultStoreId: string
    vaultName: string
  }

  const {
    localizedMessages,
    loginSaveCreateDecision,
    sufficientAuthenticationOutcome,
    insufficientAuthenticationOutcome,
    generatePasswordMessageType,
    authenticationWorkflow,
    authenticatorProtocol,
    loginSaveResponses,
    responsesByType = {},
    loginPilotFlow = false,
    unavailableLoginPilotFlow = false,
    savePilotFlow = false,
    generatePilotFlow = false,
    passkeyPilotFlow = false,
    enrollPilotFlow = false,
    authenticatorPickerFlow = false,
    recordRuntimeMessageTypes = false,
    barcodeRawValue,
  } = args
  let loginOptionsCalls = 0
  enum StagedOfferKind {
    Empty = 'empty',
    Present = 'present',
  }

  let stagedOffer:
    | { kind: StagedOfferKind.Empty }
    | { kind: StagedOfferKind.Present; offer: StagedSaveOffer } = {
    kind: StagedOfferKind.Empty,
  }
  let enrollStaged = false
  const demoExtensionSetup = {
    status: 'ready' as const,
    deviceLabel: 'Demo browser',
    pairedVaults: ['Demo vault'],
    selectedVaultStoreId: 'demo-vault',
    selectedVaultName: 'Demo vault',
    syncProviderCount: 1,
    eventCount: 3,
    eventLogHeads: ['demo-head'],
    lastLocalSyncAt: '2026-07-20T00:00:00.000Z',
  }
  const runtimeListeners: Array<
    (
      message: unknown,
      sender: { id: string },
      sendResponse: RuntimeCallback,
    ) => boolean
  > = []

  const responseFor = (message: RuntimeMessage): unknown => {
    if (message.type && message.type in responsesByType) {
      return responsesByType[message.type]
    }
    if (message.type === 'nook:extension-pairing-state-query') {
      if (unavailableLoginPilotFlow) return { ok: false }
      return { ok: true, setup: demoExtensionSetup }
    }
    if (
      authenticatorPickerFlow &&
      message.type === 'nook:website-authenticator-picker-open'
    ) {
      window.setTimeout(() => {
        runtimeListeners.forEach((listener) =>
          listener(
            {
              type: 'nook:website-authenticator-selected',
              payload: {
                origin: location.origin,
                requestId: 'demo-authenticator-picker',
                account: {
                  vaultStoreId: 'demo-vault',
                  secretId: 'demo-totp-1',
                  authorizationGeneration: 'demo-authorization-epoch',
                },
              },
            },
            { id: 'demo-extension' },
            () => {},
          ),
        )
      }, 1_200)
      return {
        ok: true,
        status: 'ready',
        requestId: 'demo-authenticator-picker',
        expiresAt: Date.now() + 5 * 60 * 1_000,
      }
    }
    if (passkeyPilotFlow) {
      switch (message.type) {
        case 'nook:authentication-workflow-snapshot':
          return {
            ok: true,
            snapshot: {
              kind: authenticationWorkflow.loginKind,
              stage: authenticationWorkflow.credentialsStage,
              action: authenticationWorkflow.createPasskeyAction,
              currentStep: 1,
              totalSteps: 3,
              approvalRequirement: authenticationWorkflow.explicitUserApproval,
              savedLoginCapability: 'unavailable',
              observationIndex: 0,
            },
          }
        default:
          return { ok: true }
      }
    }
    if (enrollPilotFlow) {
      switch (message.type) {
        case 'nook:extension-pairing-state-query':
          return {
            ok: true,
            setup: {
              status: 'ready',
              deviceLabel: 'Demo browser',
              pairedVaults: ['Demo vault'],
              selectedVaultStoreId: 'demo-vault',
              selectedVaultName: 'Demo vault',
              syncProviderCount: 1,
              eventCount: 3,
              eventLogHeads: ['demo-head'],
              lastLocalSyncAt: '2026-07-20T00:00:00.000Z',
            },
          }
        case 'nook:website-authenticator-enroll-preview':
          return {
            ok: true,
            status: 'ready',
            vaultStoreId: 'demo-vault',
            vaultName: 'Demo vault',
            preview: {
              issuer: 'Demo Service',
              account: 'demo.user@example.test',
              websiteUrl: 'https://demo.example.test',
              algorithm: 'SHA1',
              digits: 6,
              period: 30,
            },
          }
        case 'nook:website-authenticator-enroll-stage':
          enrollStaged = true
          return { ok: true, stageId: 'demo-enroll-stage' }
        case 'nook:website-authenticator-enroll-code':
          return {
            ok: true,
            code: '482913',
            expiresAt: Date.now() + 30_000,
          }
        case 'nook:authentication-outcome-classify': {
          const observation = (
            message as {
              payload?: {
                observation?: {
                  successMarkerPresent?: boolean
                  errorMarkerPresent?: boolean
                }
              }
            }
          ).payload?.observation
          if (observation?.errorMarkerPresent) {
            return {
              ok: true,
              verdict: {
                verdict: insufficientAuthenticationOutcome,
                allowsCredentialCommit: false,
              },
            }
          }
          if (observation?.successMarkerPresent && enrollStaged) {
            return {
              ok: true,
              verdict: {
                verdict: sufficientAuthenticationOutcome,
                allowsCredentialCommit: true,
              },
            }
          }
          return {
            ok: true,
            verdict: {
              verdict: insufficientAuthenticationOutcome,
              allowsCredentialCommit: false,
            },
          }
        }
        case 'nook:website-authenticator-enroll-confirm':
          enrollStaged = false
          return { ok: true, secretId: 'demo-authenticator-1' }
        case authenticatorProtocol.optionsMessageType:
          return {
            ok: true,
            status: authenticatorProtocol.readyStatus,
            accounts: [
              {
                vaultStoreId: 'demo-vault',
                vaultName: 'Demo vault',
                secretId: 'demo-authenticator-1',
                issuer: 'Demo Service',
                account: 'demo.user@example.test',
              },
            ],
          }
        case authenticatorProtocol.backupAttachMessageType:
          return { ok: true }
        case 'nook:website-authenticator-enroll-dismiss':
          enrollStaged = false
          return { ok: true }
        default:
          return { ok: true }
      }
    }
    if (generatePilotFlow) {
      switch (message.type) {
        case 'nook:authentication-workflow-snapshot':
          return {
            ok: true,
            snapshot: {
              kind: authenticationWorkflow.signupKind,
              stage: authenticationWorkflow.credentialsStage,
              action: authenticationWorkflow.generatePasswordAction,
              currentStep: 2,
              totalSteps: 5,
              approvalRequirement: authenticationWorkflow.explicitUserApproval,
              savedLoginCapability: 'unavailable',
              observationIndex: 0,
            },
          }
        case generatePasswordMessageType:
          return {
            ok: true,
            password: 'DemoGeneratedPassword!234567',
          }
        default:
          return { ok: true }
      }
    }
    if (savePilotFlow) {
      switch (message.type) {
        case 'nook:authentication-workflow-snapshot':
          return {
            ok: true,
            snapshot: {
              kind: authenticationWorkflow.loginKind,
              stage: authenticationWorkflow.credentialsStage,
              action: authenticationWorkflow.continueAction,
              currentStep: 1,
              totalSteps: 3,
              approvalRequirement: authenticationWorkflow.explicitUserApproval,
              savedLoginCapability: 'fill-saved-login',
              observationIndex: 0,
            },
          }
        case 'nook:authentication-outcome-classify': {
          const observation = (
            message as {
              payload?: {
                observation?: {
                  successMarkerPresent?: boolean
                  errorMarkerPresent?: boolean
                }
              }
            }
          ).payload?.observation
          if (observation?.errorMarkerPresent) {
            return {
              ok: true,
              verdict: {
                verdict: insufficientAuthenticationOutcome,
                allowsCredentialCommit: false,
              },
            }
          }
          if (observation?.successMarkerPresent) {
            return {
              ok: true,
              verdict: {
                verdict: sufficientAuthenticationOutcome,
                allowsCredentialCommit: true,
              },
            }
          }
          return {
            ok: true,
            verdict: {
              verdict: insufficientAuthenticationOutcome,
              allowsCredentialCommit: false,
            },
          }
        }
        case 'nook:website-login-save-offer':
          stagedOffer = {
            kind: StagedOfferKind.Present,
            offer: {
              offerId: 'demo-save-offer',
              decision: loginSaveCreateDecision,
              vaultStoreId: 'demo-vault',
              vaultName: 'Demo vault',
            },
          }
          return {
            kind: loginSaveResponses.offerAvailable,
            offer: stagedOffer.offer,
          }
        case 'nook:website-login-save-pending':
          return stagedOffer.kind === StagedOfferKind.Present
            ? {
                ok: true,
                state: loginSaveResponses.pendingAvailable,
                offer: stagedOffer.offer,
              }
            : {
                ok: true,
                state: loginSaveResponses.pendingUnavailable,
              }
        case 'nook:website-login-save-commit':
          stagedOffer = { kind: StagedOfferKind.Empty }
          return { kind: loginSaveResponses.completed }
        case 'nook:website-login-save-dismiss':
          stagedOffer = { kind: StagedOfferKind.Empty }
          return { kind: loginSaveResponses.completed }
        default:
          return { ok: true }
      }
    }
    if (unavailableLoginPilotFlow) {
      switch (message.type) {
        case 'nook:authentication-workflow-snapshot':
          return {
            ok: true,
            snapshot: {
              kind: authenticationWorkflow.loginKind,
              stage: authenticationWorkflow.credentialsStage,
              action: authenticationWorkflow.continueAction,
              currentStep: 1,
              totalSteps: 3,
              approvalRequirement: authenticationWorkflow.explicitUserApproval,
              savedLoginCapability: 'fill-saved-login',
              observationIndex: 0,
            },
          }
        case 'nook:website-login-options': {
          const demoWindow = window as typeof window & {
            __nookDemoCompanionLauncherUrls?: string[]
          }
          demoWindow.__nookDemoCompanionLauncherUrls = ((v) => (v ? v : []))(
            demoWindow.__nookDemoCompanionLauncherUrls,
          )
          demoWindow.__nookDemoCompanionLauncherUrls.push(
            'chrome-extension://demo-extension/popup/index.html?intent=pair',
          )
          return { ok: true, status: 'unavailable' }
        }
        default:
          return { ok: true }
      }
    }
    if (!loginPilotFlow) return { ok: true }

    switch (message.type) {
      case 'nook:authentication-workflow-snapshot':
        return {
          ok: true,
          snapshot: {
            kind: authenticationWorkflow.loginKind,
            stage: authenticationWorkflow.credentialsStage,
            action: authenticationWorkflow.continueAction,
            currentStep: 1,
            totalSteps: 3,
            approvalRequirement: authenticationWorkflow.explicitUserApproval,
            savedLoginCapability: 'fill-saved-login',
            observationIndex: 0,
          },
        }
      case 'nook:website-login-options':
        loginOptionsCalls += 1
        if (loginOptionsCalls === 1) {
          return { ok: true, status: 'locked' }
        }
        return {
          ok: true,
          status: 'ready',
          authorizationGeneration: 'demo-authorization-epoch',
          accounts: [
            {
              vaultStoreId: 'demo-vault',
              vaultName: 'Demo vault',
              secretId: 'demo-login-1',
              username: 'pilot@example.test',
              websiteUrl: location.origin,
              websiteHost: location.hostname,
            },
            {
              vaultStoreId: 'demo-vault',
              vaultName: 'Demo vault',
              secretId: 'demo-login-2',
              username: 'copilot@example.test',
              websiteUrl: location.origin,
              websiteHost: location.hostname,
            },
          ],
        }
      case 'nook:website-login-picker-open':
        window.setTimeout(() => {
          runtimeListeners.forEach((listener) =>
            listener(
              {
                type: 'nook:website-login-selected',
                payload: {
                  origin: location.origin,
                  requestId: 'demo-login-picker',
                  account: {
                    vaultStoreId: 'demo-vault',
                    secretId: 'demo-login-1',
                    authorizationGeneration: 'demo-authorization-epoch',
                  },
                },
              },
              { id: 'demo-extension' },
              () => {},
            ),
          )
        }, 1_200)
        return {
          ok: true,
          status: 'ready',
          requestId: 'demo-login-picker',
          expiresAt: Date.now() + 5 * 60 * 1_000,
        }
      case 'nook:website-login-fill':
        return {
          ok: true,
          username:
            message.payload?.secretId === 'demo-login-2'
              ? 'copilot@example.test'
              : 'pilot@example.test',
          password: 'demo-password-never-recorded',
        }
      default:
        return { ok: true }
    }
  }

  const adaptAuthenticationSnapshotResponse = ({
    message,
    response,
  }: AuthenticationSnapshotResponseAdapterRequest): unknown => {
    if (
      message.type !== 'nook:authentication-workflow-snapshot' ||
      typeof response !== 'object' ||
      !response
    ) {
      return response
    }
    const { observationIndex } = ((...[v = { observationIndex: -1 }]) => v)(
      (response as AuthenticationSnapshotResponse).snapshot,
    )
    const observations = ((v) => (v ? v : []))(message.payload?.observations)
    if (
      typeof observationIndex !== 'number' ||
      !Number.isInteger(observationIndex) ||
      observationIndex < 0 ||
      observationIndex >= observations.length
    ) {
      return {
        workflow: response,
        loginMatches: { kind: 'unavailable' },
      }
    }
    const observedFacts = observations[observationIndex]
    const selectedFacts =
      passkeyPilotFlow && observedFacts
        ? {
            ...observedFacts,
            authenticator: {
              ...observedFacts.authenticator,
              passkeyAccountAvailability: 'ready',
            },
          }
        : observedFacts
    if (!selectedFacts) {
      return {
        workflow: response,
        loginMatches: { kind: 'unavailable' },
      }
    }
    const loginMatches = loginPilotFlow
      ? { kind: 'locked' as const }
      : savePilotFlow
        ? { kind: 'ready' as const, count: 1 }
        : { kind: 'unavailable' as const }
    return { workflow: response, loginMatches, selectedFacts }
  }

  if (barcodeRawValue) {
    class FakeBarcodeDetector {
      async detect() {
        return [{ rawValue: barcodeRawValue, format: 'qr_code' }]
      }
    }
    Object.defineProperty(globalThis, 'BarcodeDetector', {
      configurable: true,
      value: FakeBarcodeDetector,
    })
  }

  const chromeStub = {
    i18n: {
      getMessage(key: string, substitution?: string) {
        const message = ((v) => (v ? v : ''))(localizedMessages[key]?.message)
        return substitution ? message.replaceAll('$1', substitution) : message
      },
    },
    runtime: {
      id: 'demo-extension',
      onMessage: {
        addListener(
          listener: (message: unknown, sender: { id: string }) => boolean,
        ) {
          runtimeListeners.push(listener)
        },
      },
      getURL(resource: string) {
        return resource === 'icons/nook.png' ? '/favicon.png' : resource
      },
      sendMessage(message: RuntimeMessage, callback?: RuntimeCallback) {
        if (recordRuntimeMessageTypes && message.type) {
          const demoWindow = globalThis as unknown as {
            __nookDemoRuntimeMessageTypes?: string[]
          }
          demoWindow.__nookDemoRuntimeMessageTypes = ((v) => (v ? v : []))(
            demoWindow.__nookDemoRuntimeMessageTypes,
          )
          demoWindow.__nookDemoRuntimeMessageTypes.push(message.type)
        }
        const responseRequest: AuthenticationSnapshotResponseAdapterRequest = {
          message,
          response: responseFor(message),
        }
        const response = adaptAuthenticationSnapshotResponse(responseRequest)
        if (callback) queueMicrotask(() => callback(response))
      },
    },
    storage: {
      local: {
        get(
          _keys: string | string[] | Record<string, unknown>,
          callback: (items: Record<string, unknown>) => void,
        ) {
          queueMicrotask(() =>
            callback({
              'nook:extension-setup': {
                ...demoExtensionSetup,
              },
            }),
          )
        },
      },
    },
  }

  const browserGlobal = globalThis as typeof globalThis & {
    chrome?: Record<string, unknown>
  }
  if (browserGlobal.chrome) {
    Object.defineProperties(browserGlobal.chrome, {
      i18n: { configurable: true, value: chromeStub.i18n },
      runtime: { configurable: true, value: chromeStub.runtime },
      storage: { configurable: true, value: chromeStub.storage },
    })
  } else {
    Object.defineProperty(browserGlobal, 'chrome', {
      configurable: true,
      value: chromeStub,
    })
  }
}
