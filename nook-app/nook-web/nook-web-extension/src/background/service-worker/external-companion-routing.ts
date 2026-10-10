import { ExternalSenderTrustPolicy } from './routing-trust'
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
} from '../../../../nook-web-shared/src/extension/runtime-messages'
import { NormalizedOpenCompanionLauncherMessage as NormalizedOpenCompanionLauncherMessageSchema } from '../../../../nook-web-shared/src/extension/companion-launcher-message'
import type * as PairingIdentity from './pairing-identity'
import type * as PairingImport from './pairing-import'
import type * as SessionLifecycle from './session-lifecycle'
import { ExtensionSessionLifecycle } from './session-lifecycle'
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
  decodeOpenCompanionLauncherMessage: typeof NormalizedOpenCompanionLauncherMessageSchema.decode
  openCompanionLauncher: typeof SessionLifecycle.extensionSessionLifecycle.openCompanionLauncher
  refreshAuthenticationSurfaces: typeof SessionLifecycle.extensionSessionLifecycle.refreshAuthenticationSurfaces
  requestPairedVaultUnlock: typeof PairingIdentity.extensionPairingIdentity.requestPairedVaultUnlock
}

type MessageResponse = { ok: boolean; reason?: string }

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
    const eventLogRecordsSnapshot =
      SerializedWireValueAdapter.snapshotEventLogRecords(message)
    if (!(await ExternalSenderTrustPolicy.admits(sender))) {
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
      decodeOpenCompanionLauncherMessage,
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

    const pairedVaultUnlock = runConcreteDecoder(
      decodeExtensionPairedVaultUnlockRequestMessage,
      message,
    )
    if (pairedVaultUnlock.kind === ConcreteDecoderResultKind.Decoded) {
      const decodedMessage = pairedVaultUnlock.value
      const source = ExtensionSessionLifecycle.sourceFromSender(sender)
      const unlockRequest: Parameters<typeof requestPairedVaultUnlock>[0] = {
        message: decodedMessage,
        source,
      }
      void requestPairedVaultUnlock(unlockRequest)
        .then(sendResponse)
        .catch(() => {
          const unlockFailureResponse: Parameters<typeof sendResponse>[0] = {
            ok: false,
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
