/* eslint-disable nook-typed-api/no-raw-object-arguments, max-params -- DOM traversal callbacks and generated Rust adapters retain their host-defined shapes. */
import {
  PasswordFormScopeKind,
  PasswordFormUnownedScopeDiscovery,
  type AutocompleteTokenMatchRequest,
  type PasswordFormScope,
  type UnownedAuthContainerRequest,
} from "./password-form-unowned-scope";

export {
  PasswordFormScopeKind,
  type AutocompleteTokenMatchRequest,
  type ControlObservationAssociationRequest,
  type LocalOwnedFormAdjacencyRequest,
  type PasswordFormScope,
  type UnownedAuthContainerRequest,
} from "./password-form-unowned-scope";
import {
  AirbnbLoginModalRouteKind,
  observeAirbnbLoginModalRoute,
  type AirbnbLoginModalRouteRequest,
} from "./airbnb-login-modal-route";
import { type AuthenticationUsernameEvidence } from "./nook-companion-wasm/nook_companion_wasm.js";
import {
  CompanionWasmLabelKind,
  CompanionWasmSessionMessageType,
  type CompanionWasmLabelRequest,
  type CompanionWasmPageInputFieldRequest,
} from "./companion-wasm-runtime-messages";
import {
  CompanionWasmRuntimeDeliveryKind,
  sendCompanionWasmRuntimeMessage,
} from "./companion-wasm-runtime-transport";
import {
  PasswordFormFieldDirectClassification,
  type DirectFieldClassification,
} from "./password-form-field-direct-classification";
import { authenticationFieldIndexCatalog } from "./password-form-owned-field-index";
import {
  AuthenticationWorkflowScopeDiagnosticBuilder,
  DisabledAuthenticationWorkflowScopeDiagnosticSink,
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

type CompanionWasmFieldClassification = DirectFieldClassification;

type AssociatedFormFieldSelectorRequest = {
  selector: string;
  escapedFormId: string;
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

/** Owns this browser host’s resources and interaction lifecycle. */
class PasswordFieldDiscovery extends PasswordFormUnownedScopeDiscovery {
  private readonly directClassification =
    new PasswordFormFieldDirectClassification();
  private readonly companionFieldClassifications = new WeakMap<
    HTMLInputElement,
    CompanionWasmFieldClassification
  >();
  private readonly companionLoginContexts = new WeakMap<
    HTMLInputElement,
    boolean
  >();
  private readonly companionLabels = new Map<string, boolean>();
  private companionStrongestUsernameEvidence:
    AuthenticationUsernameEvidence | false = false;

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
      !("fields" in response) ||
      !("labels" in response)
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
    if ("strongestAuthenticationUsernameEvidence" in response) {
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
            ((control.ownerDocument.defaultView?.HTMLButtonElement &&
              control instanceof
                control.ownerDocument.defaultView.HTMLButtonElement) ||
              (control.ownerDocument.defaultView?.HTMLInputElement &&
                control instanceof
                  control.ownerDocument.defaultView.HTMLInputElement)) &&
            control.form === form,
        )
      : this.formlessAuthenticationAdvanceControlCandidates(field);
    const advanceControlLabels = advanceControls.map((control) =>
      this.localActivationControlLabel(control),
    );
    const [preferredAdvanceControlLabel = advanceControlLabels.join(" ")] = [
      advanceControlLabels.find((label) =>
        this.cachedLabel(CompanionWasmLabelKind.LoginAdvance, label),
      ),
    ];
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
      advanceControlLabel: preferredAdvanceControlLabel,
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

  private companionLabelRequests(
    root: ParentNode,
  ): CompanionWasmLabelRequest[] {
    const labels: CompanionWasmLabelRequest[] = [];
    const add = (kind: CompanionWasmLabelRequest["kind"], value: string) => {
      if (
        !labels.some((label) => label.kind === kind && label.value === value)
      ) {
        labels.push({ kind, value });
      }
    };
    for (const control of root.querySelectorAll<HTMLElement>(
      loginAdvanceControlSelector,
    )) {
      add(
        CompanionWasmLabelKind.LoginAdvance,
        this.localActivationControlLabel(control),
      );
      add(
        CompanionWasmLabelKind.PasskeyControl,
        this.localActivationControlLabel(control),
      );
    }
    for (const checkbox of root.querySelectorAll<HTMLInputElement>(
      'input[type="checkbox"]',
    )) {
      const label = checkbox.labels?.[0];
      const ariaLabel = checkbox.attributes.getNamedItem("aria-label");
      add(
        CompanionWasmLabelKind.ManualCheckpoint,
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
          add(
            CompanionWasmLabelKind.OneTimeCodeAutoSubmitSignal,
            `${attribute}=${handler}`,
          );
      }
    }
    add(
      CompanionWasmLabelKind.EmailVerificationBody,
      ((v) => (v ? v : ""))(root.textContent),
    );
    return labels;
  }

  protected cachedLabel(
    kind: CompanionWasmLabelRequest["kind"],
    value: string,
  ): boolean {
    const cached = this.companionLabels.get(`${kind}:${value}`);
    if (typeof cached === "boolean") return cached;
    const labelRequest: CompanionWasmLabelRequest = { kind, value };
    return !this.directClassificationAvailable()
      ? false
      : this.directClassification.label(labelRequest);
  }

  private directClassificationAvailable(): boolean {
    if (typeof chrome === "object" && Boolean(chrome.runtime?.id)) return false;
    return (
      this.fieldCandidateDiagnosticSink instanceof
        DisabledAuthenticationFieldCandidateDiagnosticSink &&
      this.selectorEntryDiagnosticSink instanceof
        DisabledAuthenticationSelectorEntryDiagnosticSink
    );
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

  protected recordWorkflowScopeDiagnostic(
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
    escapedFormId,
  }: AssociatedFormFieldSelectorRequest): string {
    return selector
      .split(",")
      .map((part) => `${part.trim()}[form="${escapedFormId}"]`)
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

  protected findFields({
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
            ("contains" in root && root.contains(field)))
        ) {
          seen.add(field);
          fields.push(field);
        }
      }
      if (owner.id) {
        const css = owner.ownerDocument.defaultView?.CSS;
        const associatedSelectorRequest: AssociatedFormFieldSelectorRequest = {
          selector,
          escapedFormId: css ? css.escape(owner.id) : owner.id,
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
              ("contains" in root && root.contains(field)))
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
        return left.compareDocumentPosition(right) & 4 ? -1 : 1;
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

  private hasLoginContext(field: HTMLInputElement): boolean {
    const cached = this.companionLoginContexts.get(field);
    if (typeof cached === "boolean") return cached;
    return !this.directClassificationAvailable()
      ? false
      : this.directClassification.loginContext(
          this.loginContextObservation(field),
        );
  }

  protected hasLoginPathContext(field: HTMLInputElement): boolean {
    return this.hasLoginContext(field);
  }
  private pageInputObservation({
    field,
    loginContext,
  }: PageInputClassificationRequest): CompanionWasmFieldClassification | false {
    if (
      this.companionLoginContexts.has(field) &&
      this.companionLoginContexts.get(field) !== loginContext
    )
      return false;
    const classification = this.companionFieldClassifications.get(field);
    if (classification) return classification;
    if (!this.directClassificationAvailable()) return false;
    const observation: CompanionWasmPageInputFieldRequest["observation"] = {
      inputType: field.type,
      disabled: field.disabled,
      readOnly: field.readOnly,
      autocompleteTokens: this.autocompleteTokens(field),
      identityText: this.authenticationFieldIdentityText(field),
      loginContext,
    };
    return this.directClassification.field(observation);
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
    const evidence = this.companionStrongestUsernameEvidence;
    if (evidence) return evidence;
    if (!this.directClassificationAvailable()) {
      throw new Error();
    }
    return this.directClassification.strongestUsernameEvidence(
      this.findUsernameFields(query).map(
        this.authenticationUsernameEvidence.bind(this),
      ),
    );
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
      loginContext: this.hasLoginContext(field),
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
      origin: ((v) => (v ? v : ""))(
        root.ownerDocument?.defaultView?.location.origin ??
          (root.nodeType === 9 ? this.browser.location.origin : ""),
      ),
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
          CompanionWasmLabelKind.OneTimeCodeAutoSubmitSignal,
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
    return this.cachedLabel(
      CompanionWasmLabelKind.OneTimeCodeAutoSubmitSignal,
      signal,
    );
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
    const htmlElement = globalThis.HTMLElement || false;
    const rooted =
      htmlElement &&
      root instanceof htmlElement &&
      root.matches(passkeyControlSelector)
        ? [root]
        : [];
    const controls = [...rooted, ...descendants];
    const candidates = controls.flatMap((control) => {
      const explicitlyMarked = control.hasAttribute(
        "data-nook-passkey-control",
      );
      const labeled = this.localActivationControlLabel(control);
      return explicitlyMarked ||
        (labeled &&
          this.cachedLabel(CompanionWasmLabelKind.PasskeyControl, labeled))
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
}

export const passwordFieldDiscovery = new PasswordFieldDiscovery(globalThis);
