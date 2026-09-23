/* eslint-disable nook-typed-api/no-raw-object-arguments -- Diagnostic observations are assembled into generated Rust request records here. */
export enum AuthenticationFieldCandidateDisposition {
  Accepted = "accepted",
  Rejected = "rejected",
}

export enum AuthenticationFieldCandidateKind {
  Username = "username",
  Password = "password",
  OneTimeCode = "one-time-code",
}

export enum AuthenticationFieldCandidateSelectorMatch {
  Password = "password-selector",
  UsernameSemantic = "username-semantic-selector",
  UsernameCandidate = "username-candidate-selector",
  OneTimeCodeCandidate = "one-time-code-candidate-selector",
}

export enum AuthenticationFieldCandidateTypeCategory {
  Password = "password",
  Email = "email",
  Text = "text",
  Telephone = "telephone",
  Hidden = "hidden",
  Other = "other",
}

export enum AuthenticationFieldCandidateAutocompleteCategory {
  Absent = "absent",
  Username = "username",
  Email = "email",
  CurrentPassword = "current-password",
  NewPassword = "new-password",
  OneTimeCode = "one-time-code",
  WebAuthn = "webauthn",
  Other = "other",
}

export enum AuthenticationFieldCandidateRenderability {
  Rendered = "rendered",
  HiddenInput = "hidden-input",
  HiddenField = "hidden-field",
  HiddenAncestor = "hidden-ancestor",
  InertAncestor = "inert-ancestor",
  ClosedDialog = "closed-dialog",
  AriaHiddenField = "aria-hidden-field",
  CssHidden = "css-hidden",
}

export enum AuthenticationFieldCandidateRootKind {
  Document = "document",
  Element = "element",
}

export enum AuthenticationFieldCandidateFrameKind {
  Top = "top-frame",
  Nested = "nested-frame",
  Unavailable = "frame-unavailable",
}

export type AuthenticationFieldCandidateAncestor = {
  readonly tag: string;
  readonly idTokens: readonly string[];
  readonly classTokens: readonly string[];
  readonly hidden: boolean;
  readonly inert: boolean;
  readonly ariaHidden: boolean;
  readonly cssHidden: boolean;
};

export type AuthenticationFieldCandidateDiagnostic = {
  readonly disposition: AuthenticationFieldCandidateDisposition;
  readonly candidateKind: AuthenticationFieldCandidateKind;
  readonly selectorMatch: AuthenticationFieldCandidateSelectorMatch;
  readonly typeCategory: AuthenticationFieldCandidateTypeCategory;
  readonly autocompleteCategories: readonly AuthenticationFieldCandidateAutocompleteCategory[];
  readonly disabled: boolean;
  readonly readOnly: boolean;
  readonly renderability: AuthenticationFieldCandidateRenderability;
  readonly ancestors: readonly AuthenticationFieldCandidateAncestor[];
  readonly rootKind: AuthenticationFieldCandidateRootKind;
  readonly frameKind: AuthenticationFieldCandidateFrameKind;
};

export type AuthenticationFieldCandidateDiagnosticRequest = {
  readonly field: HTMLInputElement;
  readonly candidateKind: AuthenticationFieldCandidateKind;
  readonly selectorMatch: AuthenticationFieldCandidateSelectorMatch;
  readonly disposition: AuthenticationFieldCandidateDisposition;
  readonly root: ParentNode;
};

export interface AuthenticationFieldCandidateDiagnosticSink {
  recordFieldCandidateDiagnostic(
    diagnostic: AuthenticationFieldCandidateDiagnostic,
  ): void;
}

/** Owns the disabled production boundary for field candidate diagnostics. */
export class DisabledAuthenticationFieldCandidateDiagnosticSink implements AuthenticationFieldCandidateDiagnosticSink {
  recordFieldCandidateDiagnostic(
    diagnostic: AuthenticationFieldCandidateDiagnostic,
  ): void {
    void diagnostic;
  }
}

/** Owns the secret-free DOM projection emitted for field candidate scans. */
export class AuthenticationFieldCandidateDiagnosticBuilder {
  build(
    request: AuthenticationFieldCandidateDiagnosticRequest,
  ): AuthenticationFieldCandidateDiagnostic {
    return {
      disposition: request.disposition,
      candidateKind: request.candidateKind,
      selectorMatch: request.selectorMatch,
      typeCategory: this.typeCategory(request.field.type),
      autocompleteCategories: this.autocompleteCategories(request.field),
      disabled: request.field.disabled || request.field.matches(":disabled"),
      readOnly: request.field.readOnly,
      renderability: this.renderability(request.field),
      ancestors: this.ancestors(request.field),
      rootKind:
        request.root === request.field.ownerDocument
          ? AuthenticationFieldCandidateRootKind.Document
          : AuthenticationFieldCandidateRootKind.Element,
      frameKind: this.frameKind(request.field),
    };
  }

  private typeCategory(type: string): AuthenticationFieldCandidateTypeCategory {
    switch (type.toLowerCase()) {
      case "password":
        return AuthenticationFieldCandidateTypeCategory.Password;
      case "email":
        return AuthenticationFieldCandidateTypeCategory.Email;
      case "text":
        return AuthenticationFieldCandidateTypeCategory.Text;
      case "tel":
        return AuthenticationFieldCandidateTypeCategory.Telephone;
      case "hidden":
        return AuthenticationFieldCandidateTypeCategory.Hidden;
      default:
        return AuthenticationFieldCandidateTypeCategory.Other;
    }
  }

  private autocompleteCategories(
    field: HTMLInputElement,
  ): AuthenticationFieldCandidateAutocompleteCategory[] {
    const tokens = field.autocomplete
      .toLowerCase()
      .split(/\s+/u)
      .filter(Boolean);
    const categories = tokens.flatMap((token) => {
      switch (token) {
        case "username":
          return [AuthenticationFieldCandidateAutocompleteCategory.Username];
        case "email":
          return [AuthenticationFieldCandidateAutocompleteCategory.Email];
        case "current-password":
          return [
            AuthenticationFieldCandidateAutocompleteCategory.CurrentPassword,
          ];
        case "new-password":
          return [AuthenticationFieldCandidateAutocompleteCategory.NewPassword];
        case "one-time-code":
          return [AuthenticationFieldCandidateAutocompleteCategory.OneTimeCode];
        case "webauthn":
          return [AuthenticationFieldCandidateAutocompleteCategory.WebAuthn];
        default:
          return [AuthenticationFieldCandidateAutocompleteCategory.Other];
      }
    });
    return categories.length > 0
      ? [...new Set(categories)]
      : [AuthenticationFieldCandidateAutocompleteCategory.Absent];
  }

  private renderability(
    field: HTMLInputElement,
  ): AuthenticationFieldCandidateRenderability {
    if (field.type === "hidden")
      return AuthenticationFieldCandidateRenderability.HiddenInput;
    if (field.getAttribute("aria-hidden") === "true")
      return AuthenticationFieldCandidateRenderability.AriaHiddenField;
    let current: HTMLElement = field;
    while (true) {
      if (current.hidden || current.getAttribute("aria-hidden") === "true") {
        return current === field
          ? AuthenticationFieldCandidateRenderability.HiddenField
          : AuthenticationFieldCandidateRenderability.HiddenAncestor;
      }
      if (current.hasAttribute("inert") || current.inert === true)
        return AuthenticationFieldCandidateRenderability.InertAncestor;
      const dialogElement =
        current.ownerDocument.defaultView?.HTMLDialogElement;
      if (dialogElement && current instanceof dialogElement && !current.open)
        return AuthenticationFieldCandidateRenderability.ClosedDialog;
      const style =
        current.ownerDocument.defaultView?.getComputedStyle(current);
      if (style?.display === "none" || style?.visibility === "hidden")
        return AuthenticationFieldCandidateRenderability.CssHidden;
      const parent = current.parentElement;
      if (!parent) break;
      current = parent;
    }
    return AuthenticationFieldCandidateRenderability.Rendered;
  }

  private ancestors(
    field: HTMLInputElement,
  ): AuthenticationFieldCandidateAncestor[] {
    const ancestors: AuthenticationFieldCandidateAncestor[] = [];
    let current = field.parentElement;
    while (current && ancestors.length < 8) {
      const style =
        current.ownerDocument.defaultView?.getComputedStyle(current);
      ancestors.push({
        tag: this.token(current.tagName),
        idTokens: this.tokens(current.id),
        classTokens: this.tokens(current.className),
        hidden: current.hidden === true,
        inert: current.hasAttribute("inert") || current.inert === true,
        ariaHidden: current.getAttribute("aria-hidden") === "true",
        cssHidden: style
          ? style.display === "none" || style.visibility === "hidden"
          : false,
      });
      current = current.parentElement;
    }
    return ancestors;
  }

  private frameKind(
    field: HTMLInputElement,
  ): AuthenticationFieldCandidateFrameKind {
    const window = field.ownerDocument.defaultView;
    if (!window) return AuthenticationFieldCandidateFrameKind.Unavailable;
    return window === window.top
      ? AuthenticationFieldCandidateFrameKind.Top
      : AuthenticationFieldCandidateFrameKind.Nested;
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
}
