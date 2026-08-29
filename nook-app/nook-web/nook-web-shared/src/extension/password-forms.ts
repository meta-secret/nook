import { companionWasmReady } from "./companion-ready";
import {
  authentication_form_observation_priority,
  classify_authentication_advance_control,
  strongest_authentication_username_evidence,
} from "./nook-companion-wasm/nook_companion_wasm.js";
import type {
  AuthenticationAdvanceControlObservation,
  AuthenticationDetailedPasskeyControlObservation,
  AuthenticationPageObservation,
  AuthenticationPageObservationFacts,
  AuthenticationUsernameEvidence,
} from "./nook-companion-wasm/nook_companion_wasm.js";
import {
  findOneTimeCodeFields,
  findPasswordFields,
  findUsernameFields,
  findPasskeyControls,
  hasAutocompleteToken,
  authenticationUsernameEvidence,
  isAuthUsernameField,
  pageHasManualCheckpoint,
  pageHasPasskeyControl,
  PasskeyControlLookupKind,
  PasswordFormScopeKind,
} from "./password-form-fields";
import type {
  PasskeyControlLookup,
  PasswordFormScope,
} from "./password-form-fields";
import type { PasswordFieldQuery } from "./password-form-fields";

export {
  findOneTimeCodeFields,
  findPasswordFields,
  findUsernameFields,
  findPasskeyControl,
  findPasskeyControls,
  oneTimeCodeFieldSelectors,
  pageHasPasskeyControl,
  PasskeyControlLookupKind,
  PasswordFormScopeKind,
  usernameFieldSelectors,
} from "./password-form-fields";
export type {
  PasskeyControlLookup,
  PasswordFormScope,
} from "./password-form-fields";

void companionWasmReady;

export type PasswordFormSummary = {
  passwordFieldCount: number;
  currentPasswordFieldCount: number;
  newPasswordFieldCount: number;
  genericPasswordFieldCount: number;
  usernameFieldCount: number;
  oneTimeCodeFieldCount: number;
  /** CAPTCHA, terms acceptance, or email-verification style human gate. */
  manualCheckpointPresent: boolean;
  /** Visible passkey / WebAuthn control the user can activate. */
  passkeyControlPresent: boolean;
  formCount: number;
  observedAt: number;
};

export type LoginCredentials = {
  username: string;
  password: string;
};

export enum LoginCredentialsLookupKind {
  Absent = "absent",
  Found = "found",
}

export type LoginCredentialsLookup =
  | { kind: LoginCredentialsLookupKind.Absent }
  | {
      kind: LoginCredentialsLookupKind.Found;
      credentials: LoginCredentials;
    };

export type PasswordFormObservation = {
  root: ParentNode;
  formScope: PasswordFormScope;
  summary: PasswordFormSummary;
  passkeyControl?: HTMLElement;
};

type AuthenticationObservationFactsRequest = {
  observation: PasswordFormObservation;
  authenticatorSetupHint: boolean;
  backupCodesHint: boolean;
};

type NativeInputValueMutation = {
  input: HTMLInputElement;
  value: string;
};

export enum PasswordFormQueryKind {
  Root = "root",
  Scoped = "scoped",
}

export type PasswordFormScopeQuery =
  | { kind: PasswordFormQueryKind.Root; root: ParentNode }
  | {
      kind: PasswordFormQueryKind.Scoped;
      root: ParentNode;
      formScope: PasswordFormScope;
    };

type PasswordFormSummaryRequest = PasswordFormScopeQuery;

type UnownedAuthenticationContainerQuery = {
  field: HTMLElement;
  root: ParentNode;
};

export type OneTimeCodeFillRequest = PasswordFormScopeQuery & {
  code: string;
};

export type LoginCredentialsFillRequest = PasswordFormScopeQuery & {
  credentials: LoginCredentials;
};

export type GeneratedPasswordFillRequest = PasswordFormScopeQuery & {
  password: string;
};

type AuthenticationAdvanceControl = HTMLButtonElement | HTMLInputElement;

type FormSubmissionObservation = {
  form: HTMLFormElement;
  action: () => void;
};

function setNativeInputValue({ input, value }: NativeInputValueMutation): void {
  const prototype = Object.getPrototypeOf(input) as HTMLInputElement;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
  if (descriptor?.set) {
    descriptor.set.call(input, value);
  } else {
    input.value = value;
  }
  const nookTypedArgs0_0: ConstructorParameters<typeof Event>[1] = {
    bubbles: true,
  };
  input.dispatchEvent(new Event("input", nookTypedArgs0_0));
  const nookTypedArgs0_1: ConstructorParameters<typeof Event>[1] = {
    bubbles: true,
  };
  input.dispatchEvent(new Event("change", nookTypedArgs0_1));
}

function passwordFieldQuery(
  request: PasswordFormScopeQuery,
): PasswordFieldQuery {
  if (request.kind === PasswordFormQueryKind.Root) {
    return { root: request.root };
  }
  return { root: request.root, formScope: request.formScope };
}

function summarizeRoot(
  request: PasswordFormSummaryRequest,
): PasswordFormSummary {
  const { root } = request;
  const nookTypedArgs0_6 = passwordFieldQuery(request);
  const passwordFields = findPasswordFields(nookTypedArgs0_6);
  const nookTypedArgs0_7 = passwordFieldQuery(request);
  const usernameFields = findUsernameFields(nookTypedArgs0_7);
  const nookTypedArgs0_8 = passwordFieldQuery(request);
  const oneTimeCodeFields = findOneTimeCodeFields(nookTypedArgs0_8);
  const currentPasswordFieldCount = passwordFields.filter((field) => {
    const nookArrowArgs0: Parameters<typeof hasAutocompleteToken>[0] = {
      field,
      expected: "current-password",
    };
    return hasAutocompleteToken(nookArrowArgs0);
  }).length;
  const newPasswordFieldCount = passwordFields.filter((field) => {
    const nookArrowArgs1: Parameters<typeof hasAutocompleteToken>[0] = {
      field,
      expected: "new-password",
    };
    return hasAutocompleteToken(nookArrowArgs1);
  }).length;
  const forms = new Set<HTMLFormElement>();

  for (const field of [
    ...passwordFields,
    ...usernameFields,
    ...oneTimeCodeFields,
  ]) {
    if (field.form) {
      forms.add(field.form);
    }
  }

  return {
    passwordFieldCount: passwordFields.length,
    currentPasswordFieldCount,
    newPasswordFieldCount,
    genericPasswordFieldCount:
      passwordFields.length - currentPasswordFieldCount - newPasswordFieldCount,
    usernameFieldCount: usernameFields.length,
    oneTimeCodeFieldCount: oneTimeCodeFields.length,
    manualCheckpointPresent: pageHasManualCheckpoint(root),
    passkeyControlPresent: pageHasPasskeyControl(root),
    formCount: forms.size,
    observedAt: Date.now(),
  };
}

export function summarizePasswordForms(): PasswordFormSummary {
  const nookTypedArgs0_9: PasswordFormSummaryRequest = {
    kind: PasswordFormQueryKind.Root,
    root: document,
  };
  return summarizeRoot(nookTypedArgs0_9);
}

function passwordFormPriority({ summary }: PasswordFormObservation): number {
  const observation: AuthenticationPageObservation = {
    usernameFieldCount: summary.usernameFieldCount,
    currentPasswordFieldCount: summary.currentPasswordFieldCount,
    newPasswordFieldCount: summary.newPasswordFieldCount,
    genericPasswordFieldCount: summary.genericPasswordFieldCount,
    oneTimeCodeFieldCount: summary.oneTimeCodeFieldCount,
    manualCheckpointPresent: summary.manualCheckpointPresent,
    authenticatorSetupHint: false,
    backupCodesHint: false,
    passkeyControlPresent: summary.passkeyControlPresent,
    matchingPasskeyAccountCount: 0,
  };
  return authentication_form_observation_priority(observation);
}

function scopedControlRoot({
  root,
  formScope,
}: PasswordFormObservation): ParentNode {
  return formScope.kind === PasswordFormScopeKind.Owned
    ? formScope.owner
    : root;
}

const authenticationAdvanceControlSelector =
  'button[type="submit"], input[type="submit"], input[type="image"], input[type="button"], button:not([type]), button[type="button"]';

// Mirrors nook-companion-core's bounded observation envelope. DOM extraction
// may inspect more candidates, but transport must never make the whole Rust
// decision fail merely because a page renders an oversized control collection.
const MAX_AUTHENTICATION_OBSERVED_CONTROL_COUNT = 100;

function isRenderedControl(control: HTMLElement): boolean {
  let element = control;
  while (true) {
    if (element.hidden || element.getAttribute("aria-hidden") === "true") {
      return false;
    }
    const style = element.ownerDocument.defaultView?.getComputedStyle(element);
    if (style?.display === "none" || style?.visibility === "hidden") {
      return false;
    }
    const parent = element.parentElement;
    if (!parent) break;
    element = parent;
  }
  return true;
}

function authenticationAdvanceControls(
  observation: PasswordFormObservation,
): AuthenticationAdvanceControl[] {
  const queryRoot =
    observation.formScope.kind === PasswordFormScopeKind.Owned
      ? observation.formScope.owner.ownerDocument
      : observation.root;
  return Array.from(
    queryRoot.querySelectorAll<AuthenticationAdvanceControl>(
      authenticationAdvanceControlSelector,
    ),
  ).filter((control) => {
    if (!isRenderedControl(control)) return false;
    return observation.formScope.kind === PasswordFormScopeKind.Owned
      ? control.form === observation.formScope.owner
      : !control.form;
  });
}

function controlLabel(control: HTMLElement): string {
  return [
    control.textContent ?? "",
    control.getAttribute("aria-label") ?? "",
    control.getAttribute("title") ?? "",
    control.getAttribute("alt") ?? "",
    (control as HTMLInputElement).value ?? "",
  ].join(" ");
}

function formIdentity({ root, formScope }: PasswordFormObservation): string {
  const owner =
    formScope.kind === PasswordFormScopeKind.Owned ? formScope.owner : root;
  return owner instanceof Element
    ? [
        owner.id,
        owner.className,
        owner.getAttribute("name") ?? "",
        owner.getAttribute("role") ?? "",
      ].join(" ")
    : "";
}

function formDestination({ formScope }: PasswordFormObservation): string {
  return formScope.kind === PasswordFormScopeKind.Owned
    ? formScope.owner.action
    : location.href;
}

interface ControlDestinationRequest {
  control: HTMLElement;
  formScope: PasswordFormScope;
}

function controlDestination({
  control,
  formScope,
}: ControlDestinationRequest): string {
  if (control.hasAttribute("formaction")) {
    return (control as HTMLButtonElement).formAction;
  }
  if (control.hasAttribute("href")) {
    return (control as HTMLAnchorElement).href;
  }
  return formScope.kind === PasswordFormScopeKind.Owned
    ? formScope.owner.action
    : location.href;
}

/** Reuse the classified workflow scope when locating its passkey control. */
export function findWorkflowPasskeyControl(
  observation: PasswordFormObservation,
): PasskeyControlLookup {
  const controls = observation.passkeyControl
    ? [observation.passkeyControl]
    : findPasskeyControls(scopedControlRoot(observation));
  const control = controls.find(isRenderedControl);
  return control
    ? { kind: PasskeyControlLookupKind.Found, control }
    : { kind: PasskeyControlLookupKind.Absent };
}

function passkeyControlOwner(control: HTMLElement): HTMLFormElement | null {
  return control instanceof HTMLButtonElement ||
    control instanceof HTMLInputElement
    ? control.form
    : control.closest("form");
}

function usernameEvidence(
  observation: PasswordFormObservation,
): AuthenticationUsernameEvidence {
  const usernameQuery: Parameters<typeof findUsernameFields>[0] = {
    root: observation.root,
    formScope: observation.formScope,
  };
  const evidence = findUsernameFields(usernameQuery).map(
    authenticationUsernameEvidence,
  );
  const evidenceBatch: Parameters<
    typeof strongest_authentication_username_evidence
  >[0] = { evidence };
  return strongest_authentication_username_evidence(evidenceBatch);
}

interface PageControlObservationRequest {
  observation: PasswordFormObservation;
  control: HTMLElement;
  authenticationUsername: AuthenticationUsernameEvidence;
}

function pageControlObservation({
  observation,
  control,
  authenticationUsername,
}: PageControlObservationRequest): AuthenticationAdvanceControlObservation {
  const semanticSubmitControls = authenticationAdvanceControls(
    observation,
  ).filter((candidate) =>
    candidate.matches(
      'button[type="submit"], input[type="submit"], input[type="image"], button:not([type])',
    ),
  );
  const semanticSubmit = control.matches(
    'button[type="submit"], input[type="submit"], input[type="image"], button:not([type])',
  );
  const owned =
    observation.formScope.kind === PasswordFormScopeKind.Owned &&
    (control as AuthenticationAdvanceControl).form ===
      observation.formScope.owner;
  const locallyScoped =
    observation.formScope.kind === PasswordFormScopeKind.Owned
      ? observation.formScope.owner.contains(control)
      : observation.root !== document && observation.root.contains(control);
  const destinationRequest: ControlDestinationRequest = {
    control,
    formScope: observation.formScope,
  };
  const destinationIdentity = controlDestination(destinationRequest);
  return {
    actionability:
      (control as HTMLButtonElement).disabled ||
      control.getAttribute("aria-disabled") === "true"
        ? "inert"
        : "actionable",
    ownership: owned
      ? "owned-form"
      : locallyScoped
        ? "locally-scoped"
        : "unowned",
    semantics: semanticSubmit ? "semantic-submit" : "activation",
    authenticationUsername,
    passwordFieldCount: observation.summary.passwordFieldCount,
    newPasswordFieldCount: observation.summary.newPasswordFieldCount,
    oneTimeCodeFieldCount: observation.summary.oneTimeCodeFieldCount,
    semanticSubmitControlCount: Math.min(
      semanticSubmitControls.length,
      MAX_AUTHENTICATION_OBSERVED_CONTROL_COUNT,
    ),
    sourceOrigin: location.origin,
    formIdentity: formIdentity(observation),
    destinationIdentity,
    label: controlLabel(control),
  };
}

/** Collect browser facts only; Rust owns every workflow and control decision. */
export function authenticationPageObservationFacts({
  observation,
  authenticatorSetupHint,
  backupCodesHint,
}: AuthenticationObservationFactsRequest): AuthenticationPageObservationFacts {
  const authenticationUsername = usernameEvidence(observation);
  const advanceControls = authenticationAdvanceControls(observation);
  const passkeyControl = findWorkflowPasskeyControl(observation);
  const oneTimeCodeQuery: Parameters<typeof findOneTimeCodeFields>[0] = {
    root: observation.root,
    formScope: observation.formScope,
  };
  const oneTimeCodeHandlerSignal = findOneTimeCodeFields(oneTimeCodeQuery)
    .flatMap((field) =>
      ["oninput", "onchange"].flatMap((attribute) => {
        return field.hasAttribute(attribute)
          ? [`${attribute}=${field.getAttribute(attribute) ?? ""}`]
          : [];
      }),
    )
    .join("\n");
  let detailedAdvanceControl: AuthenticationPageObservationFacts["detailedAdvanceControl"] =
    { kind: "absent" };
  if (advanceControls.length > 0) {
    const observations = advanceControls.map((control) => {
      const advanceControlRequest: PageControlObservationRequest = {
        observation,
        control,
        authenticationUsername,
      };
      return pageControlObservation(advanceControlRequest);
    });
    const prioritized = observations.toSorted(
      // eslint-disable-next-line max-params -- Array.toSorted owns the comparator callback signature.
      (left, right) => {
        const leftApproved =
          classify_authentication_advance_control(left) ===
          "advances-authentication";
        const rightApproved =
          classify_authentication_advance_control(right) ===
          "advances-authentication";
        return Number(rightApproved) - Number(leftApproved);
      },
    );
    detailedAdvanceControl = {
      kind: "observed",
      observations: prioritized.slice(
        0,
        MAX_AUTHENTICATION_OBSERVED_CONTROL_COUNT,
      ),
    };
  }
  let detailedPasskeyControl: AuthenticationDetailedPasskeyControlObservation =
    { kind: "absent" };
  if (passkeyControl.kind === "found") {
    const passkeyControlRequest: PageControlObservationRequest = {
      observation,
      control: passkeyControl.control,
      authenticationUsername,
    };
    detailedPasskeyControl = {
      kind: "observed",
      observation: pageControlObservation(passkeyControlRequest),
    };
  }
  const contextObservation =
    "observations" in detailedAdvanceControl
      ? detailedAdvanceControl.observations[0]
      : undefined;
  return {
    fields: {
      usernameFieldCount: observation.summary.usernameFieldCount,
      currentPasswordFieldCount: observation.summary.currentPasswordFieldCount,
      newPasswordFieldCount: observation.summary.newPasswordFieldCount,
      genericPasswordFieldCount: observation.summary.genericPasswordFieldCount,
      oneTimeCodeFieldCount: observation.summary.oneTimeCodeFieldCount,
    },
    ceremony: {
      oneTimeCodeProgression: "advance-control-required",
      oneTimeCodeHandlerSignal,
      authenticationContext: {
        authenticationUsername,
        sourceOrigin: location.origin,
        formIdentity:
          contextObservation?.formIdentity ?? formIdentity(observation),
        destinationIdentity: formDestination(observation),
      },
      manualCheckpoint: observation.summary.manualCheckpointPresent
        ? "present"
        : "absent",
      advanceControl: "absent",
    },
    authenticator: {
      authenticatorSetup: authenticatorSetupHint ? "present" : "absent",
      backupCodes: backupCodesHint ? "present" : "absent",
      passkeyControl: passkeyControl.kind === "found" ? "present" : "absent",
      matchingPasskeyAccountCount: 0,
      detailedPasskeyControl,
    },
    detailedAdvanceControl,
  };
}

function nearestUnownedAuthContainer({
  field,
  root,
}: UnownedAuthenticationContainerQuery): ParentNode {
  let container = field.parentElement;
  while (container && container !== root) {
    const explicitAuthContainer = container.matches(
      'dialog, [role="dialog"], [role="form"], [id*="login" i], [id*="signin" i], [id*="signup" i], [id*="reset" i], [class*="login" i], [class*="signin" i], [class*="signup" i], [class*="reset" i]',
    );
    const hasSubmitControl = Boolean(
      container.querySelector(
        'button[type="submit"], input[type="submit"], input[type="image"], button:not([type])',
      ),
    );
    if (explicitAuthContainer || hasSubmitControl) return container;
    container = container.parentElement;
  }
  return root;
}

export function summarizeAuthenticationWorkflowForms(): PasswordFormObservation[] {
  const root = document;
  const nookTypedArgs0_10: Parameters<typeof findPasswordFields>[0] = { root };
  const allPasswordFields = findPasswordFields(nookTypedArgs0_10);
  const nookTypedArgs0_11: Parameters<typeof findUsernameFields>[0] = { root };
  const allUsernameFields = findUsernameFields(nookTypedArgs0_11);
  const nookTypedArgs0_12: Parameters<typeof findOneTimeCodeFields>[0] = {
    root,
  };
  const allOneTimeCodeFields = findOneTimeCodeFields(nookTypedArgs0_12);
  const authUsernameFields = allUsernameFields.filter(isAuthUsernameField);
  const renderedPasskeyControls =
    findPasskeyControls(root).filter(isRenderedControl);
  const authFieldCount =
    allPasswordFields.length +
    authUsernameFields.length +
    allOneTimeCodeFields.length;
  if (authFieldCount === 0) {
    return renderedPasskeyControls.map((passkeyControl) => {
      const owner =
        passkeyControl instanceof HTMLButtonElement ||
        passkeyControl instanceof HTMLInputElement
          ? passkeyControl.form
          : passkeyControl.closest("form");
      const formScope: PasswordFormScope = owner
        ? { kind: PasswordFormScopeKind.Owned, owner }
        : { kind: PasswordFormScopeKind.Unowned };
      let scopedRoot: ParentNode = owner ?? root;
      if (!owner) {
        const containerQuery: UnownedAuthenticationContainerQuery = {
          field: passkeyControl,
          root,
        };
        scopedRoot = nearestUnownedAuthContainer(containerQuery);
      }
      const nookTypedArgs0_13: Parameters<typeof summarizeRoot>[0] = {
        kind: PasswordFormQueryKind.Scoped,
        root: scopedRoot,
        formScope,
      };
      return {
        root: scopedRoot,
        formScope,
        summary: summarizeRoot(nookTypedArgs0_13),
        passkeyControl,
      };
    });
  }

  const forms = Array.from(
    root.querySelectorAll<HTMLFormElement>("form"),
  ).filter((form) => {
    const formScope: PasswordFormScope = {
      kind: PasswordFormScopeKind.Owned,
      owner: form,
    };
    const nookTypedArgs0_14: Parameters<typeof summarizeRoot>[0] = {
      kind: PasswordFormQueryKind.Scoped,
      root,
      formScope,
    };
    const summary = summarizeRoot(nookTypedArgs0_14);
    const nookNamedArgs0_2: Parameters<typeof findUsernameFields>[0] = {
      root,
      formScope,
    };
    const ownsPasskeyControl = renderedPasskeyControls.some(
      (control) => passkeyControlOwner(control) === form,
    );
    return (
      summary.passwordFieldCount > 0 ||
      summary.oneTimeCodeFieldCount > 0 ||
      findUsernameFields(nookNamedArgs0_2).some(isAuthUsernameField) ||
      ownsPasskeyControl
    );
  });
  const observations: PasswordFormObservation[] = forms.flatMap((form) => {
    const summaryArgs: Parameters<typeof summarizeRoot>[0] = {
      kind: PasswordFormQueryKind.Scoped,
      root,
      formScope: {
        kind: PasswordFormScopeKind.Owned,
        owner: form,
      },
    };
    const observation: PasswordFormObservation = {
      root,
      formScope: { kind: PasswordFormScopeKind.Owned, owner: form },
      summary: summarizeRoot(summaryArgs),
    };
    const passkeyControls = renderedPasskeyControls.filter(
      (control) => passkeyControlOwner(control) === form,
    );
    return passkeyControls.length > 0
      ? passkeyControls.map((passkeyControl) => ({
          ...observation,
          passkeyControl,
        }))
      : [observation];
  });
  const unownedFields = [
    ...allPasswordFields,
    ...authUsernameFields,
    ...allOneTimeCodeFields,
  ].filter((field) => !field.form);
  const unownedContainers = new Set(
    unownedFields.map((field) => {
      const nookArrowArgs2: Parameters<typeof nearestUnownedAuthContainer>[0] =
        { field, root };
      return nearestUnownedAuthContainer(nookArrowArgs2);
    }),
  );
  for (const container of unownedContainers) {
    const formScope: PasswordFormScope = {
      kind: PasswordFormScopeKind.Unowned,
    };
    const nookTypedArgs0_15: Parameters<typeof summarizeRoot>[0] = {
      kind: PasswordFormQueryKind.Scoped,
      root: container,
      formScope,
    };
    const nookTypedArgs0_3: Parameters<typeof observations.push>[0] = {
      root: container,
      formScope,
      summary: summarizeRoot(nookTypedArgs0_15),
    };
    observations.push(nookTypedArgs0_3);
  }
  for (const passkeyControl of renderedPasskeyControls.filter(
    (control) => passkeyControlOwner(control) === null,
  )) {
    const containerQuery: UnownedAuthenticationContainerQuery = {
      field: passkeyControl,
      root,
    };
    const container = nearestUnownedAuthContainer(containerQuery);
    const formScope: PasswordFormScope = {
      kind: PasswordFormScopeKind.Unowned,
    };
    const summaryArgs: Parameters<typeof summarizeRoot>[0] = {
      kind: PasswordFormQueryKind.Scoped,
      root: container,
      formScope,
    };
    const passkeyObservation: Parameters<typeof observations.push>[0] = {
      root: container,
      formScope,
      summary: summarizeRoot(summaryArgs),
      passkeyControl,
    };
    observations.push(passkeyObservation);
  }
  return observations.sort(
    // eslint-disable-next-line max-params -- Array.sort owns the comparator callback signature.
    (left, right) => passwordFormPriority(right) - passwordFormPriority(left),
  );
}

export function fillOneTimeCode(request: OneTimeCodeFillRequest): boolean {
  const nookTypedArgs0_16 = passwordFieldQuery(request);
  const field = findOneTimeCodeFields(nookTypedArgs0_16)[0];
  if (!field) return false;
  const nookTypedArgs0_17: Parameters<typeof setNativeInputValue>[0] = {
    input: field,
    value: request.code,
  };
  setNativeInputValue(nookTypedArgs0_17);
  field.focus();
  return true;
}

export function fillLoginCredentials(
  request: LoginCredentialsFillRequest,
): boolean {
  const nookTypedArgs0_18 = passwordFieldQuery(request);
  const passwordFields = findPasswordFields(nookTypedArgs0_18);
  const nookTypedArgs0_19 = passwordFieldQuery(request);
  const usernameCandidates = findUsernameFields(nookTypedArgs0_19);
  const usernameField = usernameCandidates[0];

  if (passwordFields.length === 0) {
    if (!usernameField) return false;
    const nookTypedArgs0_20: Parameters<typeof setNativeInputValue>[0] = {
      input: usernameField,
      value: request.credentials.username,
    };
    setNativeInputValue(nookTypedArgs0_20);
    usernameField.focus();
    return true;
  }

  const passwordField = passwordFields[0];
  if (usernameField) {
    const nookTypedArgs0_21: Parameters<typeof setNativeInputValue>[0] = {
      input: usernameField,
      value: request.credentials.username,
    };
    setNativeInputValue(nookTypedArgs0_21);
  }
  const nookTypedArgs0_22: Parameters<typeof setNativeInputValue>[0] = {
    input: passwordField,
    value: request.credentials.password,
  };
  setNativeInputValue(nookTypedArgs0_22);
  return true;
}

/** Fill every `new-password` field (and confirm) without touching current-password. */
export function fillGeneratedPassword(
  request: GeneratedPasswordFillRequest,
): boolean {
  const nookTypedArgs0_23 = passwordFieldQuery(request);
  const passwordFields = findPasswordFields(nookTypedArgs0_23);
  const newPasswordFields = passwordFields.filter((field) => {
    const nookArrowArgs3: Parameters<typeof hasAutocompleteToken>[0] = {
      field,
      expected: "new-password",
    };
    return hasAutocompleteToken(nookArrowArgs3);
  });
  if (newPasswordFields.length === 0) return false;
  for (const field of newPasswordFields) {
    const nookTypedArgs0_24: Parameters<typeof setNativeInputValue>[0] = {
      input: field,
      value: request.password,
    };
    setNativeInputValue(nookTypedArgs0_24);
  }
  newPasswordFields[0]?.focus();
  return true;
}

/** Read username/password from a classified auth form scope for a save offer. */
export function readLoginCredentials(
  request: PasswordFormScopeQuery,
): LoginCredentialsLookup {
  const nookTypedArgs0_25 = passwordFieldQuery(request);
  const passwordFields = findPasswordFields(nookTypedArgs0_25);
  if (passwordFields.length === 0) {
    return { kind: LoginCredentialsLookupKind.Absent };
  }

  const newPasswordFields = passwordFields.filter((field) => {
    const nookArrowArgs4: Parameters<typeof hasAutocompleteToken>[0] = {
      field,
      expected: "new-password",
    };
    return hasAutocompleteToken(nookArrowArgs4);
  });
  const passwordField =
    newPasswordFields[0] ??
    passwordFields.find((field) => {
      const nookArrowArgs5: Parameters<typeof hasAutocompleteToken>[0] = {
        field,
        expected: "current-password",
      };
      return hasAutocompleteToken(nookArrowArgs5);
    }) ??
    passwordFields[0];
  const password = passwordField.value.trim();
  const nookNamedArgs0_3 = passwordFieldQuery(request);
  const username = findUsernameFields(nookNamedArgs0_3)[0]?.value.trim() ?? "";
  if (!username || !password) {
    return { kind: LoginCredentialsLookupKind.Absent };
  }
  return {
    kind: LoginCredentialsLookupKind.Found,
    credentials: { username, password },
  };
}

export function submitLoginForm(observation: PasswordFormObservation): boolean {
  const request: PasswordFormScopeQuery = {
    kind: PasswordFormQueryKind.Scoped,
    root: observation.root,
    formScope: observation.formScope,
  };
  const nookTypedArgs0_26 = passwordFieldQuery(request);
  const passwordField = findPasswordFields(nookTypedArgs0_26)[0];
  const nookTypedArgs0_27 = passwordFieldQuery(request);
  const usernameField = findUsernameFields(nookTypedArgs0_27)[0];
  const anchor = passwordField ?? usernameField;
  if (!anchor) return false;

  // Email-first / multi-step logins often use a type=button "Next" control
  // rather than a real submit. Use only a control Rust approves for the
  // currently observed workflow while the password step is still missing.
  if (!passwordField && clickAdvanceControl(observation)) {
    return true;
  }

  const form = anchor.form;
  if (!form) {
    // Password present without a real <form>: fill succeeded, but do not
    // claim submission for opaque type=button host chrome.
    return false;
  }

  const authenticationUsername = usernameEvidence(observation);
  const submitControl = authenticationAdvanceControls(observation).find(
    (control) => {
      if (
        !control.matches(
          'button[type="submit"], input[type="submit"], input[type="image"], button:not([type])',
        )
      ) {
        return false;
      }
      const advanceControlRequest: PageControlObservationRequest = {
        observation,
        control,
        authenticationUsername,
      };
      return (
        classify_authentication_advance_control(
          pageControlObservation(advanceControlRequest),
        ) === "advances-authentication"
      );
    },
  );
  if (submitControl) {
    if (
      !isRenderedControl(submitControl) ||
      submitControl.disabled ||
      submitControl.getAttribute("aria-disabled") === "true"
    ) {
      return false;
    }
    const nookTypedArgs0_28: Parameters<typeof observeSubmit>[0] = {
      form,
      action: () => submitControl.click(),
    };
    return observeSubmit(nookTypedArgs0_28);
  }
  return false;
}

function clickAdvanceControl(observation: PasswordFormObservation): boolean {
  const authenticationUsername = usernameEvidence(observation);
  const control = authenticationAdvanceControls(observation).find(
    (candidate) => {
      const advanceControlRequest: PageControlObservationRequest = {
        observation,
        control: candidate,
        authenticationUsername,
      };
      return (
        classify_authentication_advance_control(
          pageControlObservation(advanceControlRequest),
        ) === "advances-authentication"
      );
    },
  );
  if (
    !control ||
    !isRenderedControl(control) ||
    control.disabled ||
    control.getAttribute("aria-disabled") === "true"
  ) {
    return false;
  }
  control.click();
  return true;
}

function observeSubmit({ form, action }: FormSubmissionObservation): boolean {
  let submitted = false;
  const markSubmitted = () => {
    submitted = true;
  };
  const nookTypedArgs0_4: Parameters<typeof form.addEventListener>[2] = {
    capture: true,
    once: true,
  };
  form.addEventListener("submit", markSubmitted, nookTypedArgs0_4);
  action();
  form.removeEventListener("submit", markSubmitted, true);
  return submitted;
}
