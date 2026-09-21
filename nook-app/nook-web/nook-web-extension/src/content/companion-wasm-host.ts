import {
  COMPANION_WASM_RESOURCE_PATH,
  CompanionWasmHostDiagnosticOutcome,
  CompanionWasmHostDiagnosticPhase,
  CompanionWasmHostDiagnosticSink,
  CompanionWasmHostAdmissionKind,
  CompanionWasmHostMessageAdmission,
  CompanionWasmHostResponseTransport,
  CompanionWasmHostResponseKind,
  type CompanionWasmHostRequestAdmissionRequest,
  type CompanionWasmHostResponse,
  type CompanionWasmHostTransportValue,
} from '../../../nook-web-shared/src/extension/companion-wasm-startup'

class ExtensionOriginCompanionWasmHost {
  private readonly messageAdmission = new CompanionWasmHostMessageAdmission()
  private readonly diagnostics = new CompanionWasmHostDiagnosticSink()
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
    const sourceAdmission =
      event.source === this.hostWindow.parent
        ? CompanionWasmHostDiagnosticOutcome.Succeeded
        : CompanionWasmHostDiagnosticOutcome.Rejected
    this.diagnostics.record({
      phase: CompanionWasmHostDiagnosticPhase.SourceAdmission,
      outcome: sourceAdmission,
    })
    const admissionRequest: CompanionWasmHostRequestAdmissionRequest = {
      event,
      expectedSource: this.hostWindow.parent,
    }
    const admission = this.messageAdmission.admitRequest(admissionRequest)
    this.diagnostics.record({
      phase: CompanionWasmHostDiagnosticPhase.RequestReceipt,
      outcome:
        admission.kind === CompanionWasmHostAdmissionKind.Accepted
          ? CompanionWasmHostDiagnosticOutcome.Succeeded
          : CompanionWasmHostDiagnosticOutcome.Rejected,
    })
    if (admission.kind !== CompanionWasmHostAdmissionKind.Accepted) {
      return
    }
    const responseTransport = CompanionWasmHostResponseTransport.fromRequest({
      event,
      parentWindow: this.hostWindow.parent,
      targetOrigin: event.origin,
    })
    this.diagnostics.record({
      phase: CompanionWasmHostDiagnosticPhase.HostCompile,
      outcome: CompanionWasmHostDiagnosticOutcome.Started,
    })
    try {
      const response = await fetch(this.companionWasmUrl)
      if (!response.ok) {
        throw new Error('companion WASM resource unavailable')
      }
      const module = await WebAssembly.compile(await response.arrayBuffer())
      this.diagnostics.record({
        phase: CompanionWasmHostDiagnosticPhase.HostCompile,
        outcome: CompanionWasmHostDiagnosticOutcome.Succeeded,
      })
      const message: CompanionWasmHostResponse = {
        kind: CompanionWasmHostResponseKind.Compiled,
        resourceUrl: this.companionWasmUrl,
        module,
      }
      this.sendResponse(message, responseTransport)
    } catch {
      this.diagnostics.record({
        phase: CompanionWasmHostDiagnosticPhase.HostCompile,
        outcome: CompanionWasmHostDiagnosticOutcome.Failed,
      })
      const message: CompanionWasmHostResponse = {
        kind: CompanionWasmHostResponseKind.Failed,
      }
      this.sendResponse(message, responseTransport)
    }
  }

  private sendResponse(
    message: CompanionWasmHostResponse,
    responseTransport: CompanionWasmHostResponseTransport,
  ): void {
    try {
      responseTransport.send(message)
      this.diagnostics.record({
        phase: CompanionWasmHostDiagnosticPhase.ResponseSend,
        outcome: CompanionWasmHostDiagnosticOutcome.Succeeded,
      })
    } catch {
      this.diagnostics.record({
        phase: CompanionWasmHostDiagnosticPhase.ResponseSend,
        outcome: CompanionWasmHostDiagnosticOutcome.Failed,
      })
    }
  }
}

new ExtensionOriginCompanionWasmHost(window).install()
