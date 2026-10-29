import {
  SessionOperationFailure,
  SessionOperationFailureKind,
} from '../lib/session-operation-queue'
import type { Result } from 'neverthrow'
import {
  ActiveExtensionSessionLease,
  ExtensionSessionGeneration,
} from './session-lease'
import type initNookWasm from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import {
  admit_extension_storage_providers,
  NookVaultManager,
} from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import {
  ListeningExtensionSession,
  type SessionMessageDispatchContext,
} from './session-message-dispatch'
import type { ExtensionSessionRequest } from './session-request-adapter'
import { ExtensionSessionLifecycleMessageType } from '../lib/extension-session-lifecycle-message-type'
import { ExtensionRuntimeRequestType } from '../lib/extension-runtime-request-type'
import {
  handleSessionMessage,
  type DeviceResult,
  type HandleSessionMessageArgs,
  type SessionOperationContext,
} from './session-operations'
import { GoogleLoginSessionContinuations } from './google-login-continuation'
import { vaultWasmStartup } from './vault-wasm-startup'
import type { CompanionWasmSessionResponse } from '../../../nook-web-shared/src/extension/companion-wasm-runtime-messages'

const SESSION_DURATION_MS = 15 * 60 * 1000

enum VaultManagerAvailabilityKind {
  Locked = 'locked',
  Active = 'active',
}

type VaultManagerAvailability =
  | { kind: VaultManagerAvailabilityKind.Locked }
  | { kind: VaultManagerAvailabilityKind.Active; manager: NookVaultManager }

enum SessionExpiryScheduleKind {
  Stopped = 'stopped',
  Scheduled = 'scheduled',
}

type SessionExpirySchedule =
  | { kind: SessionExpiryScheduleKind.Stopped }
  | {
      kind: SessionExpiryScheduleKind.Scheduled
      lease: ActiveExtensionSessionLease
    }

type ExtensionSessionExpiryMessage = {
  type: ExtensionSessionLifecycleMessageType.Expired
}

type AuthenticationSurfacesRefreshMessage = {
  type: ExtensionRuntimeRequestType.RefreshAuthenticationSurfaces
}

type SessionExpiryLeaseConfiguration = ConstructorParameters<
  typeof ActiveExtensionSessionLease
>[0]

let managerAvailability: VaultManagerAvailability = {
  kind: VaultManagerAvailabilityKind.Locked,
}
class ExtensionSessionExpiryLifecycle {
  private scheduleState: SessionExpirySchedule = {
    kind: SessionExpiryScheduleKind.Stopped,
  }
  private generation = ExtensionSessionGeneration.initial()

  activate(onExpire: () => void): void {
    this.generation = this.generation.next()
    if (this.scheduleState.kind === SessionExpiryScheduleKind.Scheduled) {
      this.scheduleState.lease.stop()
    }
    const generation = this.generation
    const leaseConfiguration: SessionExpiryLeaseConfiguration = {
      generation,
      durationMs: SESSION_DURATION_MS,
      onExpire: () => {
        if (!this.generation.matches(generation)) return
        this.scheduleState = { kind: SessionExpiryScheduleKind.Stopped }
        this.generation = this.generation.next()
        onExpire()
      },
    }
    this.scheduleState = {
      kind: SessionExpiryScheduleKind.Scheduled,
      lease: new ActiveExtensionSessionLease(leaseConfiguration),
    }
  }
}

const sessionExpiryLifecycle = new ExtensionSessionExpiryLifecycle()

function ensureWasm(): ReturnType<typeof initNookWasm> {
  return vaultWasmStartup.ensure()
}

async function getManager(): Promise<NookVaultManager> {
  await ensureWasm()
  if (managerAvailability.kind === VaultManagerAvailabilityKind.Active) {
    return managerAvailability.manager
  }
  const manager = new NookVaultManager()
  managerAvailability = { kind: VaultManagerAvailabilityKind.Active, manager }
  return manager
}

async function deviceResult(
  activeManager: NookVaultManager,
): Promise<DeviceResult> {
  return {
    deviceId: activeManager.device_id,
    devicePublicKey: activeManager.device_public_key,
    deviceSigningPublicKey: await activeManager.device_signing_public_key_js(),
  }
}

async function activateSession(): Promise<DeviceResult> {
  sessionMessageDispatcher.resetOperations()
  const activeManager = await getManager()
  sessionExpiryLifecycle.activate(() => {
    const expiredManager = managerAvailability
    managerAvailability = { kind: VaultManagerAvailabilityKind.Locked }
    if (expiredManager.kind === VaultManagerAvailabilityKind.Active) {
      try {
        expiredManager.manager.lock_device_identity()
        expiredManager.manager.free()
      } catch {
        // The service worker closes this document immediately if a WASM call
        // still owns the manager when the session expires.
      }
    }
    sessionMessageDispatcher.replaceOperations(
      new SessionOperationFailure(SessionOperationFailureKind.Locked),
    )
    const expiryMessage: ExtensionSessionExpiryMessage = {
      type: ExtensionSessionLifecycleMessageType.Expired,
    }
    void chrome.runtime.sendMessage(expiryMessage)
  })
  // Pilot widgets on open sites re-check Nook, so an Unlock button becomes Sign in.
  const refreshMessage: AuthenticationSurfacesRefreshMessage = {
    type: ExtensionRuntimeRequestType.RefreshAuthenticationSurfaces,
  }
  void chrome.runtime.sendMessage(refreshMessage)
  return deviceResult(activeManager)
}

const operationContext: SessionOperationContext = {
  ensureWasm,
  getManager,
  activateSession,
  deviceResult,
  resetOperations: (error) => sessionMessageDispatcher.replaceOperations(error),
}

type SessionOperationResponse = Awaited<ReturnType<typeof handleSessionMessage>>

async function handleMessage(
  message: ExtensionSessionRequest,
): Promise<SessionOperationResponse> {
  const args: HandleSessionMessageArgs = { message, context: operationContext }
  return handleSessionMessage(args)
}

type SessionSuccess<T> =
  T extends Result<infer Value, SessionOperationFailure> ? Value : never
type WebsitePasskeyAccountsSessionResponse = {
  readonly ok: true
  readonly accounts: readonly {
    readonly credentialId: string
    readonly userName: string
    readonly userDisplayName: string
  }[]
}
export type ExtensionSessionResponse =
  | SessionSuccess<Awaited<ReturnType<typeof handleMessage>>>
  | WebsitePasskeyAccountsSessionResponse
  | CompanionWasmSessionResponse

const dispatchContext: SessionMessageDispatchContext<ExtensionSessionResponse> =
  {
    handleMessage,
    handleCompanionWasmMessage: GoogleLoginSessionContinuations.buildHandler(),
    decodeProviders: async (providers) => {
      return admit_extension_storage_providers(providers)
    },
  }
const sessionMessageDispatcher = new ListeningExtensionSession(dispatchContext)
