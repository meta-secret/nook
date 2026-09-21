/* eslint-disable nook-typed-api/no-raw-object-arguments -- DOM scope discovery retains browser-owned callback shapes. */
import { AuthenticationInputSurface } from "./authentication-input-surface";
import { CompanionWasmLabelKind } from "./companion-wasm-runtime-messages";
import { AuthenticationContainerIdentity } from "./password-form-container-identity";
import {
  AuthenticationWorkflowScopeDiagnosticBuilder,
  AuthenticationWorkflowScopeDiagnosticCandidateKind,
  AuthenticationWorkflowScopeDiagnosticDisposition,
  AuthenticationWorkflowScopeDiagnosticGate,
  AuthenticationWorkflowScopeDiagnosticGateOutcome,
  type AuthenticationWorkflowScopeDiagnosticGateResult,
} from "./password-form-scope-diagnostics";

export enum PasswordFormScopeKind {
  Owned = "owned",
  Unowned = "unowned",
}

export type PasswordFormScope =
  | { kind: PasswordFormScopeKind.Owned; owner: HTMLFormElement }
  | { kind: PasswordFormScopeKind.Unowned };

export type UnownedAuthContainerRequest = {
  field: HTMLElement;
  root: ParentNode;
};

export type AutocompleteTokenMatchRequest = {
  field: HTMLInputElement;
  expected: string;
};

export type LocalOwnedFormAdjacencyRequest = {
  control: HTMLElement;
  owner: HTMLFormElement;
};

export type ControlObservationAssociationRequest = {
  control: HTMLElement;
  formScope: PasswordFormScope;
  root: ParentNode;
};

type ScopedInputFieldQuery = {
  root: ParentNode;
  selector: string;
  formScope?: PasswordFormScope;
};

type TypeButtonPromotionScopeRequest = {
  container: Element;
  field: HTMLElement;
};

const formlessTypeButtonSelector =
  'button[type="button"], input[type="button"], [role="button"], #identifierNext';

/** Discovers bounded unowned authentication scopes and manual checkpoints. */
export abstract class PasswordFormUnownedScopeDiscovery extends AuthenticationInputSurface {
  protected abstract cachedLabel(
    kind: CompanionWasmLabelKind,
    copy: string,
  ): boolean;
  protected abstract hasAutocompleteToken(
    request: AutocompleteTokenMatchRequest,
  ): boolean;
  protected abstract hasLoginPathContext(field: HTMLInputElement): boolean;
  protected abstract recordWorkflowScopeDiagnostic(
    request: Parameters<
      AuthenticationWorkflowScopeDiagnosticBuilder["build"]
    >[0],
  ): void;
  protected abstract findFields(
    request: ScopedInputFieldQuery,
  ): HTMLInputElement[];
  protected localActivationControlLabel(control: Element): string {
    const labelledBy = ((v) => (v ? v : ""))(
      control.getAttribute("aria-labelledby"),
    )
      .split(/\s+/u)
      .filter(Boolean)
      .flatMap((id) => {
        const label = control.ownerDocument.getElementById(id);
        return label ? [((v) => (v ? v : ""))(label.textContent)] : [];
      })
      .join(" ");
    const value =
      control instanceof HTMLInputElement ||
      control instanceof HTMLButtonElement
        ? control.value
        : "";
    return [
      ((v) => (v ? v : ""))(control.textContent),
      ((v) => (v ? v : ""))(control.getAttribute("aria-label")),
      ((v) => (v ? v : ""))(control.getAttribute("title")),
      ((v) => (v ? v : ""))(control.getAttribute("alt")),
      value,
      labelledBy,
    ]
      .join(" ")
      .trim();
  }

  private containerHasGenericTypeButtonControls(container: Element): boolean {
    return this.formlessAuthenticationControls(container).some(
      (control) =>
        !this.cachedLabel(
          CompanionWasmLabelKind.LoginAdvance,
          this.localActivationControlLabel(control),
        ),
    );
  }

  private formlessAuthenticationControls(container: Element): Element[] {
    const controls = Array.from(
      container.querySelectorAll(formlessTypeButtonSelector),
    );
    return controls.filter((control) => {
      const identifierNextWrapper = control.closest("#identifierNext");
      return !identifierNextWrapper || identifierNextWrapper === control;
    });
  }

  private containerHasUnambiguousAuthenticationActivation(
    container: Element,
  ): boolean {
    return this.labeledTypeButtonActivationControls(container).length === 1;
  }

  private labeledTypeButtonActivationControls(container: Element): Element[] {
    return this.formlessAuthenticationControls(container).filter((control) =>
      this.cachedLabel(
        CompanionWasmLabelKind.LoginAdvance,
        this.localActivationControlLabel(control),
      ),
    );
  }

  private containerIsDocumentShell(container: Element): boolean {
    return container === container.ownerDocument.documentElement;
  }

  private unownedCredentialFields(root: ParentNode): HTMLInputElement[] {
    return Array.from(
      root.querySelectorAll<HTMLInputElement>(
        'input[type="password"], input[autocomplete~="username" i], input[autocomplete~="email" i], input[autocomplete~="one-time-code" i]',
      ),
    ).filter((field) => !field.form && this.isRenderedInput(field));
  }

  private containerHasUnownedCredentialCluster(container: Element): boolean {
    const fields = this.unownedCredentialFields(container);
    const passwords = fields.filter(
      (field) => field.type === "password",
    ).length;
    const otps = fields.filter((field) => {
      const tokenRequest: AutocompleteTokenMatchRequest = {
        field,
        expected: "one-time-code",
      };
      return this.hasAutocompleteToken(tokenRequest);
    }).length;
    const usernames = fields.length - passwords - otps;
    return otps > 0 || (usernames > 0 && passwords > 0);
  }

  private containerHasSemanticSubmitControl(container: Element): boolean {
    return Boolean(
      container.querySelector(
        'button[type="submit"], input[type="submit"], button:not([type])',
      ),
    );
  }

  protected containerLooksLikeExplicitAuthSurface(container: Element): boolean {
    return new AuthenticationContainerIdentity(container).present;
  }

  private containerIsFormlessAuthenticationScope({
    container,
    field,
  }: TypeButtonPromotionScopeRequest): boolean {
    if (!(field instanceof HTMLInputElement)) return false;
    const promotionRequest: TypeButtonPromotionScopeRequest = {
      container,
      field,
    };
    const notDocumentShell = !this.containerIsDocumentShell(container);
    const semanticSubmitControl =
      this.containerHasSemanticSubmitControl(container);
    const unambiguousLoginActivation =
      this.containerHasUnambiguousAuthenticationActivation(container);
    const loginPathContext = unambiguousLoginActivation
      ? this.hasLoginPathContext(field)
      : false;
    const noGenericTypeButtonControls =
      !this.containerHasGenericTypeButtonControls(container);
    const explicitAuthenticationSurface =
      this.containerLooksLikeExplicitAuthSurface(container);
    const unownedCredentialCluster =
      this.containerHasUnownedCredentialCluster(container);
    const foreignScopeNotSwallowed =
      !this.typeButtonPromotionSwallowsForeignScope(promotionRequest);
    const scopeAdmitted =
      notDocumentShell &&
      (semanticSubmitControl ||
        (unambiguousLoginActivation &&
          foreignScopeNotSwallowed &&
          (noGenericTypeButtonControls || loginPathContext)) ||
        (explicitAuthenticationSurface && noGenericTypeButtonControls) ||
        (unownedCredentialCluster &&
          noGenericTypeButtonControls &&
          foreignScopeNotSwallowed));
    const gates: AuthenticationWorkflowScopeDiagnosticGateResult[] = [
      {
        gate: AuthenticationWorkflowScopeDiagnosticGate.NotDocumentShell,
        outcome: notDocumentShell
          ? AuthenticationWorkflowScopeDiagnosticGateOutcome.Passed
          : AuthenticationWorkflowScopeDiagnosticGateOutcome.Failed,
      },
      {
        gate: AuthenticationWorkflowScopeDiagnosticGate.SemanticSubmitControl,
        outcome: semanticSubmitControl
          ? AuthenticationWorkflowScopeDiagnosticGateOutcome.Passed
          : AuthenticationWorkflowScopeDiagnosticGateOutcome.Failed,
      },
      {
        gate: AuthenticationWorkflowScopeDiagnosticGate.UnambiguousLoginActivation,
        outcome: unambiguousLoginActivation
          ? AuthenticationWorkflowScopeDiagnosticGateOutcome.Passed
          : AuthenticationWorkflowScopeDiagnosticGateOutcome.Failed,
      },
      {
        gate: AuthenticationWorkflowScopeDiagnosticGate.LoginPathContext,
        outcome: loginPathContext
          ? AuthenticationWorkflowScopeDiagnosticGateOutcome.Passed
          : AuthenticationWorkflowScopeDiagnosticGateOutcome.Failed,
      },
      {
        gate: AuthenticationWorkflowScopeDiagnosticGate.NoGenericTypeButtonControls,
        outcome: noGenericTypeButtonControls
          ? AuthenticationWorkflowScopeDiagnosticGateOutcome.Passed
          : AuthenticationWorkflowScopeDiagnosticGateOutcome.Failed,
      },
      {
        gate: AuthenticationWorkflowScopeDiagnosticGate.ExplicitAuthenticationSurface,
        outcome: explicitAuthenticationSurface
          ? AuthenticationWorkflowScopeDiagnosticGateOutcome.Passed
          : AuthenticationWorkflowScopeDiagnosticGateOutcome.Failed,
      },
      {
        gate: AuthenticationWorkflowScopeDiagnosticGate.UnownedCredentialCluster,
        outcome: unownedCredentialCluster
          ? AuthenticationWorkflowScopeDiagnosticGateOutcome.Passed
          : AuthenticationWorkflowScopeDiagnosticGateOutcome.Failed,
      },
      {
        gate: AuthenticationWorkflowScopeDiagnosticGate.ForeignScopeNotSwallowed,
        outcome: foreignScopeNotSwallowed
          ? AuthenticationWorkflowScopeDiagnosticGateOutcome.Passed
          : AuthenticationWorkflowScopeDiagnosticGateOutcome.Failed,
      },
    ];
    const controls = this.formlessAuthenticationControls(container).slice(
      0,
      16,
    );
    const candidateKind =
      field.type === "password"
        ? AuthenticationWorkflowScopeDiagnosticCandidateKind.Password
        : this.hasAutocompleteToken({ field, expected: "one-time-code" })
          ? AuthenticationWorkflowScopeDiagnosticCandidateKind.OneTimeCode
          : AuthenticationWorkflowScopeDiagnosticCandidateKind.Username;
    const scopeDiagnosticRequest: Parameters<
      AuthenticationWorkflowScopeDiagnosticBuilder["build"]
    >[0] = {
      field,
      container,
      candidateKind,
      candidateCount: this.unownedCredentialFieldCount(container),
      controls,
      gates,
      disposition: scopeAdmitted
        ? AuthenticationWorkflowScopeDiagnosticDisposition.Accepted
        : AuthenticationWorkflowScopeDiagnosticDisposition.Rejected,
    };
    this.recordWorkflowScopeDiagnostic(scopeDiagnosticRequest);
    return scopeAdmitted;
  }

  private unownedCredentialFieldCount(root: ParentNode): number {
    return this.unownedCredentialFields(root).length;
  }

  private typeButtonPromotionSwallowsForeignScope({
    container,
    field,
  }: TypeButtonPromotionScopeRequest): boolean {
    const [activation] = this.labeledTypeButtonActivationControls(container);
    if (!activation) return false;
    let scope = activation.parentElement;
    while (scope && container.contains(scope)) {
      if (
        this.unownedCredentialFieldCount(scope) > 0 &&
        !scope.contains(field)
      ) {
        return true;
      }
      if (scope === container) break;
      scope = scope.parentElement;
    }
    return false;
  }

  nearestUnownedAuthContainer({
    field,
    root,
  }: UnownedAuthContainerRequest): ParentNode {
    let container = field.parentElement;
    while (container && container !== root) {
      const scopeRequest: TypeButtonPromotionScopeRequest = {
        container,
        field,
      };
      if (this.containerIsFormlessAuthenticationScope(scopeRequest)) {
        return container;
      }
      container = container.parentElement;
    }
    const parent = field.parentElement;
    if (parent instanceof HTMLElement && parent !== root) {
      const parentScopeRequest: TypeButtonPromotionScopeRequest = {
        container: parent,
        field,
      };
      if (this.containerIsFormlessAuthenticationScope(parentScopeRequest)) {
        return parent;
      }
    }
    return field;
  }

  isLocallyAdjacentToOwnedForm({
    control,
    owner,
  }: LocalOwnedFormAdjacencyRequest): boolean {
    const containingForm = control.closest("form");
    if (containingForm && containingForm !== owner) {
      return false;
    }
    const panel = owner.parentElement;
    if (
      !panel ||
      panel === owner.ownerDocument.body ||
      panel === owner.ownerDocument.documentElement
    ) {
      return false;
    }
    if (
      (control instanceof HTMLButtonElement ||
        control instanceof HTMLInputElement) &&
      control.form
    ) {
      return false;
    }
    const formsInPanel = Array.from(panel.querySelectorAll("form"));
    return formsInPanel.length === 1 && formsInPanel[0] === owner
      ? panel.contains(control)
      : false;
  }

  controlAssociatesWithObservation({
    control,
    formScope,
  }: ControlObservationAssociationRequest): boolean {
    if (formScope.kind === PasswordFormScopeKind.Owned) {
      const adjacencyRequest: LocalOwnedFormAdjacencyRequest = {
        control,
        owner: formScope.owner,
      };
      if (
        control instanceof HTMLButtonElement ||
        control instanceof HTMLInputElement
      ) {
        return (
          control.form === formScope.owner ||
          this.isLocallyAdjacentToOwnedForm(adjacencyRequest)
        );
      }
      return (
        formScope.owner.contains(control) ||
        this.isLocallyAdjacentToOwnedForm(adjacencyRequest)
      );
    }
    if (
      control instanceof HTMLButtonElement ||
      control instanceof HTMLInputElement
    ) {
      return !control.form;
    }
    return !control.closest("form");
  }

  localUnownedPasskeyContainer({
    field,
    root,
  }: UnownedAuthContainerRequest): ParentNode {
    const documentRoot = field.ownerDocument;
    const nearestRequest: UnownedAuthContainerRequest = { field, root };
    const nearest = this.nearestUnownedAuthContainer(nearestRequest);
    if (
      nearest !== field &&
      nearest !== root &&
      nearest !== documentRoot.body &&
      nearest !== documentRoot.documentElement
    ) {
      return nearest;
    }
    const parent = field.parentElement;
    if (
      parent &&
      parent !== documentRoot.body &&
      parent !== documentRoot.documentElement
    ) {
      return parent;
    }
    return root;
  }

  pageHasManualCheckpoint(root: ParentNode): boolean {
    const doc = ((v) => (v ? v : this.browser.document))(root.ownerDocument);
    if (
      doc.querySelector(
        'iframe[src*="recaptcha" i], iframe[src*="hcaptcha" i], iframe[src*="turnstile" i], iframe[title*="captcha" i], [data-nook-manual-checkpoint]',
      )
    ) {
      return true;
    }
    if (
      Array.from(
        root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
      ).some(this.checkboxHasManualCheckpoint.bind(this))
    )
      return true;
    return this.cachedLabel(
      CompanionWasmLabelKind.EmailVerificationBody,
      ((v) => (v ? v : ""))(root.textContent),
    );
  }

  private checkboxHasManualCheckpoint(checkbox: HTMLInputElement): boolean {
    const label = checkbox.labels?.[0];
    const ariaLabel = checkbox.attributes.getNamedItem("aria-label");
    const labeled = label
      ? ((v) => (v ? v : ""))(label.textContent)
      : ariaLabel
        ? ariaLabel.value
        : checkbox.name;
    return this.cachedLabel(
      CompanionWasmLabelKind.ManualCheckpoint,
      labeled.toLowerCase(),
    );
  }

  protected ownedFormHasManualCheckpoint(owner: HTMLFormElement): boolean {
    const fieldQuery: ScopedInputFieldQuery = {
      root: owner.ownerDocument,
      selector: 'input[type="checkbox"]',
      formScope: { kind: PasswordFormScopeKind.Owned, owner },
    };
    return (
      this.pageHasManualCheckpoint(owner) ||
      this.findFields(fieldQuery).some(
        this.checkboxHasManualCheckpoint.bind(this),
      )
    );
  }
}
