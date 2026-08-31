import { ExtensionRuntimeRequestType } from '../lib/extension-runtime-request-type'

export function refreshInvokingAuthenticationSurface(
  popupSearch = location.search,
): void {
  const encodedTabId = new URLSearchParams(popupSearch).get('invokingTabId')
  const tabId = Number(encodedTabId)
  if (!encodedTabId || !Number.isInteger(tabId)) return
  const message: Parameters<typeof chrome.tabs.sendMessage>[1] = {
    type: ExtensionRuntimeRequestType.RefreshAuthenticationSurfaces,
  }
  void chrome.tabs.sendMessage(tabId, message).catch(() => {
    // Restricted pages may not host the Nook content script.
  })
}
