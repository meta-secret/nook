import { ExtensionConnectScope } from '../../../../nook-web-shared/src/extension/extension-connect-scope'
import { extensionPairingGrantPolicyReady } from '../pairing-grants'
import type {
  DefaultVaultSelectResponse,
  IdentityVaultsRefreshResponse,
  PairedConnections,
  PairedKeyringSummary,
  PairedVaultSummary,
  PairedVaultsResponse,
} from '../../lib/paired-vaults'
import { extensionPairingIdentity } from './pairing-identity'
import { importKeyringVault } from './pairing-import'
import {
  IdentityVaultRefresh,
  type IdentityVaultRefreshRequest,
} from './identity-vault-refresh'
import { SidePanelSender, SidePanelSenderAdmission } from './side-panel-sender'

type RuntimeMessageListener = Parameters<
  typeof chrome.runtime.onMessage.addListener
>[0]

type PairedVaultsContext = {
  readonly sender: chrome.runtime.MessageSender
  readonly sendResponse: Parameters<RuntimeMessageListener>[2]
}

type DefaultVaultSelectContext = PairedVaultsContext & {
  readonly vaultStoreId: string
}

type IdentityVaultsRefreshContext = PairedVaultsContext & {
  readonly deviceId: string
}

export type PopupSenderCheck = {
  readonly sender: chrome.runtime.MessageSender
  readonly runtimeId: string
  readonly popupUrl: string
}

/** The Nook tab, in any intent; content scripts never match. */
export function isPopupSender({
  sender,
  runtimeId,
  popupUrl,
}: PopupSenderCheck): boolean {
  if (sender.id !== runtimeId || typeof sender.url !== 'string') return false
  const page = new URL(sender.url)
  const popup = new URL(popupUrl)
  return page.origin === popup.origin && page.pathname === popup.pathname
}

/** Only the extension's own pages list or change its vaults: the side
 * panel and the Nook tab; content scripts never do. */
function fromExtensionPage(sender: chrome.runtime.MessageSender): boolean {
  const authTab: PopupSenderCheck = {
    sender,
    runtimeId: chrome.runtime.id,
    popupUrl: chrome.runtime.getURL('popup/index.html'),
  }
  return (
    isPopupSender(authTab) ||
    new SidePanelSender(sender).admission() ===
      SidePanelSenderAdmission.Admitted
  )
}

/** The keyrings the extension joined and the vaults it paired in them. */
async function pairedConnections(): Promise<PairedConnections> {
  const policy = await extensionPairingGrantPolicyReady
  const stored = await extensionPairingIdentity.getPairingStorage()
  const keyrings = policy
    .joinedKeyrings(stored)
    .map((keyring): PairedKeyringSummary => ({
      identityLabel: keyring.identityLabel,
      deviceId: keyring.deviceId,
    }))
  const selected = policy.selectedPairingGrant(stored)
  const defaultStoreId =
    selected.kind === 'selected' ? selected.grant.vaultStoreId : ''
  const vaults = policy.selectedPairingGrantFirst(stored).map((grant) => {
    const summary: PairedVaultSummary = {
      vaultStoreId: grant.vaultStoreId,
      vaultName: grant.vaultName,
      identityLabel: ((v) => (v ? v : ''))(grant.identityLabel),
      deviceId: grant.deviceId,
      isDefault: grant.vaultStoreId === defaultStoreId,
      fillsPasswords: grant.scopes.includes(
        ExtensionConnectScope.PasswordFilling,
      ),
      managesPasskeys: grant.scopes.includes(
        ExtensionConnectScope.PasskeyManagement,
      ),
    }
    return summary
  })
  return { keyrings, vaults }
}

export function handlePairedVaultsQuery({
  sender,
  sendResponse,
}: PairedVaultsContext): boolean {
  if (!fromExtensionPage(sender)) {
    const forbidden: PairedVaultsResponse = {
      ok: false,
      reason: 'forbidden-sender',
    }
    sendResponse(forbidden)
    return false
  }
  void pairedConnections()
    .then(({ keyrings, vaults }) => {
      const response: PairedVaultsResponse = { ok: true, keyrings, vaults }
      sendResponse(response)
    })
    .catch(() => {
      const failed: PairedVaultsResponse = {
        ok: false,
        reason: 'paired-vaults-read-failed',
      }
      sendResponse(failed)
    })
  return true
}

async function refreshIdentityVaults(
  deviceId: string,
): Promise<IdentityVaultsRefreshResponse> {
  const policy = await extensionPairingGrantPolicyReady
  const stored = await extensionPairingIdentity.getPairingStorage()
  const refreshRequest: IdentityVaultRefreshRequest = {
    deviceId,
    keyrings: policy.joinedKeyrings(stored),
    grants: policy.selectedPairingGrantFirst(stored),
    importVault: importKeyringVault,
    sendSessionMessage: (...request) =>
      extensionPairingIdentity.sendSessionMessage(...request),
  }
  const refreshed = await new IdentityVaultRefresh(refreshRequest).refresh()
  if (!refreshed.ok) {
    console.warn('Extension could not refresh its identity', refreshed.reason)
    return refreshed
  }
  const response: IdentityVaultsRefreshResponse = {
    ok: true,
    paired: refreshed.paired,
    awaitingGrant: refreshed.awaitingGrant,
  }
  return response
}

/** After the popup unlocks the extension, pair the vaults its identity
 * gained since; only the popup asks, as for the vault list. */
export function handleIdentityVaultsRefresh({
  sender,
  sendResponse,
  deviceId,
}: IdentityVaultsRefreshContext): boolean {
  if (!fromExtensionPage(sender)) {
    const forbidden: IdentityVaultsRefreshResponse = {
      ok: false,
      reason: 'forbidden-sender',
    }
    sendResponse(forbidden)
    return false
  }
  void refreshIdentityVaults(deviceId)
    .then(sendResponse)
    .catch(() => {
      const failed: IdentityVaultsRefreshResponse = {
        ok: false,
        reason: 'identity-refresh-failed',
      }
      sendResponse(failed)
    })
  return true
}

async function selectDefault(vaultStoreId: string): Promise<void> {
  const policy = await extensionPairingGrantPolicyReady
  const stored = await extensionPairingIdentity.getPairingStorage()
  const selectionArgs: Parameters<typeof policy.defaultVaultSelectionItems>[0] =
    { stored, vaultStoreId }
  await extensionPairingIdentity.setPairingStorage(
    policy.defaultVaultSelectionItems(selectionArgs),
  )
}

export function handleDefaultVaultSelect({
  sender,
  sendResponse,
  vaultStoreId,
}: DefaultVaultSelectContext): boolean {
  if (!fromExtensionPage(sender)) {
    const forbidden: DefaultVaultSelectResponse = {
      ok: false,
      reason: 'forbidden-sender',
    }
    sendResponse(forbidden)
    return false
  }
  void selectDefault(vaultStoreId)
    .then(() => {
      const response: DefaultVaultSelectResponse = { ok: true }
      sendResponse(response)
    })
    .catch(() => {
      const failed: DefaultVaultSelectResponse = {
        ok: false,
        reason: 'default-vault-select-failed',
      }
      sendResponse(failed)
    })
  return true
}
