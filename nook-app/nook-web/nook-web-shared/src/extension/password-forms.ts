import { companionWasmReady } from "./companion-ready";
import {
  authentication_form_observation_priority,
  strongest_authentication_username_evidence,
  classify_companion_authentication_workflow,
  companion_authentication_workflow_match_kind,
  CompanionAuthenticationWorkflowMatchKind,
  classify_authentication_advance_control,
} from "./nook-companion-wasm/nook_companion_wasm.js";
import type {
  AuthenticationAdvanceControlObservation,
  AuthenticationAdvanceControlDecision,
  AuthenticationPageObservationFacts,
  AuthenticationPageObservationFactsBatch,
  AuthenticationUsernameEvidence,
  AuthenticationUsernameEvidenceBatch,
  PageControlActionability,
  PageControlOwnership,
  PageControlSemantics,
} from "./nook-companion-wasm/nook_companion_wasm.js";
import {
  authenticationAdvanceControls,
  authenticationAdvanceControlSelector,
  hasAssociatedForm,
  isPlainNavigationControl,
  isResetControl,
  isSemanticSubmitControl,
  PasswordFormQueryKind,
} from "./authentication-advance-controls";
import type { PasswordFormScopeQuery } from "./authentication-advance-controls";
import {
  findOneTimeCodeFields,
  findPasswordFields,
  findUsernameFields,
  hasAutocompleteToken,
  isActionablePageControl,
  isAuthUsernameField,
  authenticationUsernameEvidence,
  oneTimeCodeFieldHasAutoSubmitEvidence,
  pageControlLabel,
  pageHasManualCheckpoint,
  pageHasManualCheckpointForScope,
  pageHasPasskeyControl,
  pageHasPasskeyControlForScope,
  PasswordFormScopeKind,
} from "./password-form-fields";
import type { PasswordFormScope } from "./password-form-fields";
import type { PasswordFieldQuery } from "./password-form-fields";

export {
  findOneTimeCodeFields,
  findPasswordFields,
  findUsernameFields,
  findPasskeyControl,
  findPasskeyControlForScope,
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
export { PasswordFormQueryKind } from "./authentication-advance-controls";
export type { PasswordFormScopeQuery } from "./authentication-advance-controls";

void companionWasmReady;

export type PasswordFormSummary = {
  passwordFieldCount: number;
  currentPasswordFieldCount: number;
  newPasswordFieldCount: number;
  genericPasswordFieldCount: number;
  usernameFieldCount: number;
  oneTimeCodeFieldCount: number;
  /** Direct DOM evidence that filling the OTP submits the current ceremony. */
  oneTimeCodeAutoSubmitObserved: boolean;
  /** CAPTCHA, terms acceptance, or email-verification style human gate. */
  manualCheckpointPresent: boolean;
  /** Visible passkey / WebAuthn control the user can activate. */
  passkeyControlPresent: boolean;
  /** Visible enabled control that can advance the authentication ceremony. */
  authenticationAdvanceControlPresent: boolean;
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
};

type NativeInputValueMutation = {
  input: HTMLInputElement;
  value: string;
};

enum AuthenticationContainerLookupKind {
  Absent = "absent",
  Found = "found",
}

enum AuthenticationContainerContextKind {
  Explicit = "explicit",
  Grouped = "grouped",
}

type AuthenticationContainerLookup =
  | { kind: AuthenticationContainerLookupKind.Absent }
  | {
      kind: AuthenticationContainerLookupKind.Found;
      container: HTMLElement;
      context: AuthenticationContainerContextKind;
    };

type PasswordFormSummaryRequest = PasswordFormScopeQuery;

// Rust rejects larger classification batches. Summaries are priority-sorted
// before callers reach this boundary, so only the accepted prefix is classified.
const MAX_AUTHENTICATION_WORKFLOW_CLASSIFICATION_OBSERVATIONS = 20;

type UnownedAuthenticationContainerQuery = {
  field: HTMLInputElement;
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
  const contextSource: AuthenticationAdvanceControlContextSource = {
    request,
    usernameFields,
    passwordFieldCount: passwordFields.length,
    newPasswordFieldCount,
    oneTimeCodeFieldCount: oneTimeCodeFields.length,
  };
  const authenticationControlContext =
    authenticationAdvanceControlContext(contextSource);
  const authenticationControlQuery: AuthenticationAdvanceControlQuery = {
    request,
    ...authenticationControlContext,
  };
  const authenticationAdvanceControlPresent = hasAuthenticationAdvanceControl(
    authenticationControlQuery,
  );
  const oneTimeCodeAutoSubmitObserved = oneTimeCodeFields.some(
    oneTimeCodeFieldHasAutoSubmitEvidence,
  );
  let passkeyControlPresent = pageHasPasskeyControl(root);
  if (request.kind === PasswordFormQueryKind.Scoped) {
    const passkeyScopeQuery: Parameters<
      typeof pageHasPasskeyControlForScope
    >[0] = {
      root,
      formScope: request.formScope,
    };
    passkeyControlPresent = pageHasPasskeyControlForScope(passkeyScopeQuery);
  }

  let manualCheckpointPresent = pageHasManualCheckpoint(root);
  if (request.kind === PasswordFormQueryKind.Scoped) {
    const manualCheckpointQuery: Parameters<
      typeof pageHasManualCheckpointForScope
    >[0] = {
      root,
      formScope: request.formScope,
    };
    manualCheckpointPresent = pageHasManualCheckpointForScope(
      manualCheckpointQuery,
    );
  }

  return {
    passwordFieldCount: passwordFields.length,
    currentPasswordFieldCount,
    newPasswordFieldCount,
    genericPasswordFieldCount:
      passwordFields.length - currentPasswordFieldCount - newPasswordFieldCount,
    usernameFieldCount: usernameFields.length,
    oneTimeCodeFieldCount: oneTimeCodeFields.length,
    oneTimeCodeAutoSubmitObserved,
    manualCheckpointPresent,
    passkeyControlPresent,
    authenticationAdvanceControlPresent,
    formCount: forms.size,
    observedAt: Date.now(),
  };
}

type AuthenticationAdvanceControlQuery = {
  request: PasswordFormScopeQuery;
  authenticationUsernameEvidence: AuthenticationUsernameEvidence;
  passwordFieldCount: number;
  newPasswordFieldCount: number;
  oneTimeCodeFieldCount: number;
  semanticSubmitControlCount: number;
  formIdentity: string;
};

type AuthenticationAdvanceControlContext = Omit<
  AuthenticationAdvanceControlQuery,
  "request"
>;

type AuthenticationAdvanceControlContextSource = {
  request: PasswordFormScopeQuery;
  usernameFields: readonly HTMLInputElement[];
  passwordFieldCount: number;
  newPasswordFieldCount: number;
  oneTimeCodeFieldCount: number;
};

function referencedAccessibleLabelText(source: HTMLElement): string {
  const labelledBy = source.getAttribute("aria-labelledby");
  if (!labelledBy) return "";
  return labelledBy
    .split(/\s+/u)
    .filter(Boolean)
    .map((id) => source.ownerDocument.getElementById(id)?.textContent ?? "")
    .join(" ");
}

function authenticationScopeIdentity(source: HTMLElement): string {
  return [
    source.id,
    source.getAttribute("class") ?? "",
    source.getAttribute("action") ?? "",
    source.getAttribute("name") ?? "",
    source.getAttribute("aria-label") ?? "",
    referencedAccessibleLabelText(source),
  ].join(" ");
}

function authenticationAdvanceControlContext({
  request,
  usernameFields,
  passwordFieldCount,
  newPasswordFieldCount,
  oneTimeCodeFieldCount,
}: AuthenticationAdvanceControlContextSource): AuthenticationAdvanceControlContext {
  let formIdentity = "";
  if (
    request.kind === PasswordFormQueryKind.Scoped &&
    (request.formScope.kind === PasswordFormScopeKind.Owned ||
      request.formScope.kind === PasswordFormScopeKind.LocallyScoped)
  ) {
    const identitySource = request.formScope.owner;
    formIdentity = authenticationScopeIdentity(identitySource);
  }
  const usernameEvidenceBatch: AuthenticationUsernameEvidenceBatch = {
    evidence: usernameFields.map(authenticationUsernameEvidence),
  };
  const semanticSubmitControls = authenticationAdvanceControls(request).filter(
    isSemanticSubmitControl,
  );
  const semanticSubmitControlCount =
    request.kind === PasswordFormQueryKind.Scoped &&
    request.formScope.kind === PasswordFormScopeKind.LocallyScoped
      ? semanticSubmitControls.filter(isActionablePageControl).length
      : semanticSubmitControls.length;
  return {
    authenticationUsernameEvidence: strongest_authentication_username_evidence(
      usernameEvidenceBatch,
    ),
    passwordFieldCount,
    newPasswordFieldCount,
    oneTimeCodeFieldCount,
    semanticSubmitControlCount,
    formIdentity,
  };
}

function pageControlDestinationIdentity(control: HTMLElement): string {
  if (
    control instanceof HTMLButtonElement ||
    control instanceof HTMLInputElement
  ) {
    return control.getAttribute("formaction") ?? "";
  }
  return "";
}

type AuthenticationAdvanceControlCandidate =
  AuthenticationAdvanceControlQuery & {
    control: HTMLElement;
  };

function isAuthenticationAdvanceControl({
  control,
  request,
  authenticationUsernameEvidence,
  passwordFieldCount,
  newPasswordFieldCount,
  oneTimeCodeFieldCount,
  semanticSubmitControlCount,
  formIdentity,
}: AuthenticationAdvanceControlCandidate): boolean {
  const observation: AuthenticationAdvanceControlObservation = {
    actionability: (isActionablePageControl(control)
      ? "actionable"
      : "inert") satisfies PageControlActionability,
    ownership: (request.kind === PasswordFormQueryKind.Scoped &&
    request.formScope.kind === PasswordFormScopeKind.Owned
      ? "owned-form"
      : request.kind === PasswordFormQueryKind.Scoped &&
          request.formScope.kind === PasswordFormScopeKind.LocallyScoped
        ? "locally-scoped"
        : "unowned") satisfies PageControlOwnership,
    semantics: (isSemanticSubmitControl(control)
      ? "semantic-submit"
      : "activation") satisfies PageControlSemantics,
    authenticationUsername:
      authenticationUsernameEvidence satisfies AuthenticationUsernameEvidence,
    passwordFieldCount,
    newPasswordFieldCount,
    oneTimeCodeFieldCount,
    semanticSubmitControlCount,
    formIdentity,
    destinationIdentity: pageControlDestinationIdentity(control),
    label: pageControlLabel(control),
  };
  return (
    classify_authentication_advance_control(observation) ===
    ("advances-authentication" satisfies AuthenticationAdvanceControlDecision)
  );
}

function hasAuthenticationAdvanceControl({
  request,
  authenticationUsernameEvidence,
  passwordFieldCount,
  newPasswordFieldCount,
  oneTimeCodeFieldCount,
  semanticSubmitControlCount,
  formIdentity,
}: AuthenticationAdvanceControlQuery): boolean {
  const controls = authenticationAdvanceControls(request);
  return controls.some((control) => {
    if (isResetControl(control) || isPlainNavigationControl(control)) {
      return false;
    }
    const decision: AuthenticationAdvanceControlCandidate = {
      control,
      request,
      authenticationUsernameEvidence,
      passwordFieldCount,
      newPasswordFieldCount,
      oneTimeCodeFieldCount,
      semanticSubmitControlCount,
      formIdentity,
    };
    return isAuthenticationAdvanceControl(decision);
  });
}

export function summarizePasswordForms(): PasswordFormSummary {
  const nookTypedArgs0_9: PasswordFormSummaryRequest = {
    kind: PasswordFormQueryKind.Root,
    root: document,
  };
  return summarizeRoot(nookTypedArgs0_9);
}

function portableAuthenticationPageObservationFacts(
  summary: PasswordFormSummary,
): AuthenticationPageObservationFacts {
  return {
    fields: {
      usernameFieldCount: summary.usernameFieldCount,
      currentPasswordFieldCount: summary.currentPasswordFieldCount,
      newPasswordFieldCount: summary.newPasswordFieldCount,
      genericPasswordFieldCount: summary.genericPasswordFieldCount,
      oneTimeCodeFieldCount: summary.oneTimeCodeFieldCount,
    },
    ceremony: {
      oneTimeCodeProgression: summary.oneTimeCodeAutoSubmitObserved
        ? "auto-submit-observed"
        : "advance-control-required",
      manualCheckpoint: summary.manualCheckpointPresent ? "present" : "absent",
      advanceControl: summary.authenticationAdvanceControlPresent
        ? "present"
        : "absent",
    },
    authenticator: {
      authenticatorSetup: "absent",
      backupCodes: "absent",
      passkeyControl: summary.passkeyControlPresent ? "present" : "absent",
      passkeyVault: "available",
      matchingPasskeyAccountCount: 0,
    },
  };
}

function passwordFormPriority({ summary }: PasswordFormObservation): number {
  const observation = portableAuthenticationPageObservationFacts(summary);
  return authentication_form_observation_priority(observation);
}

function nearestUnownedAuthContainer({
  field,
  root,
}: UnownedAuthenticationContainerQuery): AuthenticationContainerLookup {
  let container = field.parentElement;
  while (container && container !== root) {
    if (container.tagName === "BODY") {
      return { kind: AuthenticationContainerLookupKind.Absent };
    }
    const explicitAuthContainer = container.matches(
      'dialog, [role="dialog"], [role="form"], [id*="login" i], [id*="signin" i], [id*="signup" i], [id*="reset" i], [class*="login" i], [class*="signin" i], [class*="signup" i], [class*="reset" i]',
    );
    if (explicitAuthContainer) {
      return {
        kind: AuthenticationContainerLookupKind.Found,
        container,
        context: AuthenticationContainerContextKind.Explicit,
      };
    }
    const hasSubmitControl = Array.from(
      container.querySelectorAll<HTMLElement>(
        'button[type="submit"], input[type="submit"], input[type="image"], button:not([type])',
      ),
    ).some(
      (control) =>
        !hasAssociatedForm(control) && isActionablePageControl(control),
    );
    const hasLocallyGroupedActionControl = Array.from(
      container.querySelectorAll<HTMLElement>(
        authenticationAdvanceControlSelector,
      ),
    ).some(
      (control) =>
        control.closest(
          "body, main, section, article, aside, nav, li, td, [role=group]",
        ) === container &&
        !hasAssociatedForm(control) &&
        isActionablePageControl(control),
    );
    if (hasSubmitControl || hasLocallyGroupedActionControl) {
      return {
        kind: AuthenticationContainerLookupKind.Found,
        container,
        context: AuthenticationContainerContextKind.Grouped,
      };
    }
    if (
      container.matches(
        "body, main, section, article, aside, nav, li, td, [role=group]",
      )
    ) {
      return { kind: AuthenticationContainerLookupKind.Absent };
    }
    container = container.parentElement;
  }
  return { kind: AuthenticationContainerLookupKind.Absent };
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
    return (
      summary.passwordFieldCount > 0 ||
      summary.oneTimeCodeFieldCount > 0 ||
      summary.passkeyControlPresent ||
      findUsernameFields(nookNamedArgs0_2).some(isAuthUsernameField)
    );
  });
  const observations: PasswordFormObservation[] = forms.map((form) => {
    const summaryArgs: Parameters<typeof summarizeRoot>[0] = {
      kind: PasswordFormQueryKind.Scoped,
      root,
      formScope: {
        kind: PasswordFormScopeKind.Owned,
        owner: form,
      },
    };
    return {
      root,
      formScope: { kind: PasswordFormScopeKind.Owned, owner: form },
      summary: summarizeRoot(summaryArgs),
    };
  });
  const unownedFields = [
    ...allPasswordFields,
    ...authUsernameFields,
    ...allOneTimeCodeFields,
  ].filter((field) => !field.form);
  const unownedContainers = new Map<HTMLElement, PasswordFormScope>();
  for (const field of unownedFields) {
    const lookupArgs: Parameters<typeof nearestUnownedAuthContainer>[0] = {
      field,
      root,
    };
    const lookup = nearestUnownedAuthContainer(lookupArgs);
    if (lookup.kind === AuthenticationContainerLookupKind.Found) {
      const formScope: PasswordFormScope =
        lookup.context === AuthenticationContainerContextKind.Explicit
          ? {
              kind: PasswordFormScopeKind.LocallyScoped,
              owner: lookup.container,
            }
          : { kind: PasswordFormScopeKind.Unowned };
      unownedContainers.set(lookup.container, formScope);
    }
  }
  for (const [container, formScope] of unownedContainers) {
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
  const unownedFormScope: PasswordFormScope = {
    kind: PasswordFormScopeKind.Unowned,
  };
  const unownedPasskeyQuery: Parameters<
    typeof pageHasPasskeyControlForScope
  >[0] = {
    root,
    formScope: unownedFormScope,
  };
  const unownedPasskeyAlreadyObserved = observations.some(
    ({ formScope, summary }) =>
      formScope.kind === PasswordFormScopeKind.Unowned &&
      summary.passkeyControlPresent,
  );
  if (
    !unownedPasskeyAlreadyObserved &&
    pageHasPasskeyControlForScope(unownedPasskeyQuery)
  ) {
    const summaryArgs: Parameters<typeof summarizeRoot>[0] = {
      kind: PasswordFormQueryKind.Scoped,
      root,
      formScope: unownedFormScope,
    };
    const passkeyObservation: Parameters<typeof observations.push>[0] = {
      root,
      formScope: unownedFormScope,
      summary: summarizeRoot(summaryArgs),
    };
    observations.push(passkeyObservation);
  }
  return observations.sort(
    // eslint-disable-next-line max-params -- Array.sort owns the comparator callback signature.
    (left, right) => passwordFormPriority(right) - passwordFormPriority(left),
  );
}

type ActionableAuthenticationWorkflowQuery = {
  observations: readonly PasswordFormObservation[];
};

/** Report whether DOM evidence contains an interactive authentication ceremony. */
export function authenticationWorkflowFormsHaveActionableControl({
  observations,
}: ActionableAuthenticationWorkflowQuery): boolean {
  const input: AuthenticationPageObservationFactsBatch = {
    observations: observations
      .slice(0, MAX_AUTHENTICATION_WORKFLOW_CLASSIFICATION_OBSERVATIONS)
      .map(({ summary }) =>
        portableAuthenticationPageObservationFacts(summary),
      ),
  };
  const workflowMatch = classify_companion_authentication_workflow(input);
  return (
    companion_authentication_workflow_match_kind(workflowMatch) ===
    CompanionAuthenticationWorkflowMatchKind.Matched
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

export function submitLoginForm(request: PasswordFormScopeQuery): boolean {
  const initialPasswordFieldQuery = passwordFieldQuery(request);
  const initialPasswordFields = findPasswordFields(initialPasswordFieldQuery);
  const initialUsernameFieldQuery = passwordFieldQuery(request);
  const initialUsernameFields = findUsernameFields(initialUsernameFieldQuery);
  const anchor = initialPasswordFields[0] ?? initialUsernameFields[0];
  if (!anchor) return false;

  const form = anchor.form;
  const authenticationRequest: PasswordFormScopeQuery =
    request.kind === PasswordFormQueryKind.Root && form
      ? {
          kind: PasswordFormQueryKind.Scoped,
          root: request.root,
          formScope: { kind: PasswordFormScopeKind.Owned, owner: form },
        }
      : request;
  const passwordFieldsQuery = passwordFieldQuery(authenticationRequest);
  const passwordFields = findPasswordFields(passwordFieldsQuery);
  const usernameFieldsQuery = passwordFieldQuery(authenticationRequest);
  const usernameFields = findUsernameFields(usernameFieldsQuery);
  const oneTimeCodeFieldQuery = passwordFieldQuery(authenticationRequest);
  const oneTimeCodeFields = findOneTimeCodeFields(oneTimeCodeFieldQuery);
  const newPasswordFieldCount = passwordFields.filter((field) => {
    const autocompleteQuery: Parameters<typeof hasAutocompleteToken>[0] = {
      field,
      expected: "new-password",
    };
    return hasAutocompleteToken(autocompleteQuery);
  }).length;
  const contextSource: AuthenticationAdvanceControlContextSource = {
    request: authenticationRequest,
    usernameFields,
    passwordFieldCount: passwordFields.length,
    newPasswordFieldCount,
    oneTimeCodeFieldCount: oneTimeCodeFields.length,
  };
  const authenticationControlContext =
    authenticationAdvanceControlContext(contextSource);
  const candidateControls = authenticationAdvanceControls(
    authenticationRequest,
  );
  const acceptedControls = candidateControls.filter((control) => {
    if (isResetControl(control) || isPlainNavigationControl(control)) {
      return false;
    }
    const decision: AuthenticationAdvanceControlCandidate = {
      control,
      request: authenticationRequest,
      ...authenticationControlContext,
    };
    return isAuthenticationAdvanceControl(decision);
  });
  const actionableSemanticSubmitPresent = candidateControls.some(
    (control) =>
      isSemanticSubmitControl(control) && isActionablePageControl(control),
  );
  const recognizedActivationControls = actionableSemanticSubmitPresent
    ? candidateControls.filter((control) => {
        if (
          isSemanticSubmitControl(control) ||
          isResetControl(control) ||
          isPlainNavigationControl(control)
        ) {
          return false;
        }
        const unownedProbeRequest: PasswordFormScopeQuery = {
          kind: PasswordFormQueryKind.Scoped,
          root: authenticationRequest.root,
          formScope: { kind: PasswordFormScopeKind.Unowned },
        };
        const decision: AuthenticationAdvanceControlCandidate = {
          control,
          request: unownedProbeRequest,
          ...authenticationControlContext,
          semanticSubmitControlCount: 0,
          formIdentity: "",
        };
        return isAuthenticationAdvanceControl(decision);
      })
    : [];
  const selectableControls =
    acceptedControls.length > 0
      ? acceptedControls
      : recognizedActivationControls;
  const advanceControl =
    selectableControls.find(isSemanticSubmitControl) ?? selectableControls[0];
  if (advanceControl) {
    if (!form || !isSemanticSubmitControl(advanceControl)) {
      advanceControl.click();
      return true;
    }
    const nookTypedArgs0_28: Parameters<typeof observeSubmit>[0] = {
      form,
      action: () => advanceControl.click(),
    };
    return observeSubmit(nookTypedArgs0_28);
  }
  if (!form) return false;
  if (candidateControls.length > 0) return false;
  if (typeof form.requestSubmit === "function") {
    const nookTypedArgs0_29: Parameters<typeof observeSubmit>[0] = {
      form,
      action: () => form.requestSubmit(),
    };
    return observeSubmit(nookTypedArgs0_29);
  }
  return false;
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
