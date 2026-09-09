import { AuthenticationInputSurface } from "./authentication-input-surface";
import { companionWasmReady } from "./companion-ready";
import {
  NookLoginContextObservation,
  NookPageInputFieldObservation,
  authentication_username_evidence,
  has_login_context,
  looks_like_email_verification_body,
  looks_like_login_advance_control_label,
  looks_like_manual_checkpoint_label,
  looks_like_one_time_code_field,
  looks_like_passkey_control_label,
  looks_like_one_time_code_auto_submit_signal,
  looks_like_username_field,
  parse_page_input_type,
  strongest_authentication_username_evidence,
} from "./nook-companion-wasm/nook_companion_wasm.js";
import type { AuthenticationUsernameEvidence } from "./nook-companion-wasm/nook_companion_wasm.js";
import { AuthenticationContainerIdentity } from "./password-form-container-identity";
import { authenticationFieldIndexCatalog } from "./password-form-owned-field-index";

void companionWasmReady;

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

const loginAdvanceControlSelector =
  'button[type="submit"], input[type="submit"], button:not([type]), button[type="button"], input[type="button"]';

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

const formlessTypeButtonSelector =
  'button[type="button"], input[type="button"], [role="button"]';

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
    const {
      passwordFields: ownedPasswordFields,
      usernameFields: ownedUsernameFields,
      oneTimeCodeFields: ownedOneTimeCodeFields,
    } = authenticationFieldIndexCatalog.fields({
      owner,
      passwordFields,
      usernameFields,
      oneTimeCodeFields,
    });
    const [passwordField] = ownedPasswordFields;
    const [usernameField] = ownedUsernameFields;
    if (
      ownedPasswordFields.length !== 1 ||
      ownedUsernameFields.length !== 1 ||
      ownedOneTimeCodeFields.length > 0 ||
      !passwordField ||
      !usernameField
    ) {
      return owner.ownerDocument;
    }
    // Login pages may expose only autocomplete="on"; an explicit new-password
    // token still identifies a non-login credential surface.
    const newPasswordTokenRequest: AutocompleteTokenMatchRequest = {
      field: passwordField,
      expected: "new-password",
    };
    if (this.hasAutocompleteToken(newPasswordTokenRequest)) {
      return owner.ownerDocument;
    }
    let container = passwordField.parentElement;
    while (container && container !== owner) {
      if (container.contains(usernameField)) {
        if (!owner.contains(container)) return owner.ownerDocument;
        if (!this.containerLooksLikeExplicitAuthSurface(container)) {
          container = container.parentElement;
          continue;
        }
        if (
          this.ownedFormHasManualCheckpoint(owner) &&
          !this.pageHasManualCheckpoint(container)
        ) {
          return owner.ownerDocument;
        }
        return container;
      }
      container = container.parentElement;
    }
    return owner.ownerDocument;
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
    return this.findFields({
      root,
      selector: 'input[type="password"]',
      formScope,
    }).filter(
      (field) =>
        !this.inputIsEffectivelyDisabled(field) &&
        field.type === "password" &&
        this.isRenderedInput(field),
    );
  }

  private hasLoginContext(field: HTMLInputElement): boolean {
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
      : field.parentElement
        ? Array.from(
            field.parentElement.querySelectorAll<HTMLElement>(
              loginAdvanceControlSelector,
            ),
          )
        : [];
    const advanceControlLabels = advanceControls.map((control) =>
      [
        ((v) => (v ? v : ""))(control.textContent),
        ((v) => (v ? v : ""))(control.getAttribute("aria-label")),
        ((v) => (v ? v : ""))(control.getAttribute("title")),
        control instanceof HTMLInputElement ? control.value : "",
      ].join(" "),
    );
    const [authenticationAdvanceControlLabel = advanceControlLabels.join(" ")] =
      [
        advanceControlLabels.find((label) =>
          looks_like_login_advance_control_label(label),
        ),
      ];
    const doc = field.ownerDocument;
    const observation = new NookLoginContextObservation(
      form
        ? [
            form.id,
            form.className,
            ((v) => (v ? v : ""))(form.getAttribute("action")),
            form.name,
          ].join(" ")
        : "",
      ancestorIdentities,
      authenticationAdvanceControlLabel,
      `${((v) => (v ? v : ""))(doc.defaultView?.location?.pathname)} ${((v) => (v ? v : ""))(doc.defaultView?.location?.hostname)}`,
    );
    try {
      return has_login_context(observation);
    } finally {
      observation.free();
    }
  }

  private pageInputObservation({
    field,
    loginContext,
  }: PageInputClassificationRequest): NookPageInputFieldObservation {
    return new NookPageInputFieldObservation(
      parse_page_input_type(field.type),
      field.disabled,
      field.readOnly,
      this.autocompleteTokens(field),
      this.rawFieldIdentityText(field),
      loginContext,
    );
  }

  usernameEvidence(
    observation: PasswordFieldQuery,
  ): AuthenticationUsernameEvidence {
    const evidence = this.findUsernameFields({
      root: observation.root,
      formScope: observation.formScope,
    }).map(this.authenticationUsernameEvidence.bind(this));
    return strongest_authentication_username_evidence(evidence);
  }

  authenticationUsernameEvidence(
    field: HTMLInputElement,
  ): AuthenticationUsernameEvidence {
    const observation = this.pageInputObservation({
      field,
      loginContext: this.hasLoginContext(field),
    });
    try {
      return authentication_username_evidence(observation);
    } finally {
      observation.free();
    }
  }

  private looksLikeUsernameField(field: HTMLInputElement): boolean {
    if (!this.isRenderedInput(field)) return false;

    const observation = this.pageInputObservation({
      field,
      loginContext: this.hasLoginContext(field),
    });
    try {
      return looks_like_username_field(observation);
    } finally {
      observation.free();
    }
  }

  private looksLikeOneTimeCodeField(field: HTMLInputElement): boolean {
    if (!this.isRenderedInput(field)) return false;

    const observation = this.pageInputObservation({
      field,
      loginContext: false,
    });
    try {
      return looks_like_one_time_code_field(observation);
    } finally {
      observation.free();
    }
  }

  findUsernameFields({
    root = this.browser.document,
    formScope,
  }: PasswordFieldQuery): HTMLInputElement[] {
    const seen = new Set<HTMLInputElement>();
    const fields: HTMLInputElement[] = [];

    for (const field of [
      ...this.findFields({
        root,
        selector: usernameFieldSelectors.join(","),
        formScope,
      }),
      ...this.findFields({
        root,
        selector: usernameCandidateSelector,
        formScope,
      }),
    ]) {
      if (seen.has(field) || !this.looksLikeUsernameField(field)) continue;
      seen.add(field);
      fields.push(field);
    }
    return fields;
  }

  findOneTimeCodeFields({
    root = this.browser.document,
    formScope,
  }: PasswordFieldQuery): HTMLInputElement[] {
    const seen = new Set<HTMLInputElement>();
    const fields: HTMLInputElement[] = [];

    for (const field of this.findFields({
      root,
      selector: oneTimeCodeCandidateSelector,
      formScope,
    })) {
      if (seen.has(field) || !this.looksLikeOneTimeCodeField(field)) continue;
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
        looks_like_one_time_code_auto_submit_signal(`${attribute}=${handler}`)
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

  isAuthUsernameField(field: HTMLInputElement): boolean {
    return (
      this.hasAutocompleteToken({
        field,
        expected: "username",
      }) ||
      this.hasAutocompleteToken({
        field,
        expected: "email",
      }) ||
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
        (labeled && looks_like_passkey_control_label(labeled))
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
    return Array.from(
      container.querySelectorAll(formlessTypeButtonSelector),
    ).some(
      (control) =>
        !looks_like_login_advance_control_label(
          this.localActivationControlLabel(control),
        ),
    );
  }

  private containerHasUnambiguousAuthenticationActivation(
    container: Element,
  ): boolean {
    return this.labeledTypeButtonActivationControls(container).length === 1;
  }

  private labeledTypeButtonActivationControls(container: Element): Element[] {
    return Array.from(
      container.querySelectorAll(formlessTypeButtonSelector),
    ).filter((control) =>
      looks_like_login_advance_control_label(
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
    if (this.containerIsDocumentShell(container)) return false;
    if (this.containerHasSemanticSubmitControl(container)) return true;
    const promotionRequest: TypeButtonPromotionScopeRequest = {
      container,
      field,
    };
    if (
      this.containerHasUnambiguousAuthenticationActivation(container) &&
      !this.typeButtonPromotionSwallowsForeignScope(promotionRequest)
    ) {
      return true;
    }
    if (
      this.containerLooksLikeExplicitAuthSurface(container) &&
      !this.containerHasGenericTypeButtonControls(container)
    ) {
      return true;
    }
    return (
      this.containerHasUnownedCredentialCluster(container) &&
      !this.containerHasGenericTypeButtonControls(container) &&
      !this.typeButtonPromotionSwallowsForeignScope(promotionRequest)
    );
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
    return looks_like_email_verification_body(
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
    return looks_like_manual_checkpoint_label(labeled.toLowerCase());
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
