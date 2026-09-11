import {
  SessionOperationFailure,
  SessionOperationFailureKind,
} from '../lib/session-operation-queue'
import { err, ok, type Result } from 'neverthrow'
import { ExtensionSessionLeaseFailure } from './session-lease'
import { ActiveExtensionSessionLease } from './session-lease'
import initNookWasm, {
  configure_vault_application,
  NookCompanionExtensionEndpoint,
  type NookDiscoveredCompanionExtensionEndpoint,
  admit_extension_storage_providers,
  NookVaultManager,
  VaultApplication,
} from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import type {
  CompanionIdentityHandoffResponse,
  CompanionIdentityStatus,
} from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import {
  ListeningExtensionSession,
  type SessionMessageDispatchContext,
} from './session-message-dispatch'
import type {
  CompanionIdentityDiscoverySessionTransportRequest,
  CompanionIdentityHandoffSessionTransportRequest,
  ExtensionSessionRequest,
} from './session-request-adapter'
import { ExtensionSessionLifecycleMessageType } from '../lib/extension-session-lifecycle-message-type'
import {
  handleSessionMessage,
  type DeviceResult,
  type HandleSessionMessageArgs,
  type SessionOperationContext,
} from './session-operations'
import {
  CompanionVaultDiscovery,
  CompanionDiscoveryEndpointKind,
  type CompanionDiscoveryEndpoint,
} from './session-vault-operations'
import type {
  CompanionExtensionPresence,
  CompanionIdentityDiscoveryObservation,
} from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import type { CompanionVaultDiscoveryArgs } from './session-vault-operations'

const SESSION_DURATION_MS = 15 * 60 * 1000

enum WasmStartupKind {
  NotStarted = 'not-started',
  Initializing = 'initializing',
}

type WasmStartup =
  | { kind: WasmStartupKind.NotStarted }
  | {
      kind: WasmStartupKind.Initializing
      operation: ReturnType<typeof initNookWasm>
    }

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

let wasmStartup: WasmStartup = { kind: WasmStartupKind.NotStarted }
let managerAvailability: VaultManagerAvailability = {
  kind: VaultManagerAvailabilityKind.Locked,
}
class ExtensionSessionExpiryLifecycle {
  private scheduleState: SessionExpirySchedule = {
    kind: SessionExpiryScheduleKind.Stopped,
  }
  private generation = 0

  currentGeneration(): number {
    return this.generation
  }

  activate(onExpire: () => void): void {
    this.generation += 1
    if (this.scheduleState.kind === SessionExpiryScheduleKind.Scheduled) {
      this.scheduleState.lease.stop()
    }
    const generation = this.generation
    this.scheduleState = {
      kind: SessionExpiryScheduleKind.Scheduled,
      // eslint-disable-next-line nook-typed-api/no-raw-object-arguments -- Existing call shape is preserved for this lint-only fix.
      lease: new ActiveExtensionSessionLease({
        generation,
        durationMs: SESSION_DURATION_MS,
        onExpire: () => {
          if (generation !== this.generation) return
          this.scheduleState = { kind: SessionExpiryScheduleKind.Stopped }
          this.generation += 1
          onExpire()
        },
      }),
    }
  }

  renew(generation: number): Result<void, ExtensionSessionLeaseFailure> {
    if (
      generation !== this.generation ||
      this.scheduleState.kind !== SessionExpiryScheduleKind.Scheduled
    ) {
      return err(ExtensionSessionLeaseFailure.Locked)
    }
    return this.scheduleState.lease.renew(generation)
  }
}

const sessionExpiryLifecycle = new ExtensionSessionExpiryLifecycle()

enum CompanionEndpointAvailabilityKind {
  Inactive = 'inactive',
  Active = 'active',
}

type CompanionEndpointAvailability =
  | { kind: CompanionEndpointAvailabilityKind.Inactive }
  | {
      kind: CompanionEndpointAvailabilityKind.Active
      endpoint: NookDiscoveredCompanionExtensionEndpoint
    }

let companionEndpointAvailability: CompanionEndpointAvailability = {
  kind: CompanionEndpointAvailabilityKind.Inactive,
}

function releaseCompanionEndpoint(): void {
  const current = companionEndpointAvailability
  companionEndpointAvailability = {
    kind: CompanionEndpointAvailabilityKind.Inactive,
  }
  if (current.kind === CompanionEndpointAvailabilityKind.Active) {
    current.endpoint.free()
  }
}

function ensureWasm(): ReturnType<typeof initNookWasm> {
  if (wasmStartup.kind === WasmStartupKind.Initializing) {
    return wasmStartup.operation
  }
  const initArgs: Parameters<typeof initNookWasm>[0] = {
    module_or_path: chrome.runtime.getURL('offscreen/nook_wasm_bg.wasm'),
  }
  const operation = initNookWasm(initArgs).then((value) => {
    configure_vault_application(VaultApplication.Extension)
    return value
  })
  wasmStartup = { kind: WasmStartupKind.Initializing, operation }
  return operation
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
  releaseCompanionEndpoint()
  sessionMessageDispatcher.resetOperations()
  const activeManager = await getManager()
  sessionExpiryLifecycle.activate(() => {
    releaseCompanionEndpoint()
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
  return deviceResult(activeManager)
}

const operationContext: SessionOperationContext = {
  ensureWasm,
  getManager,
  activateSession,
  deviceResult,
  currentGeneration: () => sessionExpiryLifecycle.currentGeneration(),
  renewSessionExpiry: (generation) => sessionExpiryLifecycle.renew(generation),
  resetOperations: (error) => {
    releaseCompanionEndpoint()
    sessionMessageDispatcher.replaceOperations(error)
  },
}

type SessionOperationResponse = Awaited<ReturnType<typeof handleSessionMessage>>

async function handleMessage(
  message: ExtensionSessionRequest,
): Promise<SessionOperationResponse> {
  const args: HandleSessionMessageArgs = { message, context: operationContext }
  return handleSessionMessage(args)
}

async function handleCompanionIdentityHandoff(
  message: CompanionIdentityHandoffSessionTransportRequest,
) {
  try {
    if (
      companionEndpointAvailability.kind !==
      CompanionEndpointAvailabilityKind.Active
    ) {
      return err(
        new SessionOperationFailure(SessionOperationFailureKind.Failed),
      )
    }
    const endpoint = companionEndpointAvailability.endpoint
    companionEndpointAvailability = {
      kind: CompanionEndpointAvailabilityKind.Inactive,
    }
    const generation = sessionExpiryLifecycle.currentGeneration()
    let consumed = false
    try {
      const activeManager = await getManager()
      consumed = true
      const response: CompanionIdentityHandoffResponse = await Reflect.apply(
        endpoint.authorize_and_seal,
        endpoint,
        [activeManager, message.payload.authorization],
      )
      const renewal = sessionExpiryLifecycle.renew(generation)
      if (renewal.isErr())
        return err(
          new SessionOperationFailure(SessionOperationFailureKind.Locked),
        )
      // eslint-disable-next-line nook-typed-api/no-raw-object-arguments -- Existing call shape is preserved for this lint-only fix.
      return ok({ ok: true, response })
    } finally {
      if (!consumed) endpoint.free()
    }
  } catch {
    return err(new SessionOperationFailure(SessionOperationFailureKind.Failed))
  }
}

async function handleCompanionIdentityDiscovery(
  message: CompanionIdentityDiscoverySessionTransportRequest,
) {
  try {
    await ensureWasm()
    const activeManager = await getManager()
    const prior = companionEndpointAvailability
    companionEndpointAvailability = {
      kind: CompanionEndpointAvailabilityKind.Inactive,
    }
    const endpoint: CompanionDiscoveryEndpoint =
      prior.kind === CompanionEndpointAvailabilityKind.Active
        ? {
            kind: CompanionDiscoveryEndpointKind.Discovered,
            endpoint: prior.endpoint,
          }
        : {
            kind: CompanionDiscoveryEndpointKind.Initial,
            endpoint: Reflect.construct(NookCompanionExtensionEndpoint, [
              message.payload.presence,
            ]),
          }

    try {
      // Construction above is the Rust-owned validation boundary for this
      // generated presence projection.
      const presence = message.payload.presence as CompanionExtensionPresence
      const discovery = message.payload
        .discovery as CompanionIdentityDiscoveryObservation
      const companionDiscoveryArgs: CompanionVaultDiscoveryArgs = {
        activeManager,
        endpoint,
        presence,
      }
      const companionDiscovery = new CompanionVaultDiscovery(
        companionDiscoveryArgs,
      )
      const discoveryResult = await companionDiscovery.discover(discovery)
      if (discoveryResult.isErr()) return err(discoveryResult.error)
      const discovered = discoveryResult.value
      companionEndpointAvailability = {
        kind: CompanionEndpointAvailabilityKind.Active,
        endpoint: discovered,
      }
      const status: CompanionIdentityStatus = discovered.status
      if (status.status !== 'unlocked') releaseCompanionEndpoint()
      // eslint-disable-next-line nook-typed-api/no-raw-object-arguments -- Existing call shape is preserved for this lint-only fix.
      return ok({ ok: true, status })
    } catch {
      releaseCompanionEndpoint()
      return err(
        new SessionOperationFailure(SessionOperationFailureKind.Failed),
      )
    }
  } catch {
    return err(new SessionOperationFailure(SessionOperationFailureKind.Failed))
  }
}

type SessionSuccess<T> =
  T extends Result<infer Value, SessionOperationFailure> ? Value : never
type ExtensionSessionResponse = SessionSuccess<
  | Awaited<ReturnType<typeof handleMessage>>
  | Awaited<ReturnType<typeof handleCompanionIdentityDiscovery>>
  | Awaited<ReturnType<typeof handleCompanionIdentityHandoff>>
>

const dispatchContext: SessionMessageDispatchContext<ExtensionSessionResponse> =
  {
    handleMessage,
    handleCompanionIdentityDiscovery,
    handleCompanionIdentityHandoff,
    decodeProviders: async (providers) => {
      return admit_extension_storage_providers(providers)
    },
  }
const sessionMessageDispatcher = new ListeningExtensionSession(dispatchContext)
