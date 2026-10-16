import { ExtensionConnectScope } from '../../../../nook-web-shared/src/extension/extension-connect-scope'
import { extensionPairingGrantPolicyReady } from '../pairing-grants'
import type {
  DefaultVaultSelectResponse,
  PairedVaultSummary,
  PairedVaultsResponse,
} from '../../lib/paired-vaults'
import { extensionPairingIdentity } from './pairing-identity'

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

export type PopupSenderCheck = {
  readonly sender: chrome.runtime.MessageSender
  readonly runtimeId: string
  readonly popupUrl: string
}

/** Only the extension's popup lists or changes its vaults, whether it
 * opens from the toolbar or in a tab; content scripts never do. */
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

function fromExtensionPage(sender: chrome.runtime.MessageSender): boolean {
  const check: PopupSenderCheck = {
    sender,
    runtimeId: chrome.runtime.id,
    popupUrl: chrome.runtime.getURL('popup/index.html'),
  }
  return isPopupSender(check)
}

async function pairedVaults(): Promise<PairedVaultSummary[]> {
  const policy = await extensionPairingGrantPolicyReady
  const stored = await extensionPairingIdentity.getPairingStorage()
  const selected = policy.selectedPairingGrant(stored)
  const defaultStoreId =
    selected.kind === 'selected' ? selected.grant.vaultStoreId : ''
  return policy.selectedPairingGrantFirst(stored).map((grant) => {
    const summary: PairedVaultSummary = {
      vaultStoreId: grant.vaultStoreId,
      vaultName: grant.vaultName,
      identityLabel: ((v) => (v ? v : ''))(grant.identityLabel),
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
  void pairedVaults()
    .then((vaults) => {
      const response: PairedVaultsResponse = { ok: true, vaults }
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

/** Make one paired vault the one the extension fills from first. */
export async function selectDefaultPairedVault(
  vaultStoreId: string,
): Promise<void> {
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
  void selectDefaultPairedVault(vaultStoreId)
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
