import {
  AuthenticationFieldCandidateFrameKind,
  AuthenticationFieldCandidateRootKind,
} from "./password-form-field-candidate-diagnostics";

export type AuthenticationSelectorEntryDiagnostic = {
  readonly origin: string;
  readonly inputCount: number;
  readonly identifierIdPresent: boolean;
  readonly rootKind: AuthenticationFieldCandidateRootKind;
  readonly frameKind: AuthenticationFieldCandidateFrameKind;
  readonly usernameFieldCount: number;
};

export type AuthenticationSelectorEntryDiagnosticRequest = {
  readonly origin: string;
  readonly root: ParentNode;
  readonly inputCount: number;
  readonly identifierIdPresent: boolean;
  readonly usernameFieldCount: number;
};

export interface AuthenticationSelectorEntryDiagnosticSink {
  recordSelectorEntryDiagnostic(
    diagnostic: AuthenticationSelectorEntryDiagnostic,
  ): void;
}

/** Owns the disabled production boundary for selector-entry diagnostics. */
export class DisabledAuthenticationSelectorEntryDiagnosticSink implements AuthenticationSelectorEntryDiagnosticSink {
  recordSelectorEntryDiagnostic(
    diagnostic: AuthenticationSelectorEntryDiagnostic,
  ): void {
    void diagnostic;
  }
}

/** Owns the secret-free DOM projection emitted at selector entry. */
export class AuthenticationSelectorEntryDiagnosticBuilder {
  build(
    request: AuthenticationSelectorEntryDiagnosticRequest,
  ): AuthenticationSelectorEntryDiagnostic {
    return {
      origin: request.origin,
      inputCount: request.inputCount,
      identifierIdPresent: request.identifierIdPresent,
      rootKind:
        request.root.nodeType === 9
          ? AuthenticationFieldCandidateRootKind.Document
          : AuthenticationFieldCandidateRootKind.Element,
      frameKind: this.frameKind(request.root),
      usernameFieldCount: request.usernameFieldCount,
    };
  }

  private frameKind(root: ParentNode): AuthenticationFieldCandidateFrameKind {
    const ownerDocument = root.ownerDocument;
    if (ownerDocument?.defaultView) {
      const frameWindow = ownerDocument.defaultView;
      return frameWindow === frameWindow.top
        ? AuthenticationFieldCandidateFrameKind.Top
        : AuthenticationFieldCandidateFrameKind.Nested;
    }
    if (root.nodeType === 9 && "defaultView" in root) {
      const frameWindow = root.defaultView;
      if (
        typeof frameWindow === "object" &&
        frameWindow !== null &&
        "top" in frameWindow
      ) {
        return frameWindow === frameWindow.top
          ? AuthenticationFieldCandidateFrameKind.Top
          : AuthenticationFieldCandidateFrameKind.Nested;
      }
    }
    return AuthenticationFieldCandidateFrameKind.Unavailable;
  }
}
