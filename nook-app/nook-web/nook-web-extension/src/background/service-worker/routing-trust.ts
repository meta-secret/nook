import { simpleVaultRuntime } from '../../lib/simple-vault-runtime'

/** Trust only messages issued by this installed extension runtime. */
export function isExtensionRuntimeSender(
  sender: chrome.runtime.MessageSender,
): boolean {
  return sender.id === chrome.runtime.id
}

/** Trust external messages only when they originate from Simple Vault. */
export class ExternalSenderTrustPolicy {
  /**
   * Uses the same canonical Rust URL admission synchronously when companion
   * WASM has already initialized. User-gesture gated browser APIs must not
   * wait for WASM startup before they are invoked.
   */
  static admitsSynchronouslyIfReady(
    sender: chrome.runtime.MessageSender,
  ): boolean | undefined {
    if (!sender.url) return false
    return simpleVaultRuntime.isRuntimeSimpleVaultUrlIfReady(sender.url)
  }

  static async admits(sender: chrome.runtime.MessageSender): Promise<boolean> {
    if (!sender.url) return false
    return simpleVaultRuntime.isRuntimeSimpleVaultUrl(sender.url)
  }
}
