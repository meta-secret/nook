import { ExternalSenderTrustPolicy } from './routing-trust'
import type * as RuntimeMessages from '../../../../nook-web-shared/src/extension/runtime-messages'
import {
  OpenCompanionLauncherNormalizationKind,
  NormalizedOpenCompanionLauncherMessage as NormalizedOpenCompanionLauncherMessageSchema,
} from '../../../../nook-web-shared/src/extension/companion-launcher-message'
import type * as PairingIdentity from './pairing-identity'
import type * as PairingImport from './pairing-import'
import type * as SessionLifecycle from './session-lifecycle'

type ChromeMessageListener = Parameters<
  typeof chrome.runtime.onMessageExternal.addListener
>[0]

export type ExternalCompanionRoutingRequest = {
  dependencies: ExternalCompanionRoutingDependencies
  message: Parameters<ChromeMessageListener>[0]
  sender: chrome.runtime.MessageSender
  sendResponse: Parameters<ChromeMessageListener>[2]
}

export type ExternalCompanionRoutingDependencies = {
  createIdentityHandoff: typeof PairingIdentity.extensionPairingIdentity.createIdentityHandoff
  createPairedIdentityHandoff: typeof PairingIdentity.extensionPairingIdentity.createPairedIdentityHandoff
  discoverPairedVaultIdentity: typeof PairingIdentity.extensionPairingIdentity.discoverPairedVaultIdentity
  hasPairingApprovedType: typeof PairingIdentity.extensionPairingIdentity.hasPairingApprovedType
  importPairingAfterCompanionReady: typeof PairingImport.importPairingAfterCompanionReady
  isExtensionIdentityHandoffRequestMessage: typeof RuntimeMessages.ExtensionIdentityHandoffRequestMessage.is
  isExtensionPairedVaultIdentityDiscoveryMessage: typeof RuntimeMessages.ExtensionPairedVaultIdentityDiscoveryMessage.is
  isExtensionPairedVaultIdentityHandoffRequestMessage: typeof RuntimeMessages.ExtensionPairedVaultIdentityHandoffRequestMessage.is
  isExtensionPairedVaultUnlockRequestMessage: typeof RuntimeMessages.ExtensionPairedVaultUnlockRequestMessage.is
  normalizeOpenCompanionLauncherMessage: typeof NormalizedOpenCompanionLauncherMessageSchema.normalizeOpenCompanionLauncherMessage
  openCompanionLauncher: typeof SessionLifecycle.extensionSessionLifecycle.openCompanionLauncher
  refreshAuthenticationSurfaces: typeof SessionLifecycle.extensionSessionLifecycle.refreshAuthenticationSurfaces
  requestPairedVaultUnlock: typeof PairingIdentity.extensionPairingIdentity.requestPairedVaultUnlock
}

type MessageResponse = Parameters<
  ExternalCompanionRoutingRequest['sendResponse']
>[0]

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
const authenticationSurfaceRefreshFailureResponse: MessageResponse = {
  ok: false,
  reason: 'authentication-surface-refresh-failed',
}

export class ExternalCompanionRouter {
  constructor(private readonly request: ExternalCompanionRoutingRequest) {}

  async route(): Promise<boolean> {
    const { dependencies, message, sender, sendResponse } = this.request
    const {
      createIdentityHandoff,
      createPairedIdentityHandoff,
      discoverPairedVaultIdentity,
      hasPairingApprovedType,
      importPairingAfterCompanionReady,
      isExtensionIdentityHandoffRequestMessage,
      isExtensionPairedVaultIdentityDiscoveryMessage,
      isExtensionPairedVaultIdentityHandoffRequestMessage,
      isExtensionPairedVaultUnlockRequestMessage,
      normalizeOpenCompanionLauncherMessage,
      openCompanionLauncher,
      refreshAuthenticationSurfaces,
      requestPairedVaultUnlock,
    } = dependencies
    const launcherMessage = normalizeOpenCompanionLauncherMessage(message)
    if (
      launcherMessage.kind === OpenCompanionLauncherNormalizationKind.Normalized
    ) {
      if (!(await ExternalSenderTrustPolicy.admits(sender))) {
        sendResponse(forbiddenSenderResponse)
        return false
      }
      void openCompanionLauncher(launcherMessage.message.intent)
        .then(() => sendResponse(successResponse))
        .catch(() => sendResponse(launcherFailureResponse))
      return true
    }

    if (isExtensionPairedVaultIdentityDiscoveryMessage(message)) {
      if (!(await ExternalSenderTrustPolicy.admits(sender))) {
        sendResponse(forbiddenSenderResponse)
        return false
      }
      void discoverPairedVaultIdentity(message).then(sendResponse)
      return true
    }

    if (isExtensionPairedVaultUnlockRequestMessage(message)) {
      if (!(await ExternalSenderTrustPolicy.admits(sender))) {
        sendResponse(forbiddenSenderResponse)
        return false
      }
      void requestPairedVaultUnlock(message)
        .then(sendResponse)
        .catch(() => {
          const unlockFailureResponse: Parameters<typeof sendResponse>[0] = {
            ok: false,
            requestId: message.payload.requestId,
            vaultStoreId: message.payload.vaultStoreId,
            reason: 'unlock-launch-failed',
          }
          return sendResponse(unlockFailureResponse)
        })
      return true
    }

    if (isExtensionIdentityHandoffRequestMessage(message)) {
      if (!(await ExternalSenderTrustPolicy.admits(sender))) {
        sendResponse(forbiddenSenderResponse)
        return false
      }
      void createIdentityHandoff(message).then(sendResponse)
      return true
    }

    if (isExtensionPairedVaultIdentityHandoffRequestMessage(message)) {
      if (!(await ExternalSenderTrustPolicy.admits(sender))) {
        sendResponse(forbiddenSenderResponse)
        return false
      }
      void createPairedIdentityHandoff(message).then(sendResponse)
      return true
    }

    if (
      !hasPairingApprovedType(message) ||
      !(await ExternalSenderTrustPolicy.admits(sender))
    ) {
      sendResponse(invalidPairingGrantResponse)
      return false
    }
    void importPairingAfterCompanionReady(message)
      .then(async (response) => {
        if (response.ok) {
          try {
            await refreshAuthenticationSurfaces()
          } catch {
            return authenticationSurfaceRefreshFailureResponse
          }
        }
        return response
      })
      .then(sendResponse)
    return true
  }
}
