import { ExtensionSessionLockedNotice } from '../../../../nook-web-shared/src/extension/runtime-messages'

/** The browser surfaces the lock notice reaches: the vault tabs open on the
 * origins this extension accepts pages from. */
export type ExtensionSessionLockNoticeBrowser = {
  vaultOrigins(): readonly string[]
  vaultTabIds(origins: readonly string[]): Promise<readonly number[]>
  notifyTab(tabId: number): Promise<void>
}

export const chromeLockNoticeBrowser: ExtensionSessionLockNoticeBrowser = {
  vaultOrigins: () =>
    chrome.runtime.getManifest().externally_connectable?.matches ?? [],
  vaultTabIds: async (origins) => {
    const query: chrome.tabs.QueryInfo = { url: [...origins] }
    const tabs = await chrome.tabs.query(query)
    return tabs.flatMap((tab) => (tab.id === undefined ? [] : [tab.id]))
  },
  notifyTab: async (tabId) => {
    await chrome.tabs.sendMessage(tabId, ExtensionSessionLockedNotice.locked)
  },
}

/**
 * Tells every open vault tab that the extension locked; the vault bridge
 * there hands it to the page, and a page whose identity this extension holds
 * locks too. A tab still loading has no bridge yet: it reads the extension's
 * locked state when it starts, so a missed notice changes nothing there.
 */
export async function announceExtensionSessionLocked(
  browser: ExtensionSessionLockNoticeBrowser,
): Promise<void> {
  const origins = browser.vaultOrigins()
  if (origins.length === 0) return
  const tabIds = await browser.vaultTabIds(origins)
  await Promise.all(
    tabIds.map((tabId) => browser.notifyTab(tabId).catch(() => undefined)),
  )
}
