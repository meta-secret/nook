import { companionWasmReady } from "./companion-ready";
import {
  authentication_advance_control_is_safe,
  authentication_page_observation_facts_priority,
  authentication_passkey_control_candidate_is_safe,
  looks_like_one_time_code_auto_submit_signal,
} from "./nook-companion-wasm/nook_companion_wasm.js";
import type {
  AuthenticationAdvanceControlObservation,
  AuthenticationDetailedPasskeyControlCandidateObservation,
  AuthenticationDetailedPasskeyControlObservation,
  AuthenticationCredentialSubmissionObservation,
  AuthenticationPageObservationFacts,
  AuthenticationPasskeyControlObservation,
  AuthenticationUsernameEvidence,
} from "./nook-companion-wasm/nook_companion_wasm.js";
import {
  findPasskeyControls,
  findOneTimeCodeFields,
  findPasswordFields,
  findUsernameFields,
  hasAutocompleteToken,
  preferredOneTimeCodeFillField,
  isAuthUsernameField,
  controlAssociatesWithObservation,
  isLocallyAdjacentToOwnedForm,
  nearestUnownedAuthContainer,
  pageHasManualCheckpoint,
  pageHasPasskeyControl,
  PasskeyControlLookupKind,
  PasswordFormScopeKind,
  usernameEvidence,
} from "./password-form-fields";
import type {
  ControlObservationAssociationRequest,
  LocalOwnedFormAdjacencyRequest,
  PasskeyControlLookup,
  PasswordFieldQuery,
  PasswordFormScope,
} from "./password-form-fields";
import {
  associatedAuthenticationForm,
  authenticationAdvanceControlSelector,
  authenticationFactStringsAreTransportable,
  authenticationPolicyTextFits,
  boundAuthenticationControlObservations,
  countedSemanticSubmitControls,
  observedFormDestination,
  observedFormIdentity,
  clickAdvanceControl,
  controlDestinationIdentity,
  controlIsInert,
  controlLabel,
  controlMachineIdentity,
  controlSubmissionMethod,
  formBlocksCredentialDisclosure,
  selectedSubmitterBlocksCredentialDisclosure,
  formSubmissionMethod,
  PageControlSubmissionMethod,
  isRenderedControl,
  observeSubmit,
  requestImplicitAuthenticationSubmit,
  ownedFormIdentity,
  PasswordFormQueryKind,
  semanticSubmitControlSelector,
  type LoginAdvanceControl,
  type PasswordFormScopeQuery,
} from "./password-form-submission-controls";
import {
  appendIndependentPasskeyOnlyWorkflows,
  summarizePasskeyOnlyWorkflowForms,
} from "./password-form-passkey-only-workflows";

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
  manualCheckpointPresent: boolean;
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

type NativeInputValueMutation = { input: HTMLInputElement; value: string };

type PasswordFormSummaryRequest = PasswordFormScopeQuery;

export type OneTimeCodeFillRequest = PasswordFormScopeQuery & { code: string };

export type LoginCredentialsFillRequest = PasswordFormScopeQuery & {
  credentials: LoginCredentials;
};

export type GeneratedPasswordFillRequest = PasswordFormScopeQuery & {
  password: string;
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

const emptyPasswordFormSummary: PasswordFormSummary = {
  passwordFieldCount: 0,
  currentPasswordFieldCount: 0,
  newPasswordFieldCount: 0,
  genericPasswordFieldCount: 0,
  usernameFieldCount: 0,
  oneTimeCodeFieldCount: 0,
  manualCheckpointPresent: false,
  passkeyControlPresent: false,
  formCount: 0,
  observedAt: 0,
};
function passwordFormPriority(observation: PasswordFormObservation): number {
  const factsRequest: AuthenticationObservationFactsRequest = {
    observation,
    authenticatorSetupHint: false,
    backupCodesHint: false,
  };
  return authentication_page_observation_facts_priority(
    authenticationPageObservationFacts(factsRequest),
  );
}

function scopedControlRoot({
  root,
  formScope,
}: PasswordFormObservation): ParentNode {
  return formScope.kind === PasswordFormScopeKind.Owned
    ? formScope.owner.ownerDocument
    : root;
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

type PageControlObservationRequest = {
  observation: PasswordFormObservation;
  control: HTMLElement;
  authenticationUsername: AuthenticationUsernameEvidence;
  semanticSubmitControlCount: number;
  explicitlyLocallyScoped?: boolean;
};

function pageControlObservation({
  observation,
  control,
  authenticationUsername,
  explicitlyLocallyScoped = false,
  semanticSubmitControlCount,
}: PageControlObservationRequest): AuthenticationAdvanceControlObservation {
  const semanticSubmit = control.matches(semanticSubmitControlSelector);
  const controlForm = associatedAuthenticationForm(control);
  const owned = controlForm.kind === PasswordFormScopeKind.Owned;
  const destinationRequest: Parameters<typeof controlDestinationIdentity>[0] = {
    control,
    formScope: observation.formScope,
  };
  const unownedIdentityRequest: Parameters<typeof observedFormIdentity>[0] = {
    root: observation.root,
    formScope: observation.formScope,
  };
  return {
    actionability: controlIsInert(control) ? "inert" : "actionable",
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
    semanticSubmitControlCount,
    sourceOrigin: location.origin,
    formIdentity: owned
      ? ownedFormIdentity(controlForm.owner)
      : observedFormIdentity(unownedIdentityRequest),
    destinationIdentity: controlDestinationIdentity(destinationRequest),
    label: controlLabel(control),
    machineIdentity: controlMachineIdentity(control),
    submissionMethod: controlSubmissionMethod(control),
  };
}

function transportableControlObservation(
  request: PageControlObservationRequest,
): AuthenticationAdvanceControlObservation[] {
  const observation = pageControlObservation(request);
  if (
    observation.submissionMethod === PageControlSubmissionMethod.Get ||
    observation.submissionMethod === PageControlSubmissionMethod.Dialog
  )
    return [];
  return authenticationFactStringsAreTransportable([
    observation.sourceOrigin,
    observation.formIdentity,
    observation.destinationIdentity,
    observation.label,
    controlMachineIdentity(request.control),
  ])
    ? [observation]
    : [];
}
type PasskeyCandidateSafetyRequest = {
  candidate: { control: HTMLElement; explicitlyMarked: boolean };
  observation: PasswordFormObservation;
};

function passkeyCandidateIsRustSafe({
  candidate,
  observation,
}: PasskeyCandidateSafetyRequest): boolean {
  const { control, explicitlyMarked } = candidate;
  if (!isRenderedControl(control)) return false;
  const adjacencyRequest: LocalOwnedFormAdjacencyRequest | false =
    observation.formScope.kind === PasswordFormScopeKind.Owned
      ? { control, owner: observation.formScope.owner }
      : false;
  const factsRequest: PageControlObservationRequest = {
    observation,
    control,
    authenticationUsername: usernameEvidence(observation),
    semanticSubmitControlCount: countedSemanticSubmitControls(
      scopedAdvanceControls(observation),
    ),
    explicitlyLocallyScoped:
      (observation.root === document &&
        observation.formScope.kind === PasswordFormScopeKind.Unowned) ||
      Boolean(
        adjacencyRequest && isLocallyAdjacentToOwnedForm(adjacencyRequest),
      ),
  };
  const [transported] = transportableControlObservation(factsRequest);
  if (!transported) return false;
  const evidence: AuthenticationDetailedPasskeyControlCandidateObservation = {
    kind: explicitlyMarked ? "explicitly-marked" : "labeled",
    observation: transported,
  };
  return authentication_passkey_control_candidate_is_safe(evidence);
}

export function findWorkflowPasskeyControl(
  observation: PasswordFormObservation,
): PasskeyControlLookup {
  const summaryRequest: Parameters<typeof summarizeRoot>[0] = {
    kind: PasswordFormQueryKind.Scoped,
    root: observation.root,
    formScope: observation.formScope,
  };
  const liveObservation: PasswordFormObservation = {
    ...observation,
    summary: summarizeRoot(summaryRequest),
  };
  const candidate = findPasskeyControls(
    scopedControlRoot(liveObservation),
  ).find((passkeyCandidate) => {
    const associationRequest: ControlObservationAssociationRequest = {
      control: passkeyCandidate.control,
      formScope: liveObservation.formScope,
      root: liveObservation.root,
    };
    const safetyRequest: PasskeyCandidateSafetyRequest = {
      candidate: passkeyCandidate,
      observation: liveObservation,
    };
    return (
      controlAssociatesWithObservation(associationRequest) &&
      passkeyCandidateIsRustSafe(safetyRequest)
    );
  });
  return candidate
    ? { kind: PasskeyControlLookupKind.Found, control: candidate.control }
    : { kind: PasskeyControlLookupKind.Absent };
}

export function authenticationPageObservationFacts({
  observation,
  authenticatorSetupHint,
  backupCodesHint,
}: AuthenticationObservationFactsRequest): AuthenticationPageObservationFacts {
  const controlRoot = scopedControlRoot(observation);
  const authenticationUsername = usernameEvidence(observation);
  const advanceControls = scopedAdvanceControls(observation);
  const semanticSubmitControlCount =
    countedSemanticSubmitControls(advanceControls);
  const passkeyControls = findPasskeyControls(controlRoot).filter(
    ({ control }) => {
      const associationRequest: ControlObservationAssociationRequest = {
        control,
        formScope: observation.formScope,
        root: observation.root,
      };
      return controlAssociatesWithObservation(associationRequest);
    },
  );
  const oneTimeCodeQuery: Parameters<typeof findOneTimeCodeFields>[0] = {
    root: observation.root,
    formScope: observation.formScope,
  };
  const oneTimeCodeBoundRequest: Parameters<
    typeof boundAuthenticationControlObservations<string>
  >[0] = {
    candidates: findOneTimeCodeFields(oneTimeCodeQuery).flatMap((field) =>
      ["oninput", "onchange"].flatMap((attribute) => {
        const handler = field.getAttribute(attribute);
        if (typeof handler !== "string") return [];
        const signal = `${attribute}=${handler}`;
        return authenticationPolicyTextFits(signal) ? [signal] : [];
      }),
    ),
    isPreferred: (signal) =>
      looks_like_one_time_code_auto_submit_signal(signal),
  };
  const oneTimeCodeHandlerSignals = boundAuthenticationControlObservations(
    oneTimeCodeBoundRequest,
  );
  const passwordFieldQuery: PasswordFieldQuery = {
    root: observation.root,
    formScope: observation.formScope,
  };
  const passwordFields = findPasswordFields(passwordFieldQuery);
  const readonlyPasswordFieldCount = passwordFields.filter(
    (field) => field.readOnly,
  ).length;
  let detailedAdvanceControl: AuthenticationPageObservationFacts["detailedAdvanceControl"] =
    { kind: PasskeyControlLookupKind.Absent };
  const advanceObservations = advanceControls.flatMap((control) => {
    const request: PageControlObservationRequest = {
      observation,
      control,
      authenticationUsername,
      semanticSubmitControlCount,
    };
    return transportableControlObservation(request);
  });
  const advanceBoundRequest: Parameters<
    typeof boundAuthenticationControlObservations<
      (typeof advanceObservations)[number]
    >
  >[0] = {
    candidates: advanceObservations,
    isPreferred: (candidate) =>
      candidate.actionability === "actionable" &&
      authentication_advance_control_is_safe(candidate),
  };
  const boundedAdvanceObservations =
    boundAuthenticationControlObservations(advanceBoundRequest);
  if (boundedAdvanceObservations.length > 0) {
    detailedAdvanceControl = {
      kind: "observed",
      observations: boundedAdvanceObservations,
    };
  }
  let detailedPasskeyControl: AuthenticationDetailedPasskeyControlObservation =
    { kind: PasskeyControlLookupKind.Absent };
  const passkeyCandidates = passkeyControls.flatMap(
    ({ control, explicitlyMarked }) => {
      const adjacencyRequest: LocalOwnedFormAdjacencyRequest | false =
        observation.formScope.kind === PasswordFormScopeKind.Owned
          ? { control, owner: observation.formScope.owner }
          : false;
      const passkeyRequest: PageControlObservationRequest = {
        observation,
        control,
        authenticationUsername,
        semanticSubmitControlCount,
        explicitlyLocallyScoped:
          (observation.root === document &&
            observation.formScope.kind === PasswordFormScopeKind.Unowned) ||
          Boolean(
            adjacencyRequest && isLocallyAdjacentToOwnedForm(adjacencyRequest),
          ),
      };
      return transportableControlObservation(passkeyRequest).map(
        (candidateObservation) =>
          ({
            kind: explicitlyMarked ? "explicitly-marked" : "labeled",
            observation: candidateObservation,
          }) as AuthenticationDetailedPasskeyControlCandidateObservation,
      );
    },
  );
  const passkeyBoundRequest: Parameters<
    typeof boundAuthenticationControlObservations<
      (typeof passkeyCandidates)[number]
    >
  >[0] = {
    candidates: passkeyCandidates,
    isPreferred: (candidate) =>
      candidate.observation.actionability === "actionable" &&
      authentication_passkey_control_candidate_is_safe(candidate),
    isNextPreferred: (candidate) =>
      candidate.observation.actionability === "actionable",
  };
  const boundedPasskeyCandidates =
    boundAuthenticationControlObservations(passkeyBoundRequest);
  if (boundedPasskeyCandidates.length > 0) {
    detailedPasskeyControl = {
      kind: "candidates",
      observation: boundedPasskeyCandidates,
    };
  }
  const contextIdentityRequest: Parameters<typeof observedFormIdentity>[0] = {
    root: observation.root,
    formScope: observation.formScope,
  };
  const contextFormIdentity = observedFormIdentity(contextIdentityRequest);
  const contextDestinationIdentity = observedFormDestination(
    observation.formScope,
  );
  const implicitSubmissionAvailable =
    observation.formScope.kind === PasswordFormScopeKind.Owned &&
    !advanceControls.some(
      (control) =>
        control.matches(semanticSubmitControlSelector) &&
        !controlIsInert(control),
    ) &&
    !(
      observation.summary.currentPasswordFieldCount +
        observation.summary.genericPasswordFieldCount +
        observation.summary.newPasswordFieldCount >
        0 && formBlocksCredentialDisclosure(observation.formScope.owner)
    );
  let credentialSubmission: AuthenticationCredentialSubmissionObservation = {
    kind: "absent",
  };
  const selectedAdvanceObservation = boundedAdvanceObservations[0];
  if (
    selectedAdvanceObservation &&
    selectedAdvanceObservation.submissionMethod !==
      PageControlSubmissionMethod.Absent
  ) {
    credentialSubmission = {
      kind: "observed",
      facts: {
        actionability: selectedAdvanceObservation.actionability,
        method: selectedAdvanceObservation.submissionMethod,
        sourceOrigin: selectedAdvanceObservation.sourceOrigin,
        formIdentity: selectedAdvanceObservation.formIdentity,
        destinationIdentity: selectedAdvanceObservation.destinationIdentity,
      },
    };
  } else if (
    implicitSubmissionAvailable &&
    observation.formScope.kind === PasswordFormScopeKind.Owned
  ) {
    credentialSubmission = {
      kind: "observed",
      facts: {
        actionability: "actionable",
        method: formSubmissionMethod(observation.formScope.owner),
        sourceOrigin: location.origin,
        formIdentity: contextFormIdentity,
        destinationIdentity: contextDestinationIdentity,
      },
    };
  }
  return {
    fields: {
      usernameFieldCount: observation.summary.usernameFieldCount,
      currentPasswordFieldCount: observation.summary.currentPasswordFieldCount,
      newPasswordFieldCount: observation.summary.newPasswordFieldCount,
      genericPasswordFieldCount: observation.summary.genericPasswordFieldCount,
      oneTimeCodeFieldCount: observation.summary.oneTimeCodeFieldCount,
      actionablePasswordFieldCount:
        passwordFields.length - readonlyPasswordFieldCount,
      readonlyPasswordFieldCount,
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
      implicitSubmissionMethod:
        observation.formScope.kind === PasswordFormScopeKind.Owned
          ? formSubmissionMethod(observation.formScope.owner)
          : PageControlSubmissionMethod.Absent,
      advanceControl: implicitSubmissionAvailable
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
    credentialSubmission,
    detailedAdvanceControl,
  };
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
  const passkeyOnlyRequest: Parameters<
    typeof summarizePasskeyOnlyWorkflowForms<PasswordFormSummary>
  >[0] = {
    root,
    summarizeRoot,
    observationPriority: passwordFormPriority,
    passkeyControlIsSafe: passkeyCandidateIsRustSafe,
    emptySummary: emptyPasswordFormSummary,
  };
  const passkeyOnly = summarizePasskeyOnlyWorkflowForms(passkeyOnlyRequest);
  if (authFieldCount === 0) {
    return passkeyOnly;
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
    unownedFields.flatMap((field) => {
      const nookArrowArgs2: Parameters<typeof nearestUnownedAuthContainer>[0] =
        { field, root };
      const container = nearestUnownedAuthContainer(nookArrowArgs2);
      return container === field ? [] : [container];
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
  const mergeRequest: Parameters<
    typeof appendIndependentPasskeyOnlyWorkflows<PasswordFormObservation>
  >[0] = {
    fieldBearing: observations,
    passkeyOnly,
    observationPriority: passwordFormPriority,
    passkeyControlIsSafe: passkeyCandidateIsRustSafe,
  };
  return appendIndependentPasskeyOnlyWorkflows(mergeRequest);
}
export function fillOneTimeCode(request: OneTimeCodeFillRequest): boolean {
  const nookTypedArgs0_16 = passwordFieldQuery(request);
  const field = preferredOneTimeCodeFillField(
    findOneTimeCodeFields(nookTypedArgs0_16),
  );
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
  const approvedPasswordForm = passwordField.form;
  const passwordFieldRemainsEligible = (): boolean =>
    passwordField.form === approvedPasswordForm &&
    findPasswordFields(passwordFieldQuery(request)).includes(passwordField);
  function formBlocksFill(form: HTMLFormElement): boolean {
    const advanceRequest: OwnedAdvanceControlRequest = { request, form };
    const disclosureRequest: Parameters<
      typeof selectedSubmitterBlocksCredentialDisclosure
    >[0] = {
      form,
      selectedSubmitter: findApprovedOwnedAdvanceControl(advanceRequest),
    };
    return selectedSubmitterBlocksCredentialDisclosure(disclosureRequest);
  }
  function passwordFieldBlocksFill(): boolean {
    if (!passwordFieldRemainsEligible()) return true;
    return approvedPasswordForm ? formBlocksFill(approvedPasswordForm) : false;
  }
  if (passwordFieldBlocksFill()) return false;
  if (usernameField) {
    const nookTypedArgs0_21: Parameters<typeof setNativeInputValue>[0] = {
      input: usernameField,
      value: request.credentials.username,
    };
    setNativeInputValue(nookTypedArgs0_21);
    if (passwordFieldBlocksFill()) return false;
  }
  const nookTypedArgs0_22: Parameters<typeof setNativeInputValue>[0] = {
    input: passwordField,
    value: request.credentials.password,
  };
  setNativeInputValue(nookTypedArgs0_22);
  if (passwordFieldBlocksFill()) {
    nookTypedArgs0_22.value = "";
    setNativeInputValue(nookTypedArgs0_22);
    return false;
  }
  return true;
}
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

enum OwnedAdvanceControlActivationKind {
  Absent = "absent",
  Activated = "activated",
}

type OwnedAdvanceControlActivation =
  | { kind: OwnedAdvanceControlActivationKind.Absent }
  | {
      kind: OwnedAdvanceControlActivationKind.Activated;
      submitted: boolean;
    };

type OwnedAdvanceControlRequest = {
  request: PasswordFormScopeQuery;
  form: HTMLFormElement;
};

function findApprovedOwnedAdvanceControl({
  request,
  form,
}: OwnedAdvanceControlRequest): LoginAdvanceControl | false {
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
  return (
    observation &&
    (Array.from(
      form.ownerDocument.querySelectorAll<LoginAdvanceControl>(
        authenticationAdvanceControlSelector,
      ),
    )
      .filter((control) => control.form === form)
      .sort(
        (...pair) =>
          Number(pair[1].matches(semanticSubmitControlSelector)) -
          Number(pair[0].matches(semanticSubmitControlSelector)),
      )
      .find((control) => {
        if (!isRenderedControl(control)) return false;
        const factsRequest: PageControlObservationRequest = {
          observation,
          control,
          authenticationUsername: usernameEvidence(observation),
          semanticSubmitControlCount: countedSemanticSubmitControls(
            scopedAdvanceControls(observation),
          ),
        };
        const [transported] = transportableControlObservation(factsRequest);
        return (
          Boolean(transported) &&
          authentication_advance_control_is_safe(transported)
        );
      }) ??
      false)
  );
}

function activateApprovedOwnedAdvanceControl({
  request,
  form,
}: OwnedAdvanceControlRequest): OwnedAdvanceControlActivation {
  const approvedRequest: OwnedAdvanceControlRequest = { request, form };
  const approved = findApprovedOwnedAdvanceControl(approvedRequest);
  if (!approved) return { kind: OwnedAdvanceControlActivationKind.Absent };
  if (!approved.matches(semanticSubmitControlSelector)) {
    approved.click();
    return {
      kind: OwnedAdvanceControlActivationKind.Activated,
      submitted: true,
    };
  }
  const clickSubmission: Parameters<typeof observeSubmit>[0] = {
    form,
    action: () => approved.click(),
  };
  const submitted = observeSubmit(clickSubmission);
  if (
    !submitted &&
    approved instanceof HTMLInputElement &&
    approved.type === "image"
  ) {
    clickSubmission.action = () => form.requestSubmit(approved);
    return {
      kind: OwnedAdvanceControlActivationKind.Activated,
      submitted: observeSubmit(clickSubmission),
    };
  }
  return {
    kind: OwnedAdvanceControlActivationKind.Activated,
    submitted,
  };
}

export function submitLoginForm(request: PasswordFormScopeQuery): boolean {
  const nookTypedArgs0_26 = passwordFieldQuery(request);
  const passwordField = findPasswordFields(nookTypedArgs0_26)[0];
  const nookTypedArgs0_27 = passwordFieldQuery(request);
  const usernameFields = findUsernameFields(nookTypedArgs0_27);
  const usernameField = usernameFields[0];
  const hasAuthenticationUsername = usernameFields.some(isAuthUsernameField);
  const anchor = passwordField ?? usernameField;
  if (!anchor) return false;
  const form = anchor.form;
  if (form) {
    const activationRequest: OwnedAdvanceControlRequest = { request, form };
    const activation = activateApprovedOwnedAdvanceControl(activationRequest);
    if (activation.kind === OwnedAdvanceControlActivationKind.Activated) {
      return activation.submitted;
    }
  }
  if (!passwordField) {
    const nookNamedArgs0_4: Parameters<typeof clickAdvanceControl>[0] = {
      ...request,
      usernameField,
    };
    if (clickAdvanceControl(nookNamedArgs0_4)) return true;
  }
  if (!form) return false;
  const implicitRequest: Parameters<
    typeof requestImplicitAuthenticationSubmit
  >[0] = {
    form,
    hasAuthenticationUsername,
    hasAuthenticationPassword: Boolean(passwordField),
  };
  return requestImplicitAuthenticationSubmit(implicitRequest);
}
