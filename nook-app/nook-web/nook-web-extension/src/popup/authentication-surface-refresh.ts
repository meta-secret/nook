import { ExtensionRuntimeRequestType } from '../lib/extension-runtime-request-type'

export function refreshInvokingAuthenticationSurface(): void {
  const query: Parameters<typeof chrome.tabs.query>[0] = {
    active: true,
    currentWindow: true,
  }
  chrome.tabs.query(query, (tabs) => {
    const activeTab = tabs.find(
      (tab) => tab.active && typeof tab.id === 'number',
    )
    if (typeof activeTab?.id !== 'number') return
    const message: Parameters<typeof chrome.tabs.sendMessage>[1] = {
      type: ExtensionRuntimeRequestType.RefreshAuthenticationSurfaces,
    }
    void chrome.tabs.sendMessage(activeTab.id, message).catch(() => {
      // Restricted pages may not host the Nook content script.
    })
  })
}
