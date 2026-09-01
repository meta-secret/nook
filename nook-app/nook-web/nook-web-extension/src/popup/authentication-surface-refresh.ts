import { ExtensionRuntimeRequestType } from '../lib/extension-runtime-request-type'

export async function refreshInvokingAuthenticationSurfaceAfterUnlock(
  popupSearch = location.search,
): Promise<void> {
  const message: Parameters<typeof chrome.runtime.sendMessage>[0] = {
    type: ExtensionRuntimeRequestType.RefreshAuthenticationSurfaces,
  }
  await chrome.runtime.sendMessage(message)
  refreshInvokingAuthenticationSurface(popupSearch)
}

export function refreshInvokingAuthenticationSurface(
  popupSearch = location.search,
): void {
  const message: Parameters<typeof chrome.tabs.sendMessage>[1] = {
    type: ExtensionRuntimeRequestType.RefreshAuthenticationSurfaces,
  }
  const refreshTab = (tabId: number): void => {
    void chrome.tabs.sendMessage(tabId, message).catch(() => {
      // Restricted pages may not host the Nook content script.
    })
  }
  const parameters = new URLSearchParams(popupSearch)
  const encodedTabId = parameters.get('invokingTabId')
  if (encodedTabId) {
    const tabId = Number(encodedTabId)
    if (Number.isInteger(tabId) && tabId >= 0) refreshTab(tabId)
    return
  }
  if (parameters.has('invokingTabId')) return
  const query: Parameters<typeof chrome.tabs.query>[0] = {
    active: true,
    currentWindow: true,
  }
  chrome.tabs.query(query, (tabs) => {
    const tabId = tabs.find((tab) => typeof tab.id === 'number')?.id
    if (typeof tabId === 'number') refreshTab(tabId)
  })
}
