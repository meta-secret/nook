import { ExtensionRuntimeRequestType } from '../lib/extension-runtime-request-type'

export function refreshInvokingAuthenticationSurface(): void {
  const message: Parameters<typeof chrome.runtime.sendMessage>[0] = {
    type: ExtensionRuntimeRequestType.RefreshAuthenticationSurfaces,
  }
  chrome.runtime.sendMessage(message, () => {
    void chrome.runtime.lastError
  })
}
