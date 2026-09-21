import { AuthenticationInputSurface } from "./authentication-input-surface";
import {
  AirbnbLoginModalRouteKind,
  observeAirbnbLoginModalRoute,
  type AirbnbLoginModalRouteRequest,
} from "./airbnb-login-modal-route";
import {
  type AuthenticationUsernameEvidence,
} from "./nook-companion-wasm/nook_companion_wasm.js";
import {
  CompanionWasmSessionMessageType,
  type CompanionWasmLabelRequest,
  type CompanionWasmPageInputFieldRequest,
} from "./companion-wasm-runtime-messages";
import {
  CompanionWasmRuntimeDeliveryKind,
  sendCompanionWasmRuntimeMessage,
} from "./companion-wasm-runtime-transport";
import { AuthenticationContainerIdentity } from "./password-form-container-identity";
import { authenticationFieldIndexCatalog } from "./password-form-owned-field-index";
import {
  AuthenticationWorkflowScopeDiagnosticBuilder,
  AuthenticationWorkflowScopeDiagnosticCandidateKind,
  AuthenticationWorkflowScopeDiagnosticDisposition,
  AuthenticationWorkflowScopeDiagnosticGate,
  AuthenticationWorkflowScopeDiagnosticGateOutcome,
  DisabledAuthenticationWorkflowScopeDiagnosticSink,
  type AuthenticationWorkflowScopeDiagnosticGateResult,
  type AuthenticationWorkflowScopeDiagnosticSink,
} from "./password-form-scope-diagnostics";
import {
  AuthenticationFieldCandidateDiagnosticBuilder,
  AuthenticationFieldCandidateDisposition,
  AuthenticationFieldCandidateKind,
  AuthenticationFieldCandidateSelectorMatch,
  DisabledAuthenticationFieldCandidateDiagnosticSink,
  type AuthenticationFieldCandidateDiagnosticSink,
} from "./password-form-field-candidate-diagnostics";
import {
  AuthenticationSelectorEntryDiagnosticBuilder,
  DisabledAuthenticationSelectorEntryDiagnosticSink,
  type AuthenticationSelectorEntryDiagnosticSink,
} from "./password-form-selector-entry-diagnostics";

export enum PasswordFormScopeKind {
  Owned = "owned",
  Unowned = "unowned",
}

export type PasswordFormScope =
  | { kind: PasswordFormScopeKind.Owned; owner: HTMLFormElement }
  | { kind: PasswordFormScopeKind.Unowned };

export type PasswordFieldQuery = {
  root?: ParentNode;
  formScope?: PasswordFormScope;
};

type OwnedObservationBoundsRequest = {
  root: ParentNode;
  formScope: PasswordFormScope;
};

type ScopedInputFieldQuery = {
  root: ParentNode;
  selector: string;
  formScope?: PasswordFormScope;
};

type PageInputClassificationRequest = {
  field: HTMLInputElement;
  loginContext: boolean;
};

type CompanionWasmFieldClassification = {
  readonly authenticationUsernameEvidence: AuthenticationUsernameEvidence;
  readonly looksLikeUsernameField: boolean;
  readonly looksLikeOneTimeCodeField: boolean;
};

type AssociatedFormFieldSelectorRequest = {
  selector: string;
  formId: string;
};

type TypeButtonPromotionScopeRequest = {
  container: Element;
  field: HTMLElement;
};

export type LocalOwnedLoginObservationRootRequest = {
  owner: HTMLFormElement;
  passwordFields: readonly HTMLInputElement[];
  usernameFields: readonly HTMLInputElement[];
  oneTimeCodeFields: readonly HTMLInputElement[];
};

export type LocalOwnedLoginObservationRootsRequest = {
  owner: HTMLFormElement;
  passwordFields: readonly HTMLInputElement[];
  usernameFields: readonly HTMLInputElement[];
  oneTimeCodeFields: readonly HTMLInputElement[];
};

export type UnownedAuthContainerRequest = {
  field: HTMLElement;
  root: ParentNode;
};

export type AutocompleteTokenMatchRequest = {
  field: HTMLInputElement;
  expected: string;
};

export const usernameFieldSelectors = [
  'input[autocomplete~="username" i]',
  'input[autocomplete~="email" i]',
  'input[type="email"]',
  'input[type="text"][autocomplete~="username" i]',
  'input[type="text"][name*="user" i]',
  'input[type="text"][name*="email" i]',
  'input[type="text"][id*="username" i]',
  'input[type="text"][id*="email" i]',
  // Popular SSO / email-first login field names (Microsoft, Google, Slack, …).
  'input[name="loginfmt" i]',
  'input[name="identifier" i]',
  'input[name*="login" i]',
  'input[id*="login" i]',
  'input[name*="account" i]',
  'input[id*="account" i]',
  'input[data-qa="login_email"]',
  'input[data-qa*="login_email" i]',
  'input[data-testid*="login" i][type="email"]',
  'input[data-testid*="username" i]',
  'input[data-testid*="email" i]',
] as const;

const usernameCandidateSelector = [
  "input:not([type])",
  'input[type="text"]',
  'input[type="email"]',
  'input[type="tel"]',
].join(",");

export const oneTimeCodeFieldSelectors = [
  'input[autocomplete~="one-time-code" i]',
  'input[name*="totp" i]',
  'input[id*="totp" i]',
  'input[name*="otp" i]',
  'input[id*="otp" i]',
  'input[name*="2fa" i]',
  'input[id*="2fa" i]',
  'input[name*="mfa" i]',
  'input[id*="mfa" i]',
  'input[name*="auth-code" i]',
  'input[id*="auth-code" i]',
  'input[name*="verification-code" i]',
  'input[id*="verification-code" i]',
] as const;

const oneTimeCodeCandidateSelector = [
  "input:not([type])",
  'input[type="text"]',
  'input[type="tel"]',
  'input[type="number"]',
  'input[type="password"]',
].join(",");

// Google renders the identifier-step Next activation as a roleless wrapper.
const loginAdvanceControlSelector =
  'button[type="submit"], input[type="submit"], button:not([type]), button[type="button"], input[type="button"], [role="button"], #identifierNext';

type OneTimeCodeFieldList = HTMLInputElement[];

export enum PasskeyControlLookupKind {
  Absent = "absent",
  Found = "found",
}

export type PasskeyControlLookup =
  | { kind: PasskeyControlLookupKind.Absent }
  | { kind: PasskeyControlLookupKind.Found; control: HTMLElement };

export type PasskeyControlCandidate = {
  control: HTMLElement;
  explicitlyMarked: boolean;
};

const passkeyControlSelector =
  '[data-nook-passkey-control], button, a[href], [role="button"], input[type="button"], input[type="submit"]';

// Keep the same wrapper eligible when finding the nearest unowned auth scope.
const formlessTypeButtonSelector =
  'button[type="button"], input[type="button"], [role="button"], #identifierNext';

export type LocalOwnedFormAdjacencyRequest = {
  control: HTMLElement;
  owner: HTMLFormElement;
};

export type ControlObservationAssociationRequest = {
  control: HTMLElement;
  formScope: PasswordFormScope;
  root: ParentNode;
};

/** Owns this browser host’s resources and interaction lifecycle. */
class PasswordFieldDiscovery extends AuthenticationInputSurface {
  private readonly companionFieldClassifications = new WeakMap<
    HTMLInputElement,
    CompanionWasmFieldClassification
  >();
  private readonly companionLoginContexts = new WeakMap<
    HTMLInputElement,
    boolean
  >();
  private readonly companionLabels = new Map<string, boolean>();
  private companionStrongestUsernameEvidence: AuthenticationUsernameEvidence | false = false;

  async prepareCompanionClassification(root: ParentNode): Promise<void> {
    const fields = Array.from(root.querySelectorAll<HTMLInputElement>("input"));
    const fieldRequests: CompanionWasmPageInputFieldRequest[] = fields.map(
      (field, index) => ({
        index,
        observation: {
          inputType: field.type,
          disabled: field.disabled,
          readOnly: field.readOnly,
          autocompleteTokens: this.autocompleteTokens(field),
          identityText: this.authenticationFieldIdentityText(field),
          loginContext: false,
        },
        loginContextObservation: this.loginContextObservation(field),
      }),
    );
    const labels = this.companionLabelRequests(root);
    const delivery = await sendCompanionWasmRuntimeMessage(this.browser, {
      type: CompanionWasmSessionMessageType.ClassifyPageInputs,
      payload: { fields: fieldRequests, labels },
      origin: this.browser.location.origin,
    });
    if (delivery.kind !== CompanionWasmRuntimeDeliveryKind.Delivered) return;
    const response = delivery.response;
    if (
      !response ||
      typeof response !== "object" ||
      !('fields' in response) ||
      !('labels' in response)
    ) {
      return;
    }
    for (const field of response.fields) {
      const element = fields[field.index];
      if (!element) continue;
      this.companionLoginContexts.set(element, field.loginContext);
      this.companionFieldClassifications.set(element, {
        authenticationUsernameEvidence: field.authenticationUsernameEvidence,
        looksLikeUsernameField: field.looksLikeUsernameField,
        looksLikeOneTimeCodeField: field.looksLikeOneTimeCodeField,
      });
    }
    if ('strongestAuthenticationUsernameEvidence' in response) {
      this.companionStrongestUsernameEvidence =
        response.strongestAuthenticationUsernameEvidence;
    }
    for (const label of response.labels) {
      this.companionLabels.set(`${label.kind}:${label.value}`, label.matches);
    }
  }

  private loginContextObservation(field: HTMLInputElement) {
    const form = field.form;
    const ancestorIdentities: string[] = [];
    let container = field.parentElement;
    let depth = 0;
    while (container && depth < 6) {
      ancestorIdentities.push(
        [
          container.id,
          container.className,
          ((v) => (v ? v : ""))(container.getAttribute("role")),
        ].join(" "),
      );
      container = container.parentElement;
      depth += 1;
    }
    const advanceControls = form
      ? Array.from(
          form.ownerDocument.querySelectorAll<HTMLElement>(
            loginAdvanceControlSelector,
          ),
        ).filter(
          (control) =>
            (control instanceof HTMLButtonElement ||
              control instanceof HTMLInputElement) &&
            control.form === form,
        )
      : this.formlessAuthenticationAdvanceControlCandidates(field);
    return {
      formIdentity: form
        ? [
            form.id,
            form.className,
            ((v) => (v ? v : ""))(form.getAttribute("action")),
            form.name,
          ].join(" ")
        : "",
      ancestorIdentities,
      advanceControlLabel: advanceControls
        .map((control) => this.localActivationControlLabel(control))
        .join(" "),
      pathContext: `${((v) => (v ? v : ""))(field.ownerDocument.defaultView?.location?.pathname)} ${((v) => (v ? v : ""))(field.ownerDocument.defaultView?.location?.hostname)}`,
    };
  }

  private formlessAuthenticationAdvanceControlCandidates(
    field: HTMLInputElement,
  ): HTMLElement[] {
    let container = field.parentElement;
    while (container) {
      const controls = Array.from(
        container.querySelectorAll<HTMLElement>(loginAdvanceControlSelector),
      );
      if (controls.length > 0) return controls;
      container = container.parentElement;
    }
    return [];
  }

  private companionLabelRequests(root: ParentNode): CompanionWasmLabelRequest[] {
    const labels: CompanionWasmLabelRequest[] = [];
    const add = (kind: CompanionWasmLabelRequest["kind"], value: string) => {
      if (!labels.some((label) => label.kind === kind && label.value === value)) {
        labels.push({ kind, value });
      }
    };
    for (const control of root.querySelectorAll<HTMLElement>(
      loginAdvanceControlSelector,
    )) {
      add("login-advance", this.localActivationControlLabel(control));
      add("passkey-control", this.localActivationControlLabel(control));
    }
    for (const checkbox of root.querySelectorAll<HTMLInputElement>(
      'input[type="checkbox"]',
    )) {
      const label = checkbox.labels?.[0];
      const ariaLabel = checkbox.attributes.getNamedItem("aria-label");
      add(
        "manual-checkpoint",
        label
          ? ((v) => (v ? v : ""))(label.textContent).toLowerCase()
          : ariaLabel
            ? ariaLabel.value.toLowerCase()
            : checkbox.name.toLowerCase(),
      );
    }
    for (const field of root.querySelectorAll<HTMLInputElement>("input")) {
      for (const attribute of ["oninput", "onchange"]) {
        const handler = field.getAttribute(attribute);
        if (typeof handler === "string")
          add("one-time-code-auto-submit-signal", `${attribute}=${handler}`);
      }
    }
    add("email-verification-body", ((v) => (v ? v : ""))(root.textContent));
    return labels;
  }

  private cachedLabel(
    kind: CompanionWasmLabelRequest["kind"],
    value: string,
  ): boolean {
    return this.companionLabels.get(`${kind}:${value}`) === true;
  }

  private readonly workflowScopeDiagnosticBuilder =
    new AuthenticationWorkflowScopeDiagnosticBuilder();
  private workflowScopeDiagnosticSink: AuthenticationWorkflowScopeDiagnosticSink =
    new DisabledAuthenticationWorkflowScopeDiagnosticSink();
  private readonly fieldCandidateDiagnosticBuilder =
    new AuthenticationFieldCandidateDiagnosticBuilder();
  private fieldCandidateDiagnosticSink: AuthenticationFieldCandidateDiagnosticSink =
    new DisabledAuthenticationFieldCandidateDiagnosticSink();
  private readonly selectorEntryDiagnosticBuilder =
    new AuthenticationSelectorEntryDiagnosticBuilder();
  private selectorEntryDiagnosticSink: AuthenticationSelectorEntryDiagnosticSink =
    new DisabledAuthenticationSelectorEntryDiagnosticSink();

  setWorkflowScopeDiagnosticSink(
    sink: AuthenticationWorkflowScopeDiagnosticSink,
  ): void {
    this.workflowScopeDiagnosticSink = sink;
  }

  setFieldCandidateDiagnosticSink(
    sink: AuthenticationFieldCandidateDiagnosticSink,
  ): void {
    this.fieldCandidateDiagnosticSink = sink;
  }

  setSelectorEntryDiagnosticSink(
    sink: AuthenticationSelectorEntryDiagnosticSink,
  ): void {
    this.selectorEntryDiagnosticSink = sink;
  }

  private recordFieldCandidateDiagnostic(
    request: Parameters<
      AuthenticationFieldCandidateDiagnosticBuilder["build"]
    >[0],
  ): void {
    this.fieldCandidateDiagnosticSink.recordFieldCandidateDiagnostic(
      this.fieldCandidateDiagnosticBuilder.build(request),
    );
  }

  private recordSelectorEntryDiagnostic(
    request: Parameters<
      AuthenticationSelectorEntryDiagnosticBuilder["build"]
    >[0],
  ): void {
    this.selectorEntryDiagnosticSink.recordSelectorEntryDiagnostic(
      this.selectorEntryDiagnosticBuilder.build(request),
    );
  }

  private recordWorkflowScopeDiagnostic(
    request: Parameters<
      AuthenticationWorkflowScopeDiagnosticBuilder["build"]
    >[0],
  ): void {
    this.workflowScopeDiagnosticSink.recordWorkflowScopeDiagnostic(
      this.workflowScopeDiagnosticBuilder.build(request),
    );
  }

  private associatedFormFieldSelector({
    selector,
    formId,
  }: AssociatedFormFieldSelectorRequest): string {
    return selector
      .split(",")
      .map((part) => `${part.trim()}[form="${CSS.escape(formId)}"]`)
      .join(",");
  }

  localOwnedLoginObservationRoot({
    owner,
    passwordFields,
    usernameFields,
    oneTimeCodeFields,
  }: LocalOwnedLoginObservationRootRequest): ParentNode {
    const rootsRequest: LocalOwnedLoginObservationRootsRequest = {
      owner,
      passwordFields,
      usernameFields,
      oneTimeCodeFields,
    };
    const roots = this.localOwnedLoginObservationRoots(rootsRequest);
    return roots.length === 1 && roots[0] ? roots[0] : owner.ownerDocument;
  }

  localOwnedLoginObservationRoots({
    owner,
    passwordFields,
    usernameFields,
    oneTimeCodeFields,
  }: LocalOwnedLoginObservationRootsRequest): ParentNode[] {
    const fieldIndexRequest: LocalOwnedLoginObservationRootsRequest = {
      owner,
      passwordFields,
      usernameFields,
      oneTimeCodeFields,
    };
    const {
      passwordFields: ownedPasswordFields,
      usernameFields: ownedUsernameFields,
      oneTimeCodeFields: ownedOneTimeCodeFields,
    } = authenticationFieldIndexCatalog.fields(fieldIndexRequest);
    if (
      ownedPasswordFields.length === 0 ||
      ownedUsernameFields.length === 0 ||
      ownedOneTimeCodeFields.length > 0 ||
      ownedPasswordFields.some((passwordField) => {
        const newPasswordTokenRequest: AutocompleteTokenMatchRequest = {
          field: passwordField,
          expected: "new-password",
        };
        return this.hasAutocompleteToken(newPasswordTokenRequest);
      })
    ) {
      return [owner.ownerDocument];
    }
    // A page-wide native form can own several independent credential surfaces.
    // Emit each explicit local cluster and leave their priority to Rust.
    const roots: ParentNode[] = [];
    for (const passwordField of ownedPasswordFields) {
      let container = passwordField.parentElement;
      while (container && container !== owner) {
        const currentContainer = container;
        const localUsernameFields = ownedUsernameFields.filter((field) =>
          currentContainer.contains(field),
        );
        const localPasswordFields = ownedPasswordFields.filter((field) =>
          currentContainer.contains(field),
        );
        if (
          localUsernameFields.length > 0 &&
          localPasswordFields.length === 1
        ) {
          if (!owner.contains(container)) break;
          if (!this.containerLooksLikeExplicitAuthSurface(container)) {
            container = container.parentElement;
            continue;
          }
          if (
            this.ownedFormHasManualCheckpoint(owner) &&
            !this.pageHasManualCheckpoint(container)
          ) {
            return [owner.ownerDocument];
          }
          if (!roots.includes(container)) roots.push(container);
          break;
        }
        if (!owner.contains(container)) return [owner.ownerDocument];
        container = container.parentElement;
      }
    }
    return roots.length > 0 ? roots : [owner.ownerDocument];
  }

  ownedObservationIsLocallyBounded({
    root,
    formScope,
  }: OwnedObservationBoundsRequest): boolean {
    return (
      formScope.kind === PasswordFormScopeKind.Owned &&
      root !== formScope.owner &&
      root !== formScope.owner.ownerDocument
    );
  }

  private findFields({
    root,
    selector,
    formScope,
  }: ScopedInputFieldQuery): HTMLInputElement[] {
    if (formScope?.kind === PasswordFormScopeKind.Owned) {
      const owner = formScope.owner;
      const seen = new Set<HTMLInputElement>();
      const fields: HTMLInputElement[] = [];
      for (const field of owner.querySelectorAll<HTMLInputElement>(selector)) {
        if (
          field.form === owner &&
          (root === owner.ownerDocument ||
            (root instanceof Node && root.contains(field)))
        ) {
          seen.add(field);
          fields.push(field);
        }
      }
      if (owner.id) {
        const associatedSelectorRequest: AssociatedFormFieldSelectorRequest = {
          selector,
          formId: owner.id,
        };
        const associated =
          owner.ownerDocument.querySelectorAll<HTMLInputElement>(
            this.associatedFormFieldSelector(associatedSelectorRequest),
          );
        for (const field of associated) {
          if (
            !seen.has(field) &&
            field.form === owner &&
            (root === owner.ownerDocument ||
              (root instanceof Node && root.contains(field)))
          ) {
            seen.add(field);
            fields.push(field);
          }
        }
      }
      fields.sort((...pair) => {
        const left = pair[0];
        const right = pair[1];
        if (left === right) return 0;
        return left.compareDocumentPosition(right) &
          Node.DOCUMENT_POSITION_FOLLOWING
          ? -1
          : 1;
      });
      return fields;
    }
    return Array.from(root.querySelectorAll<HTMLInputElement>(selector)).filter(
      (field) => {
        if (!formScope) return true;
        if (formScope.kind !== PasswordFormScopeKind.Unowned || field.form) {
          return false;
        }
        const containerRequest: UnownedAuthContainerRequest = {
          field,
          root: field.ownerDocument,
        };
        return this.nearestUnownedAuthContainer(containerRequest) === root;
      },
    );
  }

  findPasswordFields({
    root = this.browser.document,
    formScope,
  }: PasswordFieldQuery): HTMLInputElement[] {
    const query: ScopedInputFieldQuery = {
      root,
      selector: 'input[type="password"]',
    };
    if (formScope) query.formScope = formScope;
    return this.findFields(query).flatMap((field) => {
      const accepted =
        !this.inputIsEffectivelyDisabled(field) &&
        field.type === "password" &&
        this.isRenderedInput(field);
      const diagnosticRequest: Parameters<
        AuthenticationFieldCandidateDiagnosticBuilder["build"]
      >[0] = {
        field,
        candidateKind: AuthenticationFieldCandidateKind.Password,
        selectorMatch: AuthenticationFieldCandidateSelectorMatch.Password,
        disposition: accepted
          ? AuthenticationFieldCandidateDisposition.Accepted
          : AuthenticationFieldCandidateDisposition.Rejected,
        root,
      };
      this.recordFieldCandidateDiagnostic(diagnosticRequest);
      return accepted ? [field] : [];
    });
  }

  private formlessAuthenticationAdvanceControls(
    field: HTMLInputElement,
  ): HTMLElement[] {
    let container = field.parentElement;
    while (container) {
      const controls = Array.from(
        container.querySelectorAll<HTMLElement>(loginAdvanceControlSelector),
      );
      const hasLoginAdvanceControl = controls.some((control) =>
        this.cachedLabel(
          "login-advance",
          this.localActivationControlLabel(control),
        ),
      );
      if (hasLoginAdvanceControl) return controls;
      container = container.parentElement;
    }
    return [];
  }

  private hasLoginContext(field: HTMLInputElement): boolean {
    return this.companionLoginContexts.get(field) === true;
  }

  private hasLoginPathContext(field: HTMLInputElement): boolean {
    return this.companionLoginContexts.get(field) === true;
  }
  private pageInputObservation({
    field,
    loginContext,
  }: PageInputClassificationRequest): CompanionWasmFieldClassification | false {
    if (this.companionLoginContexts.get(field) !== loginContext) return false;
    const classification = this.companionFieldClassifications.get(field);
    return classification ? classification : false;
  }

  private authenticationFieldIdentityText(field: HTMLInputElement): string {
    const form = field.form;
    if (!form) {
      return this.rawFieldIdentityText(field);
    }
    const routeRequest: AirbnbLoginModalRouteRequest = { form };
    if (
      observeAirbnbLoginModalRoute(routeRequest).kind !==
      AirbnbLoginModalRouteKind.Present
    ) {
      return this.rawFieldIdentityText(field);
    }
    return [
      ((v) => (v ? v : ""))(field.getAttribute("autocomplete")),
      this.associatedLabelText(field),
    ].join(" ");
  }

  usernameEvidence(
    observation: PasswordFieldQuery,
  ): AuthenticationUsernameEvidence {
    const query: PasswordFieldQuery = {};
    if (observation.root) query.root = observation.root;
    if (observation.formScope) query.formScope = observation.formScope;
    void query;
    const evidence = this.companionStrongestUsernameEvidence;
    if (!evidence) throw new Error();
    return evidence;
  }

  authenticationUsernameEvidence(
    field: HTMLInputElement,
  ): AuthenticationUsernameEvidence {
    const observationRequest: PageInputClassificationRequest = {
      field,
      loginContext: this.hasLoginContext(field),
    };
    const observation = this.pageInputObservation(observationRequest);
    if (!observation) throw new Error();
    return observation.authenticationUsernameEvidence;
  }

  private looksLikeUsernameField(field: HTMLInputElement): boolean {
    if (!this.isRenderedInput(field)) return false;

    const observationRequest: PageInputClassificationRequest = {
      field,
      loginContext: this.hasLoginContext(field),
    };
    const observation = this.pageInputObservation(observationRequest);
    return Boolean(observation && observation.looksLikeUsernameField);
  }

  private looksLikeOneTimeCodeField(field: HTMLInputElement): boolean {
    if (!this.isRenderedInput(field)) return false;

    const observationRequest: PageInputClassificationRequest = {
      field,
      loginContext: false,
    };
    const observation = this.pageInputObservation(observationRequest);
    return Boolean(observation && observation.looksLikeOneTimeCodeField);
  }

  findUsernameFields({
    root = this.browser.document,
    formScope,
  }: PasswordFieldQuery): HTMLInputElement[] {
    const seen = new Set<HTMLInputElement>();
    const fields: HTMLInputElement[] = [];
    const selectorEntryInputCount = root.querySelectorAll("input").length;
    const selectorEntryIdentifierIdPresent = Boolean(
      root.querySelector("#identifierId"),
    );
    const semanticQuery: ScopedInputFieldQuery = {
      root,
      selector: usernameFieldSelectors.join(","),
    };
    const candidateQuery: ScopedInputFieldQuery = {
      root,
      selector: usernameCandidateSelector,
    };
    if (formScope) {
      semanticQuery.formScope = formScope;
      candidateQuery.formScope = formScope;
    }

    for (const candidate of [
      ...this.findFields(semanticQuery).map((field) => ({
        field,
        selectorMatch:
          AuthenticationFieldCandidateSelectorMatch.UsernameSemantic,
      })),
      ...this.findFields(candidateQuery).map((field) => ({
        field,
        selectorMatch:
          AuthenticationFieldCandidateSelectorMatch.UsernameCandidate,
      })),
    ]) {
      const accepted = this.looksLikeUsernameField(candidate.field);
      const diagnosticRequest: Parameters<
        AuthenticationFieldCandidateDiagnosticBuilder["build"]
      >[0] = {
        field: candidate.field,
        candidateKind: AuthenticationFieldCandidateKind.Username,
        selectorMatch: candidate.selectorMatch,
        disposition:
          !seen.has(candidate.field) && accepted
            ? AuthenticationFieldCandidateDisposition.Accepted
            : AuthenticationFieldCandidateDisposition.Rejected,
        root,
      };
      this.recordFieldCandidateDiagnostic(diagnosticRequest);
      if (seen.has(candidate.field) || !accepted) continue;
      seen.add(candidate.field);
      fields.push(candidate.field);
    }
    const selectorEntryDiagnosticRequest: Parameters<
      AuthenticationSelectorEntryDiagnosticBuilder["build"]
    >[0] = {
      origin: this.browser.location.origin,
      root,
      inputCount: selectorEntryInputCount,
      identifierIdPresent: selectorEntryIdentifierIdPresent,
      usernameFieldCount: fields.length,
    };
    this.recordSelectorEntryDiagnostic(selectorEntryDiagnosticRequest);
    return fields;
  }

  findOneTimeCodeFields({
    root = this.browser.document,
    formScope,
  }: PasswordFieldQuery): HTMLInputElement[] {
    const seen = new Set<HTMLInputElement>();
    const fields: HTMLInputElement[] = [];
    const query: ScopedInputFieldQuery = {
      root,
      selector: oneTimeCodeCandidateSelector,
    };
    if (formScope) query.formScope = formScope;

    for (const field of this.findFields(query)) {
      const accepted = this.looksLikeOneTimeCodeField(field);
      const diagnosticRequest: Parameters<
        AuthenticationFieldCandidateDiagnosticBuilder["build"]
      >[0] = {
        field,
        candidateKind: AuthenticationFieldCandidateKind.OneTimeCode,
        selectorMatch:
          AuthenticationFieldCandidateSelectorMatch.OneTimeCodeCandidate,
        disposition:
          !seen.has(field) && accepted
            ? AuthenticationFieldCandidateDisposition.Accepted
            : AuthenticationFieldCandidateDisposition.Rejected,
        root,
      };
      this.recordFieldCandidateDiagnostic(diagnosticRequest);
      if (seen.has(field) || !accepted) continue;
      seen.add(field);
      fields.push(field);
    }
    return fields;
  }

  private fieldHasOneTimeCodeAutoSubmitHandler(
    field: HTMLInputElement,
  ): boolean {
    return ["oninput", "onchange"].some((attribute) => {
      const handler = field.getAttribute(attribute);
      return (
        typeof handler === "string" &&
        this.cachedLabel(
          "one-time-code-auto-submit-signal",
          `${attribute}=${handler}`,
        )
      );
    });
  }

  preferredOneTimeCodeFillField(
    fields: OneTimeCodeFieldList,
  ): HTMLInputElement | false {
    const preferred = fields.find(
      this.fieldHasOneTimeCodeAutoSubmitHandler.bind(this),
    );
    return preferred ? preferred : ((v) => (v ? v : false))(fields[0]);
  }

  hasAutocompleteToken({
    field,
    expected,
  }: AutocompleteTokenMatchRequest): boolean {
    return field.autocomplete
      .toLowerCase()
      .split(/\s+/u)
      .filter(Boolean)
      .includes(expected);
  }

  looksLikeOneTimeCodeAutoSubmitSignal(signal: string): boolean {
    return this.cachedLabel("one-time-code-auto-submit-signal", signal);
  }

  isAuthUsernameField(field: HTMLInputElement): boolean {
    const usernameTokenRequest: AutocompleteTokenMatchRequest = {
      field,
      expected: "username",
    };
    const emailTokenRequest: AutocompleteTokenMatchRequest = {
      field,
      expected: "email",
    };
    return (
      this.hasAutocompleteToken(usernameTokenRequest) ||
      this.hasAutocompleteToken(emailTokenRequest) ||
      this.looksLikeUsernameField(field)
    );
  }

  findPasskeyControls(
    root: ParentNode = this.browser.document,
  ): PasskeyControlCandidate[] {
    const descendants = Array.from(
      ((v) => (v ? v : []))(
        root.querySelectorAll?.<HTMLElement>(passkeyControlSelector),
      ),
    );
    const rooted =
      root instanceof HTMLElement && root.matches(passkeyControlSelector)
        ? [root]
        : [];
    const controls = [...rooted, ...descendants];
    const candidates = controls.flatMap((control) => {
      const explicitlyMarked = control.hasAttribute(
        "data-nook-passkey-control",
      );
      const labeled = this.localActivationControlLabel(control);
      return explicitlyMarked ||
        (labeled && this.cachedLabel("passkey-control", labeled))
        ? [{ control, explicitlyMarked }]
        : [];
    });
    return [
      ...candidates.filter((candidate) => candidate.explicitlyMarked),
      ...candidates.filter((candidate) => !candidate.explicitlyMarked),
    ];
  }

  findPasskeyControl(
    root: ParentNode = this.browser.document,
  ): PasskeyControlLookup {
    // Inputs with a WebAuthn autocomplete token remain credential fields. Only
    // marked or labeled activatable elements count as passkey controls.
    const candidate = this.findPasskeyControls(root)[0];
    if (candidate)
      return {
        kind: PasskeyControlLookupKind.Found,
        control: candidate.control,
      };
    return { kind: PasskeyControlLookupKind.Absent };
  }

  pageHasPasskeyControl(root: ParentNode = this.browser.document): boolean {
    return (
      this.findPasskeyControl(root).kind === PasskeyControlLookupKind.Found
    );
  }

  private localActivationControlLabel(control: Element): string {
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
          "login-advance",
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
        "login-advance",
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

  private containerLooksLikeExplicitAuthSurface(container: Element): boolean {
    return new AuthenticationContainerIdentity(container).present;
  }

  private containerIsFormlessAuthenticationScope({
    container,
    field,
  }: TypeButtonPromotionScopeRequest): boolean {
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
      "email-verification-body",
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
    return this.cachedLabel("manual-checkpoint", labeled.toLowerCase());
  }

  private ownedFormHasManualCheckpoint(owner: HTMLFormElement): boolean {
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

export const passwordFieldDiscovery = new PasswordFieldDiscovery(globalThis);
