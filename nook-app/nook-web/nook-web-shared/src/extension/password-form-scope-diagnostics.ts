export enum AuthenticationWorkflowScopeDiagnosticDisposition {
  Accepted = "accepted",
  Rejected = "rejected",
}

export enum AuthenticationWorkflowScopeDiagnosticCandidateKind {
  Username = "username",
  Password = "password",
  OneTimeCode = "one-time-code",
}

export enum AuthenticationWorkflowScopeDiagnosticGate {
  NotDocumentShell = "not-document-shell",
  SemanticSubmitControl = "semantic-submit-control",
  UnambiguousLoginActivation = "unambiguous-login-activation",
  LoginPathContext = "login-path-context",
  NoGenericTypeButtonControls = "no-generic-type-button-controls",
  ExplicitAuthenticationSurface = "explicit-authentication-surface",
  UnownedCredentialCluster = "unowned-credential-cluster",
  ForeignScopeNotSwallowed = "foreign-scope-not-swallowed",
}

export enum AuthenticationWorkflowScopeDiagnosticGateOutcome {
  Passed = "passed",
  Failed = "failed",
}

export enum AuthenticationWorkflowScopeDiagnosticSafeLabel {
  Absent = "absent",
  Next = "next",
  Continue = "continue",
  SignIn = "sign-in",
  LogIn = "log-in",
  Verify = "verify",
  Submit = "submit",
  CreateAccount = "create-account",
  Other = "other",
}

export type AuthenticationWorkflowScopeDiagnosticGateResult = {
  readonly gate: AuthenticationWorkflowScopeDiagnosticGate;
  readonly outcome: AuthenticationWorkflowScopeDiagnosticGateOutcome;
};

export type AuthenticationWorkflowScopeDiagnosticAncestor = {
  readonly tag: string;
  readonly idTokens: readonly string[];
  readonly classTokens: readonly string[];
};

export type AuthenticationWorkflowScopeDiagnosticControl = {
  readonly tag: string;
  readonly type: string;
  readonly role: string;
  readonly label: AuthenticationWorkflowScopeDiagnosticSafeLabel;
};

export type AuthenticationWorkflowScopeDiagnostic = {
  readonly disposition: AuthenticationWorkflowScopeDiagnosticDisposition;
  readonly candidateKind: AuthenticationWorkflowScopeDiagnosticCandidateKind;
  readonly candidateCount: number;
  readonly ancestors: readonly AuthenticationWorkflowScopeDiagnosticAncestor[];
  readonly controls: readonly AuthenticationWorkflowScopeDiagnosticControl[];
  readonly gates: readonly AuthenticationWorkflowScopeDiagnosticGateResult[];
};

export type AuthenticationWorkflowScopeDiagnosticRequest = {
  readonly field: HTMLInputElement;
  readonly container: Element;
  readonly candidateKind: AuthenticationWorkflowScopeDiagnosticCandidateKind;
  readonly candidateCount: number;
  readonly controls: readonly Element[];
  readonly gates: readonly AuthenticationWorkflowScopeDiagnosticGateResult[];
  readonly disposition: AuthenticationWorkflowScopeDiagnosticDisposition;
};

type AuthenticationWorkflowScopeDiagnosticAttributeRequest = {
  readonly element: Element;
  readonly name: string;
};

export interface AuthenticationWorkflowScopeDiagnosticSink {
  recordWorkflowScopeDiagnostic(
    diagnostic: AuthenticationWorkflowScopeDiagnostic,
  ): void;
}

/** Owns the disabled production boundary for scope diagnostics. */
export class DisabledAuthenticationWorkflowScopeDiagnosticSink implements AuthenticationWorkflowScopeDiagnosticSink {
  recordWorkflowScopeDiagnostic(
    diagnostic: AuthenticationWorkflowScopeDiagnostic,
  ): void {
    void diagnostic;
  }
}

/** Owns the secret-free DOM projection emitted for a workflow scope attempt. */
export class AuthenticationWorkflowScopeDiagnosticBuilder {
  build(
    request: AuthenticationWorkflowScopeDiagnosticRequest,
  ): AuthenticationWorkflowScopeDiagnostic {
    const ancestors = this.ancestors(request.field);
    const controls = request.controls.map(this.control.bind(this));
    return {
      disposition: request.disposition,
      candidateKind: request.candidateKind,
      candidateCount: request.candidateCount,
      ancestors,
      controls,
      gates: request.gates,
    };
  }

  private ancestors(
    field: HTMLInputElement,
  ): AuthenticationWorkflowScopeDiagnosticAncestor[] {
    const ancestors: AuthenticationWorkflowScopeDiagnosticAncestor[] = [];
    let current = field.parentElement;
    while (current && ancestors.length < 8) {
      const ancestor: AuthenticationWorkflowScopeDiagnosticAncestor = {
        tag: this.token(current.tagName),
        idTokens: this.tokens(current.id),
        classTokens: this.tokens(current.className),
      };
      ancestors.push(ancestor);
      current = current.parentElement;
    }
    return ancestors;
  }

  private control(
    control: Element,
  ): AuthenticationWorkflowScopeDiagnosticControl {
    const typeRequest: AuthenticationWorkflowScopeDiagnosticAttributeRequest = {
      element: control,
      name: "type",
    };
    const roleRequest: AuthenticationWorkflowScopeDiagnosticAttributeRequest = {
      element: control,
      name: "role",
    };
    const type = this.attribute(typeRequest);
    const role = this.attribute(roleRequest);
    return {
      tag: this.token(control.tagName),
      type: this.token(type),
      role: this.token(role),
      label: this.safeLabel(this.staticLabel(control)),
    };
  }

  private staticLabel(control: Element): string {
    const labelledByRequest: AuthenticationWorkflowScopeDiagnosticAttributeRequest =
      {
        element: control,
        name: "aria-labelledby",
      };
    const ariaLabelRequest: AuthenticationWorkflowScopeDiagnosticAttributeRequest =
      {
        element: control,
        name: "aria-label",
      };
    const titleRequest: AuthenticationWorkflowScopeDiagnosticAttributeRequest =
      {
        element: control,
        name: "title",
      };
    const altRequest: AuthenticationWorkflowScopeDiagnosticAttributeRequest = {
      element: control,
      name: "alt",
    };
    const labelledBy = this.attribute(labelledByRequest)
      .split(/\s+/u)
      .filter(Boolean)
      .flatMap((id) => {
        const label = control.ownerDocument.getElementById(id);
        return label ? [this.text(label)] : [];
      })
      .join(" ");
    const value =
      control instanceof HTMLInputElement ||
      control instanceof HTMLButtonElement
        ? control.value
        : "";
    return [
      this.text(control),
      this.attribute(ariaLabelRequest),
      this.attribute(titleRequest),
      this.attribute(altRequest),
      value,
      labelledBy,
    ].join(" ");
  }

  private safeLabel(
    value: string,
  ): AuthenticationWorkflowScopeDiagnosticSafeLabel {
    const normalized = value.trim().replace(/\s+/gu, " ").toLowerCase();
    switch (normalized) {
      case "next":
        return AuthenticationWorkflowScopeDiagnosticSafeLabel.Next;
      case "continue":
        return AuthenticationWorkflowScopeDiagnosticSafeLabel.Continue;
      case "sign in":
        return AuthenticationWorkflowScopeDiagnosticSafeLabel.SignIn;
      case "log in":
        return AuthenticationWorkflowScopeDiagnosticSafeLabel.LogIn;
      case "verify":
        return AuthenticationWorkflowScopeDiagnosticSafeLabel.Verify;
      case "submit":
        return AuthenticationWorkflowScopeDiagnosticSafeLabel.Submit;
      case "create account":
        return AuthenticationWorkflowScopeDiagnosticSafeLabel.CreateAccount;
      case "":
        return AuthenticationWorkflowScopeDiagnosticSafeLabel.Absent;
      default:
        return AuthenticationWorkflowScopeDiagnosticSafeLabel.Other;
    }
  }

  private tokens(value: string): string[] {
    return value
      .split(/\s+/u)
      .filter((token) => /^[a-z][a-z0-9_-]{0,63}$/iu.test(token))
      .map(this.token.bind(this))
      .filter(Boolean)
      .slice(0, 8);
  }

  private token(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9_-]/gu, "")
      .slice(0, 64);
  }

  private attribute(
    request: AuthenticationWorkflowScopeDiagnosticAttributeRequest,
  ): string {
    const value = request.element.getAttribute(request.name);
    return typeof value === "string" ? value : "";
  }

  private text(element: Element): string {
    const value = element.textContent;
    return typeof value === "string" ? value : "";
  }
}
