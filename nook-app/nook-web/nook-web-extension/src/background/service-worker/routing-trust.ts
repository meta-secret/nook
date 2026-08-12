import { isRuntimeSimpleVaultUrl } from '../../lib/simple-vault-runtime'

/** Trust only messages issued by this installed extension runtime. */
export function isExtensionRuntimeSender(
  sender: chrome.runtime.MessageSender,
): boolean {
  return sender.id === chrome.runtime.id
}

/** Trust external messages only when they originate from Simple Vault. */
export function isNokeySender(sender: chrome.runtime.MessageSender): boolean {
  if (!sender.url) return false
  return isRuntimeSimpleVaultUrl(sender.url)
}
