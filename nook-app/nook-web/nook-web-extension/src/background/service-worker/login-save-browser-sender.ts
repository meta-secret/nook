import type { LoginSaveSenderContext } from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

/** Only Chrome's background MessageSender supplies pending-offer identity. */
export class LoginSaveBrowserSender {
  constructor(private readonly sender: chrome.runtime.MessageSender) {}
  read(): LoginSaveSenderContext {
    const { sender } = this
    const tabId = sender.tab?.id
    const frameId = sender.frameId
    switch (true) {
      case typeof tabId === 'number':
        break
      case true:
      default:
        throw new Error('login save sender tab unavailable')
    }
    switch (true) {
      case typeof frameId === 'number':
        break
      case true:
      default:
        throw new Error('login save sender frame unavailable')
    }
    switch (
      Number.isInteger(tabId) &&
      tabId >= 0 &&
      Number.isInteger(frameId) &&
      frameId >= 0
    ) {
      case true:
        return { tab_id: tabId, frame_id: frameId }
      case false:
        throw new Error('login save sender identity invalid')
    }
  }
}
