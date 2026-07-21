export type ChromeMessage = { message: string }

export type DemoChromeStubArgs = {
  localizedMessages: Record<string, ChromeMessage>
  /** Static replies keyed by runtime message type. */
  responsesByType?: Record<string, unknown>
  /** Stateful login-pilot replies for Continue → unlock → chooser. */
  loginPilotFlow?: boolean
  /** Stateful post-submit save-offer replies for Pilot login capture. */
  savePilotFlow?: boolean
  /** Signup generate-password Pilot replies. */
  generatePilotFlow?: boolean
  /** Pilot-gated Create/Use passkey proposal replies. */
  passkeyPilotFlow?: boolean
  /** 2FA enrollment ceremony replies with evidence-gated confirm. */
  enrollPilotFlow?: boolean
  barcodeRawValue?: string
}

/** Self-contained init/evaluate helper shared by Pilot UI demos. */
export function installDemoChromeStub(args: DemoChromeStubArgs) {
  type RuntimeMessage = {
    type?: string
    payload?: { secretId?: string }
  }
  type RuntimeCallback = (response?: unknown) => void
  type StagedSaveOffer = {
    offerId: string
    decision: 'create'
    vaultStoreId: string
    vaultName: string
  }

  const {
    localizedMessages,
    responsesByType = {},
    loginPilotFlow = false,
    savePilotFlow = false,
    generatePilotFlow = false,
    passkeyPilotFlow = false,
    enrollPilotFlow = false,
    barcodeRawValue,
  } = args
  let loginOptionsCalls = 0
  let stagedOffer: StagedSaveOffer | undefined
  let enrollStaged = false

  const responseFor = (message: RuntimeMessage): unknown => {
    if (message.type && message.type in responsesByType) {
      return responsesByType[message.type]
    }
    if (passkeyPilotFlow) {
      switch (message.type) {
        case 'nook:authentication-workflow-snapshot':
          return {
            ok: true,
            snapshot: {
              kind: 'login',
              stage: 'credentials',
              action: 'create-passkey',
              currentStep: 1,
              totalSteps: 3,
              observationIndex: 0,
            },
          }
        default:
          return { ok: true }
      }
    }
    if (enrollPilotFlow) {
      switch (message.type) {
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
          return { ok: true, code: '482913' }
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
                name: 'insufficient',
                allowsCredentialCommit: false,
              },
            }
          }
          if (observation?.successMarkerPresent && enrollStaged) {
            return {
              ok: true,
              verdict: { name: 'sufficient', allowsCredentialCommit: true },
            }
          }
          return {
            ok: true,
            verdict: {
              name: 'insufficient',
              allowsCredentialCommit: false,
            },
          }
        }
        case 'nook:website-authenticator-enroll-confirm':
          enrollStaged = false
          return { ok: true, secretId: 'demo-authenticator-1' }
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
              kind: 'signup',
              stage: 'credentials',
              action: 'generate-password',
              currentStep: 2,
              totalSteps: 5,
              observationIndex: 0,
            },
          }
        case 'nook:website-generate-password':
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
              kind: 'login',
              stage: 'credentials',
              action: 'continue-with-nook',
              currentStep: 1,
              totalSteps: 3,
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
                name: 'insufficient',
                allowsCredentialCommit: false,
              },
            }
          }
          if (observation?.successMarkerPresent) {
            return {
              ok: true,
              verdict: { name: 'sufficient', allowsCredentialCommit: true },
            }
          }
          return {
            ok: true,
            verdict: {
              name: 'insufficient',
              allowsCredentialCommit: false,
            },
          }
        }
        case 'nook:website-login-save-offer':
          stagedOffer = {
            offerId: 'demo-save-offer',
            decision: 'create',
            vaultStoreId: 'demo-vault',
            vaultName: 'Demo vault',
          }
          return {
            ok: true,
            status: 'ready',
            decision: 'create',
            offer: stagedOffer,
          }
        case 'nook:website-login-save-pending':
          return { ok: true, offer: stagedOffer }
        case 'nook:website-login-save-commit':
          stagedOffer = undefined
          return { ok: true, decision: 'create' }
        case 'nook:website-login-save-dismiss':
          stagedOffer = undefined
          return { ok: true }
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
            kind: 'login',
            stage: 'credentials',
            action: 'continue-with-nook',
            currentStep: 1,
            totalSteps: 3,
            observationIndex: 0,
          },
        }
      case 'nook:website-login-options':
        loginOptionsCalls += 1
        if (loginOptionsCalls === 1) {
          return { ok: true, status: 'locked', accounts: [] }
        }
        return {
          ok: true,
          status: 'ready',
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
        const message = localizedMessages[key]?.message ?? ''
        return substitution ? message.replaceAll('$1', substitution) : message
      },
    },
    runtime: {
      lastError: undefined,
      getURL(resource: string) {
        return resource === 'icons/nook.png' ? '/favicon.png' : resource
      },
      sendMessage(message: RuntimeMessage, callback?: RuntimeCallback) {
        const response = responseFor(message)
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
                status: 'ready',
                deviceLabel: 'Demo browser',
                pairedVaults: ['Demo vault'],
                selectedVaultName: 'Demo vault',
                syncProviderCount: 1,
                eventCount: 3,
                eventLogHeads: ['demo-head'],
                lastLocalSyncAt: '2026-07-20T00:00:00.000Z',
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
