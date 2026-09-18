import {
  ExtensionSessionTransportFailure,
  ExtensionSessionTransportFailureKind,
  ExtensionSessionDocumentStateKind,
  type ExtensionSessionTransport,
} from '../src/background/service-worker/session-document'
import { err, ok } from 'neverthrow'
import {
  BeginExtensionPairingMessage,
  ExtensionLocalEventLogUpdatedMessage,
  OpenSimpleVaultMessage,
} from '../../nook-web-shared/src/extension/lifecycle-runtime-messages'
import { mock } from 'bun:test'
import { NormalizedOpenCompanionLauncherMessage as NormalizedOpenCompanionLauncherMessageSchema } from '../../nook-web-shared/src/extension/companion-launcher-message'
import type { ExtensionLifecycleRoutingDependencies } from '../src/background/service-worker/extension-lifecycle-routing'
import type { LocalEventLogUpdateResult } from '../src/background/service-worker/pairing-import'
import type {
  ExternalCompanionMessage,
  ExternalCompanionRoutingDependencies,
} from '../src/background/service-worker/external-companion-routing'
import { companionWasmReady } from '../../nook-web-shared/src/extension/companion-ready'
import {
  AccountPickerAuthorizationLifecycle,
  CleanupEvidence,
} from '../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  extensionPairingGrantPolicyReady,
  type StoredExtensionPairingGrant,
} from '../src/background/pairing-grants'
import { ExtensionPairingStateQueryMessage } from '../src/lib/pairing-state'
import {
  decodeExtensionAuthenticationSurfacesRefreshMessage,
  decodeExtensionSessionEnsureMessage,
  decodeExtensionSessionExpiryMessage,
  decodeExtensionSessionLockMessage,
} from '../src/background/service-worker/session-runtime-messages'
import {
  ExtensionPairingApprovedMessage,
  ExtensionPairingApprovedMessageType,
  ExtensionIdentityHandoffRequestMessage,
  ExtensionPairedVaultIdentityDiscoveryMessage,
  ExtensionPairedVaultIdentityHandoffRequestMessage,
  ExtensionPairedVaultUnlockRequestMessage,
} from '../../nook-web-shared/src/extension/runtime-messages'
import initNookWasm from '../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm.js'

Object.assign(globalThis, {
  __NOOK_SIMPLE_VAULT_URL__: 'https://simple.example.test/',
})

await initNookWasm({
  module_or_path: await Bun.file(
    new URL(
      '../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm_bg.wasm',
      import.meta.url,
    ),
  ).arrayBuffer(),
})
Object.assign(globalThis, {
  chrome: {
    runtime: {
      id: 'nook-extension',
      getURL: (path: string) => `chrome-extension://nook-extension/${path}`,
    },
  },
})

const { AccountPickerCleanupMarkerStatus } =
  await import('../src/background/service-worker/account-pickers')
const { importLocalEventLogUpdateWithDependencies } =
  await import('../src/background/service-worker/pairing-import')

const routedGrant: StoredExtensionPairingGrant = {
  vaultType: 'simple',
  vaultStoreId: 'store_abcdefghijk',
  deviceId: 'device-1',
  devicePublicKey: 'device-public-key',
  deviceSigningPublicKey: 'device-signing-public-key',
  vaultName: 'Private vault',
  deviceLabel: 'Test browser',
  approvedAt: 1_789_084_800_000,
  scopes: ['password-filling'],
  syncProviderCount: 0,
  eventCount: 1,
  eventLogHeads: ['event-1'],
  lastLocalSyncAt: '2026-09-11T00:00:00.000Z',
}

const routedVaultEvent = {
  schema_version: 2,
  store_id: 'store_testtoken11',
  actor_id: `key_${'0'.repeat(64)}`,
  actor_signing_public_key: '0'.repeat(64),
  parents: [],
  created_at: '2026-08-10T00:00:00Z',
  key_epoch: 'sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo',
  operations: [{ type: 'vault-cleared' as const }],
  signature: `ed25519:${'0'.repeat(128)}`,
}

const externalPairingMessage: ExternalCompanionMessage = {
  type: ExtensionPairingApprovedMessageType.NookExtensionPairingApproved,
  payload: {
    vaultType: routedGrant.vaultType,
    vaultStoreId: routedGrant.vaultStoreId,
    deviceId: routedGrant.deviceId,
    devicePublicKey: routedGrant.devicePublicKey,
    deviceSigningPublicKey: routedGrant.deviceSigningPublicKey,
    vaultName: routedGrant.vaultName,
    deviceLabel: routedGrant.deviceLabel,
    approvedAt: routedGrant.approvedAt,
    scopes: [...routedGrant.scopes],
    providers: [],
  },
  eventLogRecords: [
    {
      eventId: 'event-1',
      path: 'events/1',
      event: routedVaultEvent,
    },
  ],
}

// Obtain the generated outcome variants from Rust rather than mirroring them.
await companionWasmReady
const started = new AccountPickerAuthorizationLifecycle('opening')
  .begin_cleanup('cleanup')
  .into_lifecycle()
const rejectedTransition = started.complete_cleanup(
  'stale',
  CleanupEvidence.Full,
)
const rejectedCleanup = rejectedTransition.outcome()
const pendingTransition = rejectedTransition
  .into_lifecycle()
  .begin_cleanup('overlap')
  .into_lifecycle()
  .complete_cleanup('cleanup', CleanupEvidence.Full)
const pendingCleanup = pendingTransition.outcome()
const completedTransition = pendingTransition
  .into_lifecycle()
  .complete_cleanup('cleanup', CleanupEvidence.Full)
const completedCleanup = completedTransition.outcome()
completedTransition.into_lifecycle().free()

const unusedAsyncDependency = mock(() =>
  Promise.reject(new Error('unused routing test dependency')),
)
const unusedSessionTransport: ExtensionSessionTransport = {
  sendMessage: async () => {
    throw new Error('routing fixture session transport must not send directly')
  },
}
const ensureExtensionSessionDocument = mock(() =>
  Promise.resolve(ok(unusedSessionTransport)),
)
const openCompanionLauncher = mock(() => Promise.resolve())
const accountPickerAuthorizationCleanupPending = mock(() =>
  Promise.resolve(false),
)
const beginAccountPickerAuthorizationCleanup = mock(() =>
  Promise.resolve({
    authorizationGeneration: 'epoch-1',
    markerStatus: AccountPickerCleanupMarkerStatus.Persisted,
  }),
)
const clearPendingAccountPickers = mock(() => Promise.resolve())
const clearStagedAuthenticatorEnrollments = mock(() => {})
const rebindStagedAuthenticatorEnrollmentsAuthorization = mock(() => {})
const completeAccountPickerAuthorizationCleanup = mock(() =>
  Promise.resolve(completedCleanup),
)
const releaseAccountPickerAuthorizationCleanup = mock(() => {})
const refreshAuthenticationSurfaces = mock(() => Promise.resolve())

const lifecycleDependencies: ExtensionLifecycleRoutingDependencies = {
  accountPickerAuthorizationCleanupPending,
  beginAccountPickerAuthorizationCleanup,
  clearPendingAccountPickers,
  clearStagedAuthenticatorEnrollments,
  closeExtensionSessionDocument: mock(() =>
    Promise.resolve(
      err(
        new ExtensionSessionTransportFailure(
          ExtensionSessionTransportFailureKind.ClosureFailed,
        ),
      ),
    ),
  ),
  completeAccountPickerAuthorizationCleanup,
  ensureExtensionSessionDocument,
  extensionSessionDocument: 'offscreen/session.html',
  handlePairingStateQuery: mock(() => false),
  decodePairingApprovedMessage: ExtensionPairingApprovedMessage.decode,
  importLocalEventLogUpdate: unusedAsyncDependency,
  importPairingAfterCompanionReady: unusedAsyncDependency,
  decodeExtensionAuthenticationSurfacesRefreshMessage,
  decodeExtensionPairingStateQueryMessage:
    ExtensionPairingStateQueryMessage.decode,
  decodeExtensionSessionEnsureMessage,
  decodeExtensionSessionExpiryMessage,
  decodeExtensionSessionLockMessage,
  decodeExtensionLocalEventLogUpdatedMessage:
    ExtensionLocalEventLogUpdatedMessage.decode,
  decodeOpenSimpleVaultMessage: OpenSimpleVaultMessage.decode,
  decodeBeginExtensionPairingMessage: BeginExtensionPairingMessage.decode,
  decodeOpenCompanionLauncherMessage:
    NormalizedOpenCompanionLauncherMessageSchema.decode,
  openCompanionLauncher,
  openExtensionPairing: unusedAsyncDependency,
  openSimpleVault: mock(() => Promise.resolve()),
  releaseAccountPickerAuthorizationCleanup,
  rebindStagedAuthenticatorEnrollmentsAuthorization,
  refreshAuthenticationSurfaces,
}

const externalDependencies: ExternalCompanionRoutingDependencies = {
  createIdentityHandoff: unusedAsyncDependency,
  createPairedIdentityHandoff: unusedAsyncDependency,
  discoverPairedVaultIdentity: unusedAsyncDependency,
  decodePairingApprovedMessage: ExtensionPairingApprovedMessage.decode,
  importPairingAfterCompanionReady: unusedAsyncDependency,
  decodeExtensionIdentityHandoffRequestMessage:
    ExtensionIdentityHandoffRequestMessage.decode,
  decodeExtensionPairedVaultIdentityDiscoveryMessage:
    ExtensionPairedVaultIdentityDiscoveryMessage.decode,
  decodeExtensionPairedVaultIdentityHandoffRequestMessage:
    ExtensionPairedVaultIdentityHandoffRequestMessage.decode,
  decodeExtensionPairedVaultUnlockRequestMessage:
    ExtensionPairedVaultUnlockRequestMessage.decode,
  decodeOpenCompanionLauncherMessage:
    NormalizedOpenCompanionLauncherMessageSchema.decode,
  openCompanionLauncher,
  refreshAuthenticationSurfaces,
  requestPairedVaultUnlock: unusedAsyncDependency,
}

async function flushResponses(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Bun.sleep(0)
}

async function routeDecodedLocalUpdate(
  sendSession: Parameters<
    typeof importLocalEventLogUpdateWithDependencies
  >[0]['sendSession'],
) {
  const policy = await extensionPairingGrantPolicyReady
  const key = policy.pairingGrantStorageKey(routedGrant.vaultStoreId)
  const importLocalEventLogUpdate = (
    request: Parameters<
      ExtensionLifecycleRoutingDependencies['importLocalEventLogUpdate']
    >[0],
  ) =>
    importLocalEventLogUpdateWithDependencies({
      ...request,
      ensureSession: async () => ok(unusedSessionTransport),
      persistPairingStorage: async () => {},
      loadPairingStorage: async () => ({ [key]: routedGrant }),
      pairingPolicyReady: extensionPairingGrantPolicyReady,
      importEventLog: async () => ({
        vaultStoreId: routedGrant.vaultStoreId,
        accessGranted: true,
        eventCount: 1,
        heads: ['event-1'],
      }),
      sendSession,
    })
  const closeSession = mock(() =>
    Promise.resolve(
      ok<
        ExtensionSessionDocumentStateKind.Closed,
        ExtensionSessionTransportFailure
      >(ExtensionSessionDocumentStateKind.Closed),
    ),
  )
  const dependencies: ExtensionLifecycleRoutingDependencies = {
    ...lifecycleDependencies,
    closeExtensionSessionDocument: closeSession,
    importLocalEventLogUpdate,
  }
  const { routeExtensionLifecycleMessage } =
    await import('../src/background/service-worker/extension-lifecycle-routing')
  const response = new Promise<LocalEventLogUpdateResult>((sendResponse) => {
    routeExtensionLifecycleMessage({
      dependencies,
      message: {
        type: 'nook:extension-local-event-log-updated',
        payload: {
          vaultStoreId: routedGrant.vaultStoreId,
          eventLogRecords: [
            {
              eventId: 'event-1',
              path: 'events/1',
              event: routedVaultEvent,
            },
          ],
        },
      },
      sender: { id: 'nook-extension', url: 'https://simple.example.test/' },
      sendResponse,
    })
  })
  return { response: await response, closeSession }
}

export {
  AccountPickerCleanupMarkerStatus,
  completedCleanup,
  externalDependencies,
  externalPairingMessage,
  ensureExtensionSessionDocument,
  flushResponses,
  lifecycleDependencies,
  openCompanionLauncher,
  pendingCleanup,
  rejectedCleanup,
  refreshAuthenticationSurfaces,
  routeDecodedLocalUpdate,
  routedGrant,
  routedVaultEvent,
}
