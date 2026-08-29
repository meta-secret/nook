import { companionWasmReady } from "./companion-ready";
import {
  authentication_advance_control_is_safe,
  authentication_form_observation_priority,
  authentication_passkey_control_candidate_is_safe,
  can_activate_authentication_route_control,
  strongest_authentication_username_evidence,
} from "./nook-companion-wasm/nook_companion_wasm.js";
import type {
  AuthenticationAdvanceControlObservation,
  AuthenticationDetailedPasskeyControlCandidateObservation,
  AuthenticationDetailedPasskeyControlObservation,
  AuthenticationPageObservation,
  AuthenticationPageObservationFacts,
  AuthenticationPasskeyControlObservation,
  AuthenticationUsernameEvidence,
} from "./nook-companion-wasm/nook_companion_wasm.js";
import {
  authenticationUsernameEvidence,
  findPasskeyControls,
  findOneTimeCodeFields,
  findPasswordFields,
  findUsernameFields,
  hasAutocompleteToken,
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
import {
  authenticationAdvanceControlSelector,
  authenticationRouteDestination,
  clickAdvanceControl,
  controlLabel,
  isRenderedControl,
  observeSubmit,
  PasswordFormQueryKind,
  semanticSubmitControlSelector,
  type LoginAdvanceControl,
  type PasswordFormScopeQuery,
} from "./password-form-submission-controls";

export {
  findOneTimeCodeFields,
  findPasswordFields,
  findUsernameFields,
  findPasskeyControl,
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
export {
  PasswordFormQueryKind,
  type PasswordFormScopeQuery,
} from "./password-form-submission-controls";

void companionWasmReady;

const passkeyControlAbsent =
  "absent" satisfies AuthenticationPasskeyControlObservation;
const passkeyControlPresent =
  "present" satisfies AuthenticationPasskeyControlObservation;

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

type AuthenticationRouteDestinationRequest = {
  form: HTMLFormElement;
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
    ? formScope.owner.ownerDocument
    : root;
}

function controlAssociatesWithObservation({
  control,
  formScope,
  root,
}: {
  control: HTMLElement;
  formScope: PasswordFormScope;
  root: ParentNode;
}): boolean {
  if (formScope.kind === PasswordFormScopeKind.Owned) {
    if (
      control instanceof HTMLButtonElement ||
      control instanceof HTMLInputElement
    ) {
      return control.form === formScope.owner;
    }
    return formScope.owner.contains(control);
  }
  if (
    control instanceof HTMLButtonElement ||
    control instanceof HTMLInputElement
  ) {
    return !control.form || root === control.ownerDocument;
  }
  return true;
}

function observedFormIdentity({
  root,
  formScope,
}: PasswordFormObservation): string {
  const owner =
    formScope.kind === PasswordFormScopeKind.Owned ? formScope.owner : root;
  return owner instanceof Element
    ? [
        owner.id,
        owner.className,
        owner.getAttribute("name") ?? "",
        owner.getAttribute("role") ?? "",
        owner.getAttribute("aria-label") ?? "",
      ].join(" ")
    : "";
}

function observedFormDestination({
  formScope,
}: PasswordFormObservation): string {
  if (formScope.kind !== PasswordFormScopeKind.Owned) return "";
  return formScope.owner.hasAttribute("action")
    ? formScope.owner.action
    : (formScope.owner.ownerDocument.defaultView?.location.href ?? "");
}

type ControlDestinationRequest = {
  control: HTMLElement;
  formScope: PasswordFormScope;
};

function controlDestination({
  control,
  formScope,
}: ControlDestinationRequest): string {
  if (control instanceof HTMLAnchorElement) return control.href;
  if (
    (control instanceof HTMLButtonElement ||
      control instanceof HTMLInputElement) &&
    control.hasAttribute("formaction")
  ) {
    return control.formAction;
  }
  if (
    (control instanceof HTMLButtonElement ||
      control instanceof HTMLInputElement) &&
    control.form
  ) {
    return control.form.hasAttribute("action")
      ? control.form.action
      : (control.form.ownerDocument.defaultView?.location.href ?? "");
  }
  return formScope.kind === PasswordFormScopeKind.Owned
    ? formScope.owner.hasAttribute("action")
      ? formScope.owner.action
      : (formScope.owner.ownerDocument.defaultView?.location.href ?? "")
    : location.href;
}

function scopedAdvanceControls(
  observation: PasswordFormObservation,
): HTMLElement[] {
  const queryRoot =
    observation.formScope.kind === PasswordFormScopeKind.Owned
      ? observation.formScope.owner.ownerDocument
      : observation.root;
  return Array.from(
    queryRoot.querySelectorAll<HTMLElement>(
      authenticationAdvanceControlSelector,
    ),
  ).filter((control) => {
    if (
      !(control instanceof HTMLButtonElement) &&
      !(control instanceof HTMLInputElement)
    ) {
      return false;
    }
    return observation.formScope.kind === PasswordFormScopeKind.Owned
      ? control.form === observation.formScope.owner
      : !control.form;
  });
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
  return strongest_authentication_username_evidence(evidence);
}

type PageControlObservationRequest = {
  observation: PasswordFormObservation;
  control: HTMLElement;
  authenticationUsername: AuthenticationUsernameEvidence;
  explicitlyLocallyScoped?: boolean;
};

function pageControlObservation({
  observation,
  control,
  authenticationUsername,
  explicitlyLocallyScoped = false,
}: PageControlObservationRequest): AuthenticationAdvanceControlObservation {
  const semanticSubmitControls = scopedAdvanceControls(observation).filter(
    (candidate) => candidate.matches(semanticSubmitControlSelector),
  );
  const semanticSubmit = control.matches(semanticSubmitControlSelector);
  const owned =
    observation.formScope.kind === PasswordFormScopeKind.Owned &&
    (control instanceof HTMLButtonElement ||
      control instanceof HTMLInputElement) &&
    control.form === observation.formScope.owner;
  const destinationRequest: ControlDestinationRequest = {
    control,
    formScope: observation.formScope,
  };
  return {
    actionability:
      (control as HTMLButtonElement).disabled ||
      control.getAttribute("aria-disabled") === "true"
        ? "inert"
        : "actionable",
    ownership: owned
      ? "owned-form"
      : explicitlyLocallyScoped ||
          (observation.root !== document && observation.root.contains(control))
        ? "locally-scoped"
        : "unowned",
    semantics: semanticSubmit ? "semantic-submit" : "activation",
    authenticationUsername,
    passwordFieldCount: observation.summary.passwordFieldCount,
    newPasswordFieldCount: observation.summary.newPasswordFieldCount,
    oneTimeCodeFieldCount: observation.summary.oneTimeCodeFieldCount,
    semanticSubmitControlCount: semanticSubmitControls.length,
    sourceOrigin: location.origin,
    formIdentity: observedFormIdentity(observation),
    destinationIdentity: controlDestination(destinationRequest),
    label: controlLabel(control),
  };
}

/** Bind the first DOM candidate that Rust accepts in the approved workflow scope. */
export function findWorkflowPasskeyControl(
  observation: PasswordFormObservation,
): PasskeyControlLookup {
  const authenticationUsername = usernameEvidence(observation);
  const candidate = findPasskeyControls(scopedControlRoot(observation)).find(
    ({ control, explicitlyMarked }) => {
      if (
        !controlAssociatesWithObservation({
          control,
          formScope: observation.formScope,
          root: observation.root,
        })
      ) {
        return false;
      }
      if (!isRenderedControl(control)) return false;
      const factsRequest: PageControlObservationRequest = {
        observation,
        control,
        authenticationUsername,
        explicitlyLocallyScoped:
          observation.root === document &&
          observation.formScope.kind === PasswordFormScopeKind.Unowned,
      };
      const evidence: AuthenticationDetailedPasskeyControlCandidateObservation =
        {
          kind: explicitlyMarked ? "explicitly-marked" : "labeled",
          observation: pageControlObservation(factsRequest),
        };
      return authentication_passkey_control_candidate_is_safe(evidence);
    },
  );
  return candidate
    ? { kind: PasskeyControlLookupKind.Found, control: candidate.control }
    : { kind: PasskeyControlLookupKind.Absent };
}

/** Collect browser facts only; Rust owns every workflow and control decision. */
export function authenticationPageObservationFacts({
  observation,
  authenticatorSetupHint,
  backupCodesHint,
}: AuthenticationObservationFactsRequest): AuthenticationPageObservationFacts {
  const controlRoot = scopedControlRoot(observation);
  const authenticationUsername = usernameEvidence(observation);
  const advanceControls = scopedAdvanceControls(observation);
  const passkeyControls = findPasskeyControls(controlRoot).filter(
    ({ control }) =>
      controlAssociatesWithObservation({
        control,
        formScope: observation.formScope,
        root: observation.root,
      }),
  );
  const oneTimeCodeQuery: Parameters<typeof findOneTimeCodeFields>[0] = {
    root: observation.root,
    formScope: observation.formScope,
  };
  const oneTimeCodeHandlerSignals = findOneTimeCodeFields(
    oneTimeCodeQuery,
  ).flatMap((field) =>
    ["oninput", "onchange"].flatMap((attribute) => {
      const handler = field.getAttribute(attribute);
      return typeof handler === "string" ? [`${attribute}=${handler}`] : [];
    }),
  );
  let detailedAdvanceControl: AuthenticationPageObservationFacts["detailedAdvanceControl"] =
    { kind: PasskeyControlLookupKind.Absent };
  if (advanceControls.length > 0) {
    detailedAdvanceControl = {
      kind: "observed",
      observations: advanceControls.map((control) => {
        const request: PageControlObservationRequest = {
          observation,
          control,
          authenticationUsername,
        };
        return pageControlObservation(request);
      }),
    };
  }
  let detailedPasskeyControl: AuthenticationDetailedPasskeyControlObservation =
    { kind: PasskeyControlLookupKind.Absent };
  if (passkeyControls.length > 0) {
    const candidates: AuthenticationDetailedPasskeyControlCandidateObservation[] =
      passkeyControls.map(({ control, explicitlyMarked }) => {
        const passkeyRequest: PageControlObservationRequest = {
          observation,
          control,
          authenticationUsername,
          explicitlyLocallyScoped:
            observation.root === document &&
            observation.formScope.kind === PasswordFormScopeKind.Unowned,
        };
        return {
          kind: explicitlyMarked ? "explicitly-marked" : "labeled",
          observation: pageControlObservation(passkeyRequest),
        };
      });
    detailedPasskeyControl = { kind: "candidates", observation: candidates };
  }
  const contextFormIdentity = observedFormIdentity(observation);
  const contextDestinationIdentity = observedFormDestination(observation);
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
      oneTimeCodeHandlerSignal: "",
      oneTimeCodeHandlerSignals,
      authenticationContext: {
        authenticationUsername,
        sourceOrigin: location.origin,
        formIdentity: contextFormIdentity,
        destinationIdentity: contextDestinationIdentity,
      },
      manualCheckpoint: observation.summary.manualCheckpointPresent
        ? "present"
        : "absent",
      advanceControl:
        observation.formScope.kind === PasswordFormScopeKind.Owned &&
        !advanceControls.some((control) =>
          control.matches(semanticSubmitControlSelector),
        )
          ? "implicit-submission"
          : "absent",
    },
    authenticator: {
      authenticatorSetup: authenticatorSetupHint ? "present" : "absent",
      backupCodes: backupCodesHint ? "present" : "absent",
      passkeyControl:
        passkeyControls.length > 0
          ? passkeyControlPresent
          : passkeyControlAbsent,
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
        'button[type="submit"], input[type="submit"], button:not([type])',
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
  const authFieldCount =
    allPasswordFields.length +
    authUsernameFields.length +
    allOneTimeCodeFields.length;
  if (authFieldCount === 0) {
    if (!pageHasPasskeyControl(root)) return [];
    const nookTypedArgs0_2: PasswordFormScope = {
      kind: PasswordFormScopeKind.Unowned,
    };
    const nookTypedArgs0_13: Parameters<typeof summarizeRoot>[0] = {
      kind: PasswordFormQueryKind.Scoped,
      root,
      formScope: nookTypedArgs0_2,
    };
    return [
      {
        root,
        formScope: { kind: PasswordFormScopeKind.Unowned },
        summary: summarizeRoot(nookTypedArgs0_13),
      },
    ];
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
    return (
      summary.passwordFieldCount > 0 ||
      summary.oneTimeCodeFieldCount > 0 ||
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

export function submitLoginForm(request: PasswordFormScopeQuery): boolean {
  const nookTypedArgs0_26 = passwordFieldQuery(request);
  const passwordField = findPasswordFields(nookTypedArgs0_26)[0];
  const nookTypedArgs0_27 = passwordFieldQuery(request);
  const usernameField = findUsernameFields(nookTypedArgs0_27)[0];
  const anchor = passwordField ?? usernameField;
  if (!anchor) return false;

  // Email-first / multi-step logins often use a type=button "Next" control
  // rather than a real submit. Prefer an advance control before requestSubmit
  // only while the password step is still missing.
  if (!passwordField) {
    const nookNamedArgs0_4: Parameters<typeof clickAdvanceControl>[0] = {
      ...request,
      usernameField,
    };
    if (clickAdvanceControl(nookNamedArgs0_4)) return true;
    const form = usernameField.form;
    const sourceOrigin = form?.ownerDocument.defaultView?.location.origin;
    if (!form || !sourceOrigin) return false;
    const destinationRequest: AuthenticationRouteDestinationRequest = {
      form,
    };
    if (
      Array.from(
        form.ownerDocument.querySelectorAll<HTMLElement>(
          semanticSubmitControlSelector,
        ),
      ).some((control) => {
        if (
          !(control instanceof HTMLButtonElement) &&
          !(control instanceof HTMLInputElement)
        ) {
          return false;
        }
        return control.form === form;
      }) ||
      !can_activate_authentication_route_control(
        sourceOrigin,
        [
          form.id,
          form.getAttribute("name") ?? "",
          form.getAttribute("class") ?? "",
          form.getAttribute("aria-label") ?? "",
        ].join(" "),
        authenticationRouteDestination(destinationRequest),
        "",
        "",
        false,
        isAuthUsernameField(usernameField),
        true,
      )
    ) {
      return false;
    }
    const nookTypedArgs0_28: Parameters<typeof observeSubmit>[0] = {
      form,
      action: () => form.requestSubmit(),
    };
    return observeSubmit(nookTypedArgs0_28);
  }

  const form = anchor.form;
  if (!form) {
    // Password present without a real <form>: fill succeeded, but do not
    // claim submission for opaque type=button host chrome.
    return false;
  }

  const submitControls = Array.from(
    form.ownerDocument.querySelectorAll<LoginAdvanceControl>(
      semanticSubmitControlSelector,
    ),
  ).filter((control) => control.form === form);
  const formWithinRequestRoot =
    request.root === form.ownerDocument ||
    (request.root instanceof Node && request.root.contains(form));
  const observation: PasswordFormObservation | false =
    request.kind === PasswordFormQueryKind.Scoped
      ? {
          root: request.root,
          formScope: request.formScope,
          summary: summarizeRoot(request),
        }
      : (summarizeAuthenticationWorkflowForms().find(
          (candidate) =>
            formWithinRequestRoot &&
            candidate.formScope.kind === PasswordFormScopeKind.Owned &&
            candidate.formScope.owner === form,
        ) ?? false);
  const submitControl = observation
    ? submitControls.find((control) => {
        if (!isRenderedControl(control)) return false;
        const factsRequest: PageControlObservationRequest = {
          observation,
          control,
          authenticationUsername: usernameEvidence(observation),
        };
        return authentication_advance_control_is_safe(
          pageControlObservation(factsRequest),
        );
      })
    : false;
  if (submitControl) {
    const nookTypedArgs0_28: Parameters<typeof observeSubmit>[0] = {
      form,
      action: () => submitControl.click(),
    };
    return observeSubmit(nookTypedArgs0_28);
  }
  if (submitControls.length === 0 && typeof form.requestSubmit === "function") {
    const nookTypedArgs0_29: Parameters<typeof observeSubmit>[0] = {
      form,
      action: () => form.requestSubmit(),
    };
    return observeSubmit(nookTypedArgs0_29);
  }
  return false;
}
