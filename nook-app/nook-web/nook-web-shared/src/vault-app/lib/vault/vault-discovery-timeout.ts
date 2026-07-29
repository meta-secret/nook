export const VAULT_ASSESS_TIMEOUT_ERROR_NAME = 'VaultAssessTimeoutError'

export type VaultDiscoveryTimeout = {
  completion: Promise<never>
  cancel(): void
}

export function startVaultDiscoveryTimeout(
  message: string,
  timeoutMs: number,
): VaultDiscoveryTimeout {
  const controller = new AbortController()
  const completion = new Promise<never>((_, reject) => {
    const timer = setTimeout(() => {
      const timeoutError = new Error(message)
      timeoutError.name = VAULT_ASSESS_TIMEOUT_ERROR_NAME
      reject(timeoutError)
    }, timeoutMs)
    controller.signal.addEventListener('abort', () => clearTimeout(timer), {
      once: true,
    })
  })
  return {
    completion,
    cancel: () => controller.abort(),
  }
}
