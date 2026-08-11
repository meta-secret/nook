import initNookWasm, {
  configureVaultApplication,
  decodeStorageProviders,
  NookVaultManager,
  VaultApplication,
} from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import type {
  AuthProvidersSnapshot,
  StorageProvider,
} from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import {
  ExtensionSessionMessageDispatcher,
  type SessionMessageDispatchContext,
} from './session-message-dispatch'
import type { ExtensionSessionRequest } from './session-request-adapter'
import {
  handleSessionMessage,
  type DeviceResult,
  type HandleSessionMessageArgs,
  type SessionOperationContext,
} from './session-operations'

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

function ensureWasm(): ReturnType<typeof initNookWasm> {
  if (wasmStartup.kind === WasmStartupKind.Initializing) {
    return wasmStartup.operation
  }
  const initArgs: Parameters<typeof initNookWasm>[0] = {
    module_or_path: chrome.runtime.getURL('offscreen/nook_wasm_bg.wasm'),
  }
  const operation = initNookWasm(initArgs).then((value) => {
    configureVaultApplication(VaultApplication.Extension)
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
    deviceSigningPublicKey: await activeManager.deviceSigningPublicKey(),
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
      const expiredManager = managerAvailability
      managerAvailability = { kind: VaultManagerAvailabilityKind.Locked }
      if (expiredManager.kind === VaultManagerAvailabilityKind.Active) {
        try {
          expiredManager.manager.lockDeviceIdentity()
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
        type: 'nook:extension-session-expired',
      }
      void chrome.runtime.sendMessage(expiryMessage)
    }, SESSION_DURATION_MS),
  }
}

async function activateSession(): Promise<DeviceResult> {
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
  resetOperations: (error) => sessionMessageDispatcher.replaceOperations(error),
}

type SessionOperationResponse = Awaited<ReturnType<typeof handleSessionMessage>>

async function handleMessage(
  message: ExtensionSessionRequest,
): Promise<SessionOperationResponse> {
  const args: HandleSessionMessageArgs = { message, context: operationContext }
  return handleSessionMessage(args)
}

type ExtensionSessionResponse = Awaited<ReturnType<typeof handleMessage>>

const dispatchContext: SessionMessageDispatchContext<ExtensionSessionResponse> =
  {
    handleMessage,
    decodeProviders: async (providers) => {
      const snapshot: AuthProvidersSnapshot = {
        providers: providers as StorageProvider[],
        activeVaultStoreId: { state: 'unselected' },
      }
      return decodeStorageProviders(snapshot).providers
    },
  }
const sessionMessageDispatcher = new ExtensionSessionMessageDispatcher(
  dispatchContext,
)
sessionMessageDispatcher.registerRuntimeListener()
