import initNookWasm, {
  configure_vault_application,
  NookCompanionExtensionEndpoint,
  decode_storage_providers,
  NookVaultManager,
  VaultApplication,
} from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import type {
  AuthProvidersSnapshot,
  CompanionIdentityHandoffResponse,
  CompanionIdentityStatus,
  StorageProvider,
} from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import {
  ExtensionSessionMessageDispatcher,
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
import { CompanionVaultDiscovery } from './session-vault-operations'
import type { CompanionExtensionPresence } from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

const SESSION_DURATION_MS = 15 * 60 * 1000
const SESSION_LOCKED_ERROR = 'EXTENSION_SESSION_LOCKED'

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
      timer: ReturnType<typeof setTimeout>
    }

let wasmStartup: WasmStartup = { kind: WasmStartupKind.NotStarted }
let managerAvailability: VaultManagerAvailability = {
  kind: VaultManagerAvailabilityKind.Locked,
}
let sessionExpirySchedule: SessionExpirySchedule = {
  kind: SessionExpiryScheduleKind.Stopped,
}
let sessionGeneration = 0
let sessionDeadlineAt = 0

enum CompanionEndpointAvailabilityKind {
  Inactive = 'inactive',
  Active = 'active',
}

type CompanionEndpointAvailability =
  | { kind: CompanionEndpointAvailabilityKind.Inactive }
  | {
      kind: CompanionEndpointAvailabilityKind.Active
      endpoint: NookCompanionExtensionEndpoint
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

function scheduleSessionExpiry(generation: number): void {
  if (sessionExpirySchedule.kind === SessionExpiryScheduleKind.Scheduled) {
    clearTimeout(sessionExpirySchedule.timer)
  }
  sessionDeadlineAt = Date.now() + SESSION_DURATION_MS
  sessionExpirySchedule = {
    kind: SessionExpiryScheduleKind.Scheduled,
    timer: setTimeout(() => {
      if (generation !== sessionGeneration) return
      sessionExpirySchedule = { kind: SessionExpiryScheduleKind.Stopped }
      sessionDeadlineAt = 0
      sessionGeneration += 1
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
        new Error(SESSION_LOCKED_ERROR),
      )
      const expiryMessage: Parameters<typeof chrome.runtime.sendMessage>[0] = {
        type: ExtensionSessionLifecycleMessageType.Expired,
      }
      void chrome.runtime.sendMessage(expiryMessage)
    }, SESSION_DURATION_MS),
  }
}

async function activateSession(): Promise<DeviceResult> {
  releaseCompanionEndpoint()
  sessionMessageDispatcher.resetOperations()
  const activeManager = await getManager()
  sessionGeneration += 1
  scheduleSessionExpiry(sessionGeneration)
  return deviceResult(activeManager)
}

function renewSessionExpiry(generation: number): void {
  if (
    generation !== sessionGeneration ||
    sessionDeadlineAt === 0 ||
    Date.now() >= sessionDeadlineAt
  ) {
    throw new Error(SESSION_LOCKED_ERROR)
  }
  scheduleSessionExpiry(generation)
}

const operationContext: SessionOperationContext = {
  ensureWasm,
  getManager,
  activateSession,
  deviceResult,
  currentGeneration: () => sessionGeneration,
  renewSessionExpiry,
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
  if (
    companionEndpointAvailability.kind !==
    CompanionEndpointAvailabilityKind.Active
  ) {
    throw new Error('Companion identity discovery is not active.')
  }
  const endpoint = companionEndpointAvailability.endpoint
  companionEndpointAvailability = {
    kind: CompanionEndpointAvailabilityKind.Inactive,
  }
  const generation = sessionGeneration
  try {
    const activeManager = await getManager()
    const response: CompanionIdentityHandoffResponse = await Reflect.apply(
      endpoint.authorize_and_seal,
      endpoint,
      [activeManager, message.payload.authorization],
    )
    renewSessionExpiry(generation)
    return { ok: true, response }
  } finally {
    endpoint.free()
  }
}

async function handleCompanionIdentityDiscovery(
  message: CompanionIdentityDiscoverySessionTransportRequest,
) {
  await ensureWasm()
  const activeManager = await getManager()
  if (
    companionEndpointAvailability.kind ===
    CompanionEndpointAvailabilityKind.Inactive
  ) {
    const endpoint: NookCompanionExtensionEndpoint = Reflect.construct(
      NookCompanionExtensionEndpoint,
      [message.payload.presence],
    )
    companionEndpointAvailability = {
      kind: CompanionEndpointAvailabilityKind.Active,
      endpoint,
    }
  }
  if (
    companionEndpointAvailability.kind !==
    CompanionEndpointAvailabilityKind.Active
  ) {
    throw new Error('Companion identity discovery endpoint is unavailable.')
  }
  const endpoint = companionEndpointAvailability.endpoint
  try {
    // Construction above is the Rust-owned validation boundary for this
    // generated presence projection.
    const presence = message.payload.presence as CompanionExtensionPresence
    const companionDiscovery = new CompanionVaultDiscovery({
      activeManager,
      endpoint,
      presence,
    })
    const status: CompanionIdentityStatus = await companionDiscovery.discover(
      message.payload.discovery,
    )
    if (status.status !== 'unlocked') releaseCompanionEndpoint()
    return { ok: true, status }
  } catch (error) {
    releaseCompanionEndpoint()
    throw error
  }
}

type ExtensionSessionResponse =
  | Awaited<ReturnType<typeof handleMessage>>
  | Awaited<ReturnType<typeof handleCompanionIdentityDiscovery>>
  | Awaited<ReturnType<typeof handleCompanionIdentityHandoff>>

const dispatchContext: SessionMessageDispatchContext<ExtensionSessionResponse> =
  {
    handleMessage,
    handleCompanionIdentityDiscovery,
    handleCompanionIdentityHandoff,
    decodeProviders: async (providers) => {
      const snapshot: AuthProvidersSnapshot = {
        providers: providers as StorageProvider[],
        activeVaultStoreId: { state: 'unselected' },
      }
      return decode_storage_providers(snapshot).providers
    },
  }
const sessionMessageDispatcher = new ExtensionSessionMessageDispatcher(
  dispatchContext,
)
sessionMessageDispatcher.registerRuntimeListener()
