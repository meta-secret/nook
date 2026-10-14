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

/** Only the extension's own pages (the popup) list or change its vaults. */
function fromExtensionPage(sender: chrome.runtime.MessageSender): boolean {
  return sender.id === chrome.runtime.id && !sender.tab
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
