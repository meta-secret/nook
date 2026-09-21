export enum CompanionWasmStartupStage {
  Embedded = "embedded",
  ExtensionOrigin = "extension-origin",
}

export enum CompanionWasmStartupOutcome {
  Failed = "failed",
  Succeeded = "succeeded",
}

export enum CompanionWasmStartupFailureKind {
  Compile = "compile",
  ExtensionOrigin = "extension-origin",
}

export enum CompanionWasmHostRequestKind {
  CompileCompanionModule = "compile-companion-module",
}

export enum CompanionWasmHostResponseKind {
  Compiled = "compiled",
  Failed = "failed",
}

export const COMPANION_WASM_HOST_RESOURCE_PATH =
  "content/companion-wasm-host.html";
export const COMPANION_WASM_RESOURCE_PATH =
  "content/nook_companion_wasm_bg.wasm";

export type CompanionWasmHostRequest = {
  readonly kind: CompanionWasmHostRequestKind.CompileCompanionModule;
};

type CompanionWasmHostTransportRecord = {
  readonly kind?: string;
  readonly resourceUrl?: string;
  readonly module?: WebAssembly.Module | string;
};

export type CompanionWasmHostTransportValue =
  CompanionWasmHostTransportRecord | string | number | boolean;

export type CompanionWasmHostResponse =
  | {
      readonly kind: CompanionWasmHostResponseKind.Compiled;
      readonly resourceUrl: string;
      readonly module: WebAssembly.Module;
    }
  | { readonly kind: CompanionWasmHostResponseKind.Failed };

enum CompanionWasmHostResponseTransportKind {
  ParentWindow = "parent-window",
  Port = "port",
}

type CompanionWasmHostResponseTransportSender =
  | {
      readonly kind: CompanionWasmHostResponseTransportKind.ParentWindow;
      readonly parentWindow: CompanionWasmHostParentWindow;
      readonly targetOrigin: string;
    }
  | {
      readonly kind: CompanionWasmHostResponseTransportKind.Port;
      readonly port: MessagePort;
    };

export type CompanionWasmHostResponseTransportRequest = {
  readonly event: MessageEvent<CompanionWasmHostTransportValue>;
  readonly parentWindow: CompanionWasmHostParentWindow;
  readonly targetOrigin: string;
};

export type CompanionWasmHostParentWindow = {
  postMessage(message: CompanionWasmHostResponse, targetOrigin: string): void;
};

/** Keeps host responses on a transferable channel across isolated worlds. */
export class CompanionWasmHostResponseTransport {
  private constructor(
    private readonly sender: CompanionWasmHostResponseTransportSender,
  ) {}

  static fromRequest({
    event,
    parentWindow,
    targetOrigin,
  }: CompanionWasmHostResponseTransportRequest): CompanionWasmHostResponseTransport {
    const port = event.ports[0];
    if (port) {
      return new CompanionWasmHostResponseTransport({
        kind: CompanionWasmHostResponseTransportKind.Port,
        port,
      });
    }
    return new CompanionWasmHostResponseTransport({
      kind: CompanionWasmHostResponseTransportKind.ParentWindow,
      parentWindow,
      targetOrigin,
    });
  }

  send(message: CompanionWasmHostResponse): void {
    switch (this.sender.kind) {
      case CompanionWasmHostResponseTransportKind.Port:
        this.sender.port.postMessage(message);
        return;
      case CompanionWasmHostResponseTransportKind.ParentWindow:
        this.sender.parentWindow.postMessage(message, this.sender.targetOrigin);
        return;
    }
  }
}

export enum CompanionWasmHostDiagnosticPhase {
  IframeLoad = "iframe-load",
  RequestReceipt = "request-receipt",
  HostCompile = "host-compile",
  ResponseSend = "response-send",
  SourceAdmission = "source-admission",
  OriginAdmission = "origin-admission",
  ResourceAdmission = "resource-admission",
  ModuleAdmission = "module-admission",
  Timeout = "timeout",
}

export enum CompanionWasmHostDiagnosticOutcome {
  Started = "started",
  Succeeded = "succeeded",
  Rejected = "rejected",
  Skipped = "skipped",
  Failed = "failed",
  TimedOut = "timed-out",
}

export type CompanionWasmHostDiagnostic = {
  readonly phase: CompanionWasmHostDiagnosticPhase;
  readonly outcome: CompanionWasmHostDiagnosticOutcome;
};

declare const __NOOK_EXTENSION_DIAGNOSTICS_ENABLED__: boolean;

/** Emits only secret-free phase names for local extension diagnostics. */
export class CompanionWasmHostDiagnosticSink {
  record(diagnostic: CompanionWasmHostDiagnostic): void {
    if (!this.diagnosticsEnabled()) {
      return;
    }
    console.info("[Nook] companion WASM host", diagnostic);
  }

  private diagnosticsEnabled(): boolean {
    try {
      return (
        typeof __NOOK_EXTENSION_DIAGNOSTICS_ENABLED__ === "boolean" &&
        __NOOK_EXTENSION_DIAGNOSTICS_ENABLED__
      );
    } catch {
      return false;
    }
  }
}

export enum CompanionWasmHostAdmissionKind {
  Rejected = "rejected",
  Accepted = "accepted",
  Failed = "failed",
}

export type CompanionWasmHostRequestAdmissionRequest = {
  readonly event: MessageEvent<CompanionWasmHostTransportValue>;
  readonly expectedSource: MessageEventSource;
};

export type CompanionWasmHostRequestAdmission =
  | { readonly kind: CompanionWasmHostAdmissionKind.Rejected }
  | { readonly kind: CompanionWasmHostAdmissionKind.Accepted };

export type CompanionWasmHostResponseAdmissionRequest = {
  readonly event: MessageEvent<CompanionWasmHostTransportValue>;
  readonly expectedSource: MessageEventSource;
  readonly expectedOrigin: string;
  readonly expectedResourceUrl: string;
};

export type CompanionWasmHostPortResponseAdmissionRequest = {
  readonly data: CompanionWasmHostTransportValue;
  readonly expectedResourceUrl: string;
};

export type CompanionWasmHostResponseAdmission =
  | { readonly kind: CompanionWasmHostAdmissionKind.Rejected }
  | { readonly kind: CompanionWasmHostAdmissionKind.Failed }
  | {
      readonly kind: CompanionWasmHostAdmissionKind.Accepted;
      readonly module: WebAssembly.Module;
    };

/** Owns the source, origin, resource, and module checks for the host handshake. */
export class CompanionWasmHostMessageAdmission {
  admitRequest({
    event,
    expectedSource,
  }: CompanionWasmHostRequestAdmissionRequest): CompanionWasmHostRequestAdmission {
    if (
      event.source !== expectedSource ||
      this.requestKind(event.data) !==
        CompanionWasmHostRequestKind.CompileCompanionModule
    ) {
      return { kind: CompanionWasmHostAdmissionKind.Rejected };
    }
    return { kind: CompanionWasmHostAdmissionKind.Accepted };
  }

  admitResponse({
    event,
    expectedSource,
    expectedOrigin,
    expectedResourceUrl,
  }: CompanionWasmHostResponseAdmissionRequest): CompanionWasmHostResponseAdmission {
    if (event.source !== expectedSource || event.origin !== expectedOrigin) {
      return { kind: CompanionWasmHostAdmissionKind.Rejected };
    }
    return this.admitResponseData({
      data: event.data,
      expectedResourceUrl,
    });
  }

  admitPortResponse({
    data,
    expectedResourceUrl,
  }: CompanionWasmHostPortResponseAdmissionRequest): CompanionWasmHostResponseAdmission {
    return this.admitResponseData({ data, expectedResourceUrl });
  }

  private admitResponseData({
    data,
    expectedResourceUrl,
  }: CompanionWasmHostPortResponseAdmissionRequest): CompanionWasmHostResponseAdmission {
    const response = this.responseShape(data);
    if (response.kind === CompanionWasmHostAdmissionKind.Rejected) {
      return response;
    }
    if (response.kind === CompanionWasmHostAdmissionKind.Failed) {
      return response;
    }
    if (response.resourceUrl !== expectedResourceUrl) {
      return { kind: CompanionWasmHostAdmissionKind.Rejected };
    }
    return {
      kind: CompanionWasmHostAdmissionKind.Accepted,
      module: response.module,
    };
  }

  private requestKind(
    value: CompanionWasmHostTransportValue,
  ): CompanionWasmHostRequestKind | false {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }
    return value.kind === CompanionWasmHostRequestKind.CompileCompanionModule
      ? CompanionWasmHostRequestKind.CompileCompanionModule
      : false;
  }

  private responseShape(value: CompanionWasmHostTransportValue):
    | { readonly kind: CompanionWasmHostAdmissionKind.Rejected }
    | { readonly kind: CompanionWasmHostAdmissionKind.Failed }
    | {
        readonly kind: CompanionWasmHostAdmissionKind.Accepted;
        readonly resourceUrl: string;
        readonly module: WebAssembly.Module;
      } {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { kind: CompanionWasmHostAdmissionKind.Rejected };
    }
    const responseKind = value.kind;
    if (responseKind === CompanionWasmHostResponseKind.Failed) {
      return { kind: CompanionWasmHostAdmissionKind.Failed };
    }
    if (responseKind !== CompanionWasmHostResponseKind.Compiled) {
      return { kind: CompanionWasmHostAdmissionKind.Rejected };
    }
    const resourceUrl = value.resourceUrl;
    const module = value.module;
    const moduleCandidate = module ? module : false;
    if (
      typeof resourceUrl !== "string" ||
      !this.isWebAssemblyModule(moduleCandidate)
    ) {
      return { kind: CompanionWasmHostAdmissionKind.Rejected };
    }
    return {
      kind: CompanionWasmHostAdmissionKind.Accepted,
      resourceUrl,
      module: moduleCandidate,
    };
  }

  private isWebAssemblyModule(
    value: WebAssembly.Module | string | false,
  ): value is WebAssembly.Module {
    if (!value || typeof value === "string") {
      return false;
    }
    try {
      WebAssembly.Module.exports(value);
      return true;
    } catch {
      return false;
    }
  }
}

export type CompanionWasmStartupDiagnostic =
  | {
      readonly stage: CompanionWasmStartupStage.Embedded;
      readonly outcome: CompanionWasmStartupOutcome.Failed;
      readonly failure: CompanionWasmStartupFailureKind.Compile;
    }
  | {
      readonly stage: CompanionWasmStartupStage.ExtensionOrigin;
      readonly outcome: CompanionWasmStartupOutcome.Failed;
      readonly failure: CompanionWasmStartupFailureKind.ExtensionOrigin;
    }
  | {
      readonly stage: CompanionWasmStartupStage.ExtensionOrigin;
      readonly outcome: CompanionWasmStartupOutcome.Succeeded;
    };

export interface CompanionWasmStartupDiagnostics {
  record(diagnostic: CompanionWasmStartupDiagnostic): void;
}

export type CompanionWasmStartupRequest = {
  readonly initializeEmbeddedCompanionWasm: () => Promise<void>;
  readonly loadExtensionOriginCompanionWasmModule: () => Promise<WebAssembly.Module>;
  readonly initializeExtensionOriginCompanionWasm: (
    module: WebAssembly.Module,
  ) => Promise<void>;
  readonly diagnostics: CompanionWasmStartupDiagnostics;
};

/** Owns the two-stage browser startup and embedded CSP recovery. */
export class CompanionWasmStartup {
  private embeddedInitializationCanRetry(error: Error): boolean {
    if (error instanceof WebAssembly.CompileError) {
      return true
    }
    return (
      error instanceof TypeError &&
      error.message
        .toLowerCase()
        .includes('wasm code generation disallowed by embedder')
    )
  }

  async initialize({
    initializeEmbeddedCompanionWasm,
    loadExtensionOriginCompanionWasmModule,
    initializeExtensionOriginCompanionWasm,
    diagnostics,
  }: CompanionWasmStartupRequest): Promise<void> {
    try {
      await initializeEmbeddedCompanionWasm();
      return;
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !this.embeddedInitializationCanRetry(error)
      ) {
        throw error;
      }
      const diagnostic: CompanionWasmStartupDiagnostic = {
        stage: CompanionWasmStartupStage.Embedded,
        outcome: CompanionWasmStartupOutcome.Failed,
        failure: CompanionWasmStartupFailureKind.Compile,
      };
      diagnostics.record(diagnostic);
    }

    try {
      const module = await loadExtensionOriginCompanionWasmModule();
      await initializeExtensionOriginCompanionWasm(module);
      const diagnostic: CompanionWasmStartupDiagnostic = {
        stage: CompanionWasmStartupStage.ExtensionOrigin,
        outcome: CompanionWasmStartupOutcome.Succeeded,
      };
      diagnostics.record(diagnostic);
    } catch (error) {
      const diagnostic: CompanionWasmStartupDiagnostic = {
        stage: CompanionWasmStartupStage.ExtensionOrigin,
        outcome: CompanionWasmStartupOutcome.Failed,
        failure: CompanionWasmStartupFailureKind.ExtensionOrigin,
      };
      diagnostics.record(diagnostic);
      throw error;
    }
  }
}
