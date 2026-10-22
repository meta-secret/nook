import {
  ExternalSenderTrustDecision,
  ExternalSenderTrustPolicy,
} from './routing-trust'
import { Effect } from 'effect'
import { ExtensionVaultEventLogExport } from './vault-event-log-export'
import {
  decode_extension_vault_event_log_request_message,
  type ExtensionVaultEventLogResponse,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import type * as RuntimeMessages from '../../../../nook-web-shared/src/extension/runtime-messages'
import {
  ExtensionPairingApprovedGrantAdmission,
  ExtensionPairingApprovedMessageType,
  ExtensionPairedVaultUnlockRequestMessageType,
} from '../../../../nook-web-shared/src/extension/runtime-messages'
import { NormalizedOpenCompanionLauncherMessage as NormalizedOpenCompanionLauncherMessageSchema } from '../../../../nook-web-shared/src/extension/companion-launcher-message'
import type * as PairingIdentity from './pairing-identity'
import type * as PairingImport from './pairing-import'
import type * as SessionLifecycle from './session-lifecycle'
import {
  CompanionLauncherSourceKind,
  ExtensionSessionLifecycle,
} from './session-lifecycle'
import {
  ConcreteDecoderResultKind,
  runConcreteDecoder,
} from '../../lib/concrete-decoder'
import {
  SerializedWireSnapshotKind,
  SerializedWireValueAdapter,
} from '../../lib/serialized-wire-value-adapter'

type ChromeMessageListener = Parameters<
  typeof chrome.runtime.onMessageExternal.addListener
>[0]

export type ExternalCompanionValue =
  | string
  | number
  | boolean
  | ExternalCompanionMessage
  | ExternalCompanionValue[]

export type ExternalCompanionMessage = {
  [key: string]: ExternalCompanionValue
}

export type ExternalCompanionRoutingRequest = {
  dependencies: ExternalCompanionRoutingDependencies
  message: ExternalCompanionMessage
  sender: chrome.runtime.MessageSender
  sendResponse: Parameters<ChromeMessageListener>[2]
}

export type ExternalCompanionRoutingDependencies = {
  vaultEventLogExporter: Pick<ExtensionVaultEventLogExport, 'run'>
  createIdentityHandoff: typeof PairingIdentity.extensionPairingIdentity.createIdentityHandoff
  createPairedIdentityHandoff: typeof PairingIdentity.extensionPairingIdentity.createPairedIdentityHandoff
  discoverPairedVaultIdentity: typeof PairingIdentity.extensionPairingIdentity.discoverPairedVaultIdentity
  decodePairingApprovedMessage: typeof RuntimeMessages.ExtensionPairingApprovedMessage.decode
  importPairingAfterCompanionReady: typeof PairingImport.importPairingAfterCompanionReady
  decodeExtensionIdentityHandoffRequestMessage: typeof RuntimeMessages.ExtensionIdentityHandoffRequestMessage.decode
  decodeExtensionPairedVaultIdentityDiscoveryMessage: typeof RuntimeMessages.ExtensionPairedVaultIdentityDiscoveryMessage.decode
  decodeExtensionPairedVaultIdentityHandoffRequestMessage: typeof RuntimeMessages.ExtensionPairedVaultIdentityHandoffRequestMessage.decode
  decodeExtensionPairedVaultUnlockRequestMessage: typeof RuntimeMessages.ExtensionPairedVaultUnlockRequestMessage.decode
  decodeExtensionPairedVaultLockRequestMessage: typeof RuntimeMessages.ExtensionPairedVaultLockRequestMessage.decode
  decodeOpenCompanionLauncherMessage: typeof NormalizedOpenCompanionLauncherMessageSchema.decode
  admitsUnlockSenderSynchronously: typeof ExternalSenderTrustPolicy.admitsSynchronouslyIfReady
  openCompanionLauncher: typeof SessionLifecycle.extensionSessionLifecycle.openCompanionLauncher
  refreshAuthenticationSurfaces: typeof SessionLifecycle.extensionSessionLifecycle.refreshAuthenticationSurfaces
  requestPairedVaultUnlock: typeof PairingIdentity.extensionPairingIdentity.requestPairedVaultUnlock
  /** Locks the extension session and tells its vault tabs; false when the
   * cleanup did not complete. */
  lockExtensionSession: () => Promise<boolean>
}

type MessageResponse = { ok: boolean; reason?: string }

enum PairedUnlockRouteKind {
  NotRequested = 'not-requested',
  Requested = 'requested',
}

type PairedUnlockRouteState =
  | { readonly kind: PairedUnlockRouteKind.NotRequested }
  | {
      readonly kind: PairedUnlockRouteKind.Requested
      readonly message: RuntimeMessages.ExtensionPairedVaultUnlockRequestMessage
      readonly panelOpen: Promise<void>
      readonly windowId: number
    }

const forbiddenSenderResponse: MessageResponse = {
  ok: false,
  reason: 'forbidden-sender',
}
const successResponse: MessageResponse = { ok: true }
const launcherFailureResponse: MessageResponse = {
  ok: false,
  reason: 'launcher-failed',
}
const invalidPairingGrantResponse: MessageResponse = {
  ok: false,
  reason: 'invalid-pairing-grant',
}
const sessionLockFailureResponse: MessageResponse = {
  ok: false,
  reason: 'session-lock-failed',
}
const eventLogImportFailureResponse: MessageResponse = {
  ok: false,
  reason: 'event-log-import-failed',
}

function pairingGrantDecodeFailureResponse(
  message: ExternalCompanionMessage,
): MessageResponse {
  if (
    message.type !==
    ExtensionPairingApprovedMessageType.NookExtensionPairingApproved
  ) {
    return invalidPairingGrantResponse
  }
  const admission = ExtensionPairingApprovedGrantAdmission.parse(
    message.payload,
  )
  if (admission.isErr()) return { ok: false, reason: admission.error }
  return eventLogImportFailureResponse
}

enum ExternalVaultEventLogRoute {
  Export = 'export',
  Other = 'other',
}

export class ExternalCompanionRouter {
  constructor(private readonly request: ExternalCompanionRoutingRequest) {}

  async route(): Promise<boolean> {
    const { dependencies, message, sender, sendResponse } = this.request
    let pairedUnlockRoute: PairedUnlockRouteState = {
      kind: PairedUnlockRouteKind.NotRequested,
    }
    if (
      message.type ===
      ExtensionPairedVaultUnlockRequestMessageType.NookExtensionPairedVaultUnlockRequest
    ) {
      const trustDecision = dependencies.admitsUnlockSenderSynchronously(sender)
      if (trustDecision !== ExternalSenderTrustDecision.Admitted) {
        const trustFailureResponse: Parameters<typeof sendResponse>[0] = {
          ok: false,
          reason:
            trustDecision === ExternalSenderTrustDecision.NotReady
              ? 'unlock-trust-policy-not-ready'
              : 'forbidden-sender',
        }
        sendResponse(trustFailureResponse)
        return false
      }
      const unlockGestureProbe = runConcreteDecoder(
        dependencies.decodeExtensionPairedVaultUnlockRequestMessage,
        message,
      )
      if (unlockGestureProbe.kind === ConcreteDecoderResultKind.Rejected) {
        const invalidUnlockRequestResponse: Parameters<typeof sendResponse>[0] =
          {
            ok: false,
            reason: 'invalid-unlock-request',
          }
        sendResponse(invalidUnlockRequestResponse)
        return false
      }
      if (typeof chrome.sidePanel.close !== 'function') {
        const closeUnavailableResponse: Parameters<typeof sendResponse>[0] = {
          ok: false,
          reason: 'side-panel-close-unavailable',
        }
        sendResponse(closeUnavailableResponse)
        return false
      }
      const source = ExtensionSessionLifecycle.sourceFromSender(sender)
      if (source.kind !== CompanionLauncherSourceKind.SourceWindow) {
        const sourceWindowMissingResponse: Parameters<typeof sendResponse>[0] =
          {
            ok: false,
            reason: 'unlock-source-window-missing',
          }
        sendResponse(sourceWindowMissingResponse)
        return false
      }
      try {
        const sidePanelOpenOptions: chrome.sidePanel.OpenOptions = {
          windowId: source.windowId,
        }
        const panelOpen = chrome.sidePanel.open(sidePanelOpenOptions)
        pairedUnlockRoute = {
          kind: PairedUnlockRouteKind.Requested,
          message: unlockGestureProbe.value,
          panelOpen,
          windowId: source.windowId,
        }
      } catch {
        const sidePanelOpenFailureResponse: Parameters<typeof sendResponse>[0] =
          {
            ok: false,
            reason: 'side-panel-open-failed',
          }
        sendResponse(sidePanelOpenFailureResponse)
        return false
      }
    }
    const eventLogRecordsSnapshot =
      SerializedWireValueAdapter.snapshotEventLogRecords(message)
    if (
      pairedUnlockRoute.kind === PairedUnlockRouteKind.NotRequested &&
      !(await ExternalSenderTrustPolicy.admits(sender))
    ) {
      sendResponse(forbiddenSenderResponse)
      return false
    }
    const {
      createIdentityHandoff,
      createPairedIdentityHandoff,
      discoverPairedVaultIdentity,
      decodePairingApprovedMessage,
      importPairingAfterCompanionReady,
      decodeExtensionIdentityHandoffRequestMessage,
      decodeExtensionPairedVaultIdentityDiscoveryMessage,
      decodeExtensionPairedVaultIdentityHandoffRequestMessage,
      decodeExtensionPairedVaultUnlockRequestMessage,
      decodeExtensionPairedVaultLockRequestMessage,
      decodeOpenCompanionLauncherMessage,
      lockExtensionSession,
      openCompanionLauncher,
      refreshAuthenticationSurfaces,
      requestPairedVaultUnlock,
    } = dependencies
    const exportRoute = this.observeVaultEventLogRoute()
    switch (exportRoute) {
      case ExternalVaultEventLogRoute.Export:
        return this.exportVaultEventLog()
      case ExternalVaultEventLogRoute.Other:
        break
    }
    const launcherMessage = runConcreteDecoder(
      decodeOpenCompanionLauncherMessage,
      message,
    )
    if (launcherMessage.kind === ConcreteDecoderResultKind.Decoded) {
      const source = ExtensionSessionLifecycle.sourceFromSender(sender)
      const launcherRequest: Parameters<typeof openCompanionLauncher>[0] = {
        intent: launcherMessage.value.intent,
        source,
      }
      void openCompanionLauncher(launcherRequest)
        .then(() => sendResponse(successResponse))
        .catch(() => sendResponse(launcherFailureResponse))
      return true
    }

    const identityDiscovery = runConcreteDecoder(
      decodeExtensionPairedVaultIdentityDiscoveryMessage,
      message,
    )
    if (identityDiscovery.kind === ConcreteDecoderResultKind.Decoded) {
      if (!(await ExternalSenderTrustPolicy.admits(sender))) {
        sendResponse(forbiddenSenderResponse)
        return false
      }
      void discoverPairedVaultIdentity(identityDiscovery.value).then(
        sendResponse,
      )
      return true
    }

    const pairedVaultLock = runConcreteDecoder(
      decodeExtensionPairedVaultLockRequestMessage,
      message,
    )
    if (pairedVaultLock.kind === ConcreteDecoderResultKind.Decoded) {
      const { requestId } = pairedVaultLock.value.payload
      void lockExtensionSession().then((locked) => {
        const lockedResponse: RuntimeMessages.ExtensionPairedVaultLockResponse =
          { ok: true, requestId }
        sendResponse(locked ? lockedResponse : sessionLockFailureResponse)
      })
      return true
    }

    const pairedVaultUnlock =
      pairedUnlockRoute.kind === PairedUnlockRouteKind.NotRequested
        ? runConcreteDecoder(
            decodeExtensionPairedVaultUnlockRequestMessage,
            message,
          )
        : {
            kind: ConcreteDecoderResultKind.Decoded,
            value: pairedUnlockRoute.message,
          }
    if (pairedVaultUnlock.kind === ConcreteDecoderResultKind.Decoded) {
      const decodedMessage = pairedVaultUnlock.value
      const source = ExtensionSessionLifecycle.sourceFromSender(sender)
      const unlockRequest: Parameters<typeof requestPairedVaultUnlock>[0] = {
        message: decodedMessage,
        source,
      }
      const panelOpen =
        pairedUnlockRoute.kind === PairedUnlockRouteKind.Requested
          ? pairedUnlockRoute.panelOpen
          : Promise.resolve()
      void Promise.all([panelOpen, requestPairedVaultUnlock(unlockRequest)])
        .then(async ([, response]) => {
          if (
            !response.ok &&
            pairedUnlockRoute.kind === PairedUnlockRouteKind.Requested
          ) {
            const sidePanelCloseOptions: chrome.sidePanel.CloseOptions = {
              windowId: pairedUnlockRoute.windowId,
            }
            try {
              await chrome.sidePanel.close(sidePanelCloseOptions)
            } catch {
              // Preserve the unlock failure response if dismissal also fails.
            }
          }
          sendResponse(response)
        })
        .catch(() => {
          const unlockFailureResponse: Parameters<typeof sendResponse>[0] = {
            ok: false,
            requestId: decodedMessage.payload.requestId,
            vaultStoreId: decodedMessage.payload.vaultStoreId,
            reason: 'unlock-launch-failed',
          }
          return sendResponse(unlockFailureResponse)
        })
      return true
    }

    const identityHandoff = runConcreteDecoder(
      decodeExtensionIdentityHandoffRequestMessage,
      message,
    )
    if (identityHandoff.kind === ConcreteDecoderResultKind.Decoded) {
      void createIdentityHandoff(identityHandoff.value).then(sendResponse)
      return true
    }

    const pairedIdentityHandoff = runConcreteDecoder(
      decodeExtensionPairedVaultIdentityHandoffRequestMessage,
      message,
    )
    if (pairedIdentityHandoff.kind === ConcreteDecoderResultKind.Decoded) {
      if (!(await ExternalSenderTrustPolicy.admits(sender))) {
        sendResponse(forbiddenSenderResponse)
        return false
      }
      void createPairedIdentityHandoff(pairedIdentityHandoff.value).then(
        sendResponse,
      )
      return true
    }

    const pairingApproval = runConcreteDecoder(
      decodePairingApprovedMessage,
      message,
    )
    if (pairingApproval.kind === ConcreteDecoderResultKind.Rejected) {
      sendResponse(pairingGrantDecodeFailureResponse(message))
      return false
    }
    if (eventLogRecordsSnapshot.kind === SerializedWireSnapshotKind.Missing) {
      sendResponse(invalidPairingGrantResponse)
      return false
    }
    const preservedEventLogRecords =
      SerializedWireValueAdapter.restoreEventLogRecords<
        typeof pairingApproval.value.eventLogRecords
      >(eventLogRecordsSnapshot.value)
    const importMessage: typeof pairingApproval.value = {
      ...pairingApproval.value,
      eventLogRecords: preservedEventLogRecords,
    }
    void importPairingAfterCompanionReady(importMessage)
      .then(async (response) => {
        if (!response.ok) return response
        try {
          await refreshAuthenticationSurfaces()
        } catch {
          // The pairing import has already committed; keep its success response.
        }
        return response
      })
      .then(sendResponse)
    return true
  }

  private observeVaultEventLogRoute(): ExternalVaultEventLogRoute {
    switch (this.request.message.type === 'ExportVaultEventLog') {
      case true:
        return ExternalVaultEventLogRoute.Export
      case false:
        return ExternalVaultEventLogRoute.Other
    }
  }

  private exportVaultEventLog(): boolean {
    const { message, dependencies, sendResponse } = this.request
    const attempt: {
      readonly try: () => ReturnType<
        typeof decode_extension_vault_event_log_request_message
      >
      readonly catch: () => 'invalid-request'
    } = {
      try: () => {
        // Rust alone admits this untrusted Chrome request into the structural product type.
        /* eslint-disable @typescript-eslint/no-unsafe-type-assertion, @typescript-eslint/no-restricted-types -- Raw Chrome messages have not yet crossed the generated Rust admission boundary. */
        return decode_extension_vault_event_log_request_message(
          message as unknown as Parameters<
            typeof decode_extension_vault_event_log_request_message
          >[0],
        )
        /* eslint-enable @typescript-eslint/no-unsafe-type-assertion, @typescript-eslint/no-restricted-types */
      },
      catch: () => 'invalid-request',
    }
    const decoded = Effect.runSync(Effect.result(Effect.try(attempt)))
    switch (decoded._tag) {
      case 'Failure': {
        const rejection: ExtensionVaultEventLogResponse = {
          kind: 'Rejected',
          reason: 'Failed',
        }
        sendResponse(rejection)
        return false
      }
      case 'Success':
        void Effect.runPromise(
          dependencies.vaultEventLogExporter.run(decoded.success),
        ).then(sendResponse)
        return true
    }
  }
}
