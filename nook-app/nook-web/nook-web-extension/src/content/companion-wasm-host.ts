import {
  COMPANION_WASM_RESOURCE_PATH,
  CompanionWasmHostAdmissionKind,
  CompanionWasmHostMessageAdmission,
  CompanionWasmHostResponseKind,
  type CompanionWasmHostRequestAdmissionRequest,
  type CompanionWasmHostResponse,
  type CompanionWasmHostTransportValue,
} from '../../../nook-web-shared/src/extension/companion-wasm-startup'

class ExtensionOriginCompanionWasmHost {
  private readonly messageAdmission = new CompanionWasmHostMessageAdmission()
  private readonly companionWasmUrl = chrome.runtime.getURL(
    COMPANION_WASM_RESOURCE_PATH,
  )

  constructor(private readonly hostWindow: Window) {}

  install(): void {
    this.hostWindow.addEventListener(
      'message',
      this.handleMessageEvent.bind(this),
    )
  }

  private handleMessageEvent(
    event: MessageEvent<CompanionWasmHostTransportValue>,
  ): void {
    void this.handleMessage(event)
  }

  private async handleMessage(
    event: MessageEvent<CompanionWasmHostTransportValue>,
  ): Promise<void> {
    const admissionRequest: CompanionWasmHostRequestAdmissionRequest = {
      event,
      expectedSource: this.hostWindow.parent,
    }
    const admission = this.messageAdmission.admitRequest(admissionRequest)
    if (admission.kind !== CompanionWasmHostAdmissionKind.Accepted) {
      return
    }
    try {
      const response = await fetch(this.companionWasmUrl)
      if (!response.ok) {
        throw new Error('companion WASM resource unavailable')
      }
      const module = await WebAssembly.compile(await response.arrayBuffer())
      const message: CompanionWasmHostResponse = {
        kind: CompanionWasmHostResponseKind.Compiled,
        resourceUrl: this.companionWasmUrl,
        module,
      }
      this.hostWindow.parent.postMessage(message, '*')
    } catch {
      const message: CompanionWasmHostResponse = {
        kind: CompanionWasmHostResponseKind.Failed,
      }
      this.hostWindow.parent.postMessage(message, '*')
    }
  }
}

new ExtensionOriginCompanionWasmHost(window).install()
