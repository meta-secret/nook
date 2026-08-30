import { authentication_advance_control_is_safe } from "./nook-companion-wasm/nook_companion_wasm.js";
import type { AuthenticationAdvanceControlObservation } from "./nook-companion-wasm/nook_companion_wasm.js";
import {
  findOneTimeCodeFields,
  findPasskeyControls,
  findPasswordFields,
  findUsernameFields,
  hasAutocompleteToken,
  localUnownedPasskeyContainer,
  pageHasPasskeyControl,
  PasswordFormScopeKind,
  usernameEvidence,
  type PasskeyControlCandidate,
  type PasswordFieldQuery,
  type PasswordFormScope,
  type UnownedAuthContainerRequest,
} from "./password-form-fields";
import {
  associatedAuthenticationForm,
  authenticationAdvanceControlSelector,
  authenticationFactStringsAreTransportable,
  controlDestinationIdentity,
  controlIsInert,
  controlLabel,
  controlMachineIdentity,
  controlSubmissionMethod,
  countedSemanticSubmitControls,
  formBlocksCredentialDisclosure,
  formHasPostMethodSubmitter,
  formHasRustClassifiableAdvanceControl,
  MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS,
  observedFormIdentity,
  PasswordFormQueryKind,
  semanticSubmitControlSelector,
  type PasswordFormScopeQuery,
} from "./password-form-submission-controls";

type RankableWorkflowSummary = {
  oneTimeCodeFieldCount: number;
  passwordFieldCount: number;
};

type PasskeyOnlyWorkflowObservation<Summary> = {
  root: ParentNode;
  formScope: PasswordFormScope;
  summary: Summary;
};

type RankableWorkflowObservation = {
  root: ParentNode;
  formScope: PasswordFormScope;
  summary: RankableWorkflowSummary;
};

type PasskeyOnlyScope = {
  root: ParentNode;
  formScope: PasswordFormScope;
};

type PasskeyControlSafetyRequest<Observation> = {
  candidate: PasskeyControlCandidate;
  observation: Observation;
};

type PasskeyControlIsSafe<Observation> = (
  request: PasskeyControlSafetyRequest<Observation>,
) => boolean;

type RankedPasskeyObservation<Observation> = {
  observation: Observation;
  safe: boolean;
  priority: number;
};

type IndexedPasskeyCandidates = {
  owned: Map<HTMLFormElement, PasskeyControlCandidate[]>;
  unowned: PasskeyControlCandidate[];
};

export type SummarizePasskeyOnlyWorkflowFormsRequest<Summary> = {
  root: Document;
  summarizeRoot: (query: PasswordFormScopeQuery) => Summary;
  observationPriority: (
    observation: PasskeyOnlyWorkflowObservation<Summary>,
  ) => number;
  passkeyControlIsSafe: PasskeyControlIsSafe<
    PasskeyOnlyWorkflowObservation<Summary>
  >;
  emptySummary: Summary;
};

export type AppendIndependentPasskeyOnlyWorkflowsRequest<
  Observation extends RankableWorkflowObservation,
> = {
  fieldBearing: Observation[];
  passkeyOnly: Observation[];
  observationPriority: (observation: Observation) => number;
  passkeyControlIsSafe: PasskeyControlIsSafe<Observation>;
};

type ShortlistWorkflowsRequest<
  Observation extends RankableWorkflowObservation,
> = {
  fieldBearing: Observation[];
  independent: Observation[];
  passkeyControlIsSafe: PasskeyControlIsSafe<Observation>;
  observationPriority: (observation: Observation) => number;
};

type CollectPasskeyOnlyScopesRequest = {
  root: Document;
  passkeyCandidates: PasskeyControlCandidate[];
};

type PasskeyCandidatesForScopeRequest = {
  scope: PasskeyOnlyScope;
  indexed: IndexedPasskeyCandidates;
};

type TakePreferredPasskeyOnlyObservationsRequest<Summary> = {
  scopes: PasskeyOnlyScope[];
  summarizeRoot: (query: PasswordFormScopeQuery) => Summary;
  observationPriority: (
    observation: PasskeyOnlyWorkflowObservation<Summary>,
  ) => number;
  passkeyControlIsSafe: PasskeyControlIsSafe<
    PasskeyOnlyWorkflowObservation<Summary>
  >;
  indexed: IndexedPasskeyCandidates;
  emptySummary: Summary;
};

type BoundedPriorityWorkflowEntry<Observation> = {
  observation: Observation;
  priority: number;
  progressing: boolean;
};

type PreferredPasskeyObservationEntry<Summary> = {
  observation: PasskeyOnlyWorkflowObservation<Summary>;
  safe: boolean;
  priority: number;
};

type UnownedPasskeyOnlyScope = {
  root: ParentNode;
  formScope: { kind: typeof PasswordFormScopeKind.Unowned };
};

type OwnedPasskeyOnlyScope = {
  root: ParentNode;
  formScope: {
    kind: typeof PasswordFormScopeKind.Owned;
    owner: HTMLFormElement;
  };
};

type PasskeyControlCandidateList = PasskeyControlCandidate[];

type RankedPasskeyObservationList<Observation> = Array<
  RankedPasskeyObservation<Observation>
>;

type RankableWorkflowObservationList<Observation> = Observation[];

type PreferredPasskeyObservationResult<Summary> = {
  observation: PasskeyOnlyWorkflowObservation<Summary>;
  safe: boolean;
};

type ObservationWithScope = {
  root: ParentNode;
  formScope: PasswordFormScope;
};

type TakeRankedWorkflowObservationsRequest<Observation> = {
  fieldBearing: Observation[];
  ranked: Array<RankedPasskeyObservation<Observation>>;
};

type ObservationHasSafePasskeyRequest<
  Observation extends ObservationWithScope,
> = {
  observation: Observation;
  passkeyCandidates: PasskeyControlCandidate[];
  passkeyControlIsSafe: PasskeyControlIsSafe<Observation>;
};

export function summarizePasskeyOnlyWorkflowForms<Summary>({
  root,
  summarizeRoot,
  observationPriority,
  passkeyControlIsSafe,
  emptySummary,
}: SummarizePasskeyOnlyWorkflowFormsRequest<Summary>): Array<
  PasskeyOnlyWorkflowObservation<Summary>
> {
  if (!pageHasPasskeyControl(root)) return [];
  const passkeyCandidates = findPasskeyControls(root);
  const indexed = indexPasskeyCandidatesByScope(passkeyCandidates);
  const scopesRequest: CollectPasskeyOnlyScopesRequest = {
    root,
    passkeyCandidates,
  };
  const scopes = collectPasskeyOnlyScopes(scopesRequest);
  const preferredRequest: TakePreferredPasskeyOnlyObservationsRequest<Summary> =
    {
      scopes,
      summarizeRoot,
      observationPriority,
      passkeyControlIsSafe,
      indexed,
      emptySummary,
    };
  const preferred = takePreferredPasskeyOnlyObservations(preferredRequest);
  const ranked = preferred.map((entry) => ({
    observation: entry.observation,
    safe: entry.safe,
    priority: observationPriority(entry.observation),
  }));
  return takeRankedPasskeyObservations(ranked);
}

export function appendIndependentPasskeyOnlyWorkflows<
  Observation extends RankableWorkflowObservation,
>({
  fieldBearing,
  passkeyOnly,
  observationPriority,
  passkeyControlIsSafe,
}: AppendIndependentPasskeyOnlyWorkflowsRequest<Observation>): Observation[] {
  const ownedForms = new Set(
    fieldBearing.flatMap((observation) =>
      observation.formScope.kind === PasswordFormScopeKind.Owned
        ? [observation.formScope.owner]
        : [],
    ),
  );
  const independent = passkeyOnly.filter((observation) => {
    if (observation.formScope.kind === PasswordFormScopeKind.Owned) {
      return !ownedForms.has(observation.formScope.owner);
    }
    return !fieldBearing.some((existing) => {
      if (existing.formScope.kind !== PasswordFormScopeKind.Unowned) {
        return false;
      }
      if (existing.root === observation.root) {
        return true;
      }
      return (
        observation.root instanceof Node &&
        existing.root instanceof Node &&
        observation.root.contains(existing.root)
      );
    });
  });
  const passkeyCandidates = findPasskeyControls(document);
  const shortlistRequest: ShortlistWorkflowsRequest<Observation> = {
    fieldBearing,
    independent,
    passkeyControlIsSafe,
    observationPriority,
  };
  const rankingCandidates = shortlistWorkflowsForFactsRanking(shortlistRequest);
  const ranked = rankingCandidates.map((observation) => {
    const safetyRequest: ObservationHasSafePasskeyRequest<Observation> = {
      observation,
      passkeyCandidates,
      passkeyControlIsSafe,
    };
    return {
      observation,
      safe: observationHasSafePasskey(safetyRequest),
      priority: observationPriority(observation),
    };
  });
  const rankedRequest: TakeRankedWorkflowObservationsRequest<Observation> = {
    fieldBearing,
    ranked,
  };
  return takeRankedWorkflowObservations(rankedRequest);
}

type CheapWorkflowProgressionRequest<
  Observation extends RankableWorkflowObservation,
> = {
  observation: Observation;
  passkeyControlIsSafe: PasskeyControlIsSafe<Observation>;
};

type TakeBoundedPriorityWorkflowsRequest<
  Observation extends RankableWorkflowObservation,
> = {
  observations: RankableWorkflowObservationList<Observation>;
  passkeyControlIsSafe: PasskeyControlIsSafe<Observation>;
  observationPriority: (observation: Observation) => number;
};

function shortlistWorkflowsForFactsRanking<
  Observation extends RankableWorkflowObservation,
>({
  fieldBearing,
  independent,
  passkeyControlIsSafe,
  observationPriority,
}: ShortlistWorkflowsRequest<Observation>): Observation[] {
  const boundedRequest: TakeBoundedPriorityWorkflowsRequest<Observation> = {
    observations: fieldBearing,
    passkeyControlIsSafe,
    observationPriority,
  };
  return [
    ...takeBoundedPriorityWorkflows(boundedRequest),
    ...independent.slice(0, MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS),
  ];
}

function unownedScopeLooksProgressing(
  observation: RankableWorkflowObservation,
): boolean {
  const { root, formScope, summary } = observation;
  if (
    formScope.kind !== PasswordFormScopeKind.Unowned ||
    !(root instanceof Document || root instanceof Element)
  )
    return false;
  const controls = Array.from(
    root.querySelectorAll<HTMLButtonElement | HTMLInputElement>(
      authenticationAdvanceControlSelector,
    ),
  ).filter((control) => !controlIsInert(control) && !control.form);
  const semanticSubmitControlCount = countedSemanticSubmitControls(controls);
  const fieldQuery: PasswordFieldQuery = { root, formScope };
  const passwordFields = findPasswordFields(fieldQuery);
  const newPasswordFieldCount = passwordFields.filter((field) => {
    const tokenRequest: Parameters<typeof hasAutocompleteToken>[0] = {
      field,
      expected: "new-password",
    };
    return hasAutocompleteToken(tokenRequest);
  }).length;
  return controls.some((control) => {
    const destinationRequest: Parameters<typeof controlDestinationIdentity>[0] =
      { control, formScope };
    const identityRequest: Parameters<typeof observedFormIdentity>[0] = {
      root,
      formScope,
    };
    const facts: AuthenticationAdvanceControlObservation = {
      actionability: "actionable",
      ownership: "locally-scoped",
      semantics: control.matches(semanticSubmitControlSelector)
        ? "semantic-submit"
        : "activation",
      authenticationUsername: usernameEvidence(fieldQuery),
      passwordFieldCount: summary.passwordFieldCount,
      newPasswordFieldCount,
      oneTimeCodeFieldCount: summary.oneTimeCodeFieldCount,
      semanticSubmitControlCount,
      sourceOrigin: control.ownerDocument.defaultView?.location.origin ?? "",
      formIdentity: observedFormIdentity(identityRequest),
      destinationIdentity: controlDestinationIdentity(destinationRequest),
      label: controlLabel(control),
      machineIdentity: controlMachineIdentity(control),
      submissionMethod: controlSubmissionMethod(control),
    };
    return (
      authenticationFactStringsAreTransportable([
        facts.sourceOrigin,
        facts.formIdentity,
        facts.destinationIdentity,
        facts.label,
        facts.machineIdentity ?? "",
      ]) && authentication_advance_control_is_safe(facts)
    );
  });
}

function takeBoundedPriorityWorkflows<
  Observation extends RankableWorkflowObservation,
>({
  observations,
  passkeyControlIsSafe,
  observationPriority,
}: TakeBoundedPriorityWorkflowsRequest<Observation>): Observation[] {
  const selected: Array<BoundedPriorityWorkflowEntry<Observation>> = [];
  for (const observation of observations) {
    const progressionRequest: CheapWorkflowProgressionRequest<Observation> = {
      observation,
      passkeyControlIsSafe,
    };
    const priority = observationPriority(observation);
    const progressing = cheapWorkflowLooksProgressing(progressionRequest);
    if (selected.length < MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS * 2) {
      const selectedEntry: BoundedPriorityWorkflowEntry<Observation> = {
        observation,
        priority,
        progressing,
      };
      selected.push(selectedEntry);
      continue;
    }
    const lowest = selected.reduce((...pair) => {
      const current = pair[0];
      const entry = pair[1];
      if (entry.priority < current.priority) return entry;
      if (
        entry.priority === current.priority &&
        !entry.progressing &&
        current.progressing
      ) {
        return entry;
      }
      return current;
    });
    if (
      priority > lowest.priority ||
      (priority === lowest.priority && progressing && !lowest.progressing)
    ) {
      const replacement: BoundedPriorityWorkflowEntry<Observation> = {
        observation,
        priority,
        progressing,
      };
      selected[selected.indexOf(lowest)] = replacement;
    }
  }
  return selected.map((entry) => entry.observation);
}

function cheapWorkflowLooksProgressing<
  Observation extends RankableWorkflowObservation,
>({
  observation,
  passkeyControlIsSafe,
}: CheapWorkflowProgressionRequest<Observation>): boolean {
  const root =
    observation.formScope.kind === PasswordFormScopeKind.Owned
      ? observation.formScope.owner
      : observation.root;
  const passkeyCandidates = findPasskeyControls(root);
  const safetyRequest: ObservationHasSafePasskeyRequest<Observation> = {
    observation,
    passkeyCandidates,
    passkeyControlIsSafe,
  };
  if (observationHasSafePasskey(safetyRequest)) return true;
  if (observation.formScope.kind === PasswordFormScopeKind.Unowned) {
    return unownedScopeLooksProgressing(observation);
  }
  return (
    (!formBlocksCredentialDisclosure(observation.formScope.owner) ||
      formHasPostMethodSubmitter(observation.formScope.owner)) &&
    formHasRustClassifiableAdvanceControl(observation.formScope.owner)
  );
}

function collectPasskeyOnlyScopes({
  root,
  passkeyCandidates,
}: CollectPasskeyOnlyScopesRequest): PasskeyOnlyScope[] {
  const passkeyForms = [
    ...new Set(
      passkeyCandidates.flatMap(({ control }) => {
        if (
          (control instanceof HTMLButtonElement ||
            control instanceof HTMLInputElement) &&
          control.form
        ) {
          return [control.form];
        }
        const owner = control.closest("form");
        return owner instanceof HTMLFormElement ? [owner] : [];
      }),
    ),
  ];
  const scopes: PasskeyOnlyScope[] = [];
  for (const form of passkeyForms) {
    const ownedScope: OwnedPasskeyOnlyScope = {
      root,
      formScope: {
        kind: PasswordFormScopeKind.Owned,
        owner: form,
      },
    };
    scopes.push(ownedScope);
  }
  const formlessPasskeys = passkeyCandidates.filter(({ control }) => {
    if (
      control instanceof HTMLButtonElement ||
      control instanceof HTMLInputElement
    ) {
      return !control.form;
    }
    return !(control.closest("form") instanceof HTMLFormElement);
  });
  const localPasskeyRoots = [
    ...new Set(
      formlessPasskeys.map(({ control }) => {
        const containerRequest: UnownedAuthContainerRequest = {
          field: control,
          root,
        };
        return localUnownedPasskeyContainer(containerRequest);
      }),
    ),
  ];
  for (const localRoot of localPasskeyRoots) {
    const unownedScope: UnownedPasskeyOnlyScope = {
      root: localRoot,
      formScope: {
        kind: PasswordFormScopeKind.Unowned,
      },
    };
    scopes.push(unownedScope);
  }
  return scopes;
}

function indexPasskeyCandidatesByScope(
  passkeyCandidates: PasskeyControlCandidateList,
): IndexedPasskeyCandidates {
  const owned = new Map<HTMLFormElement, PasskeyControlCandidate[]>();
  const unowned: PasskeyControlCandidate[] = [];
  for (const candidate of passkeyCandidates) {
    if (controlIsInert(candidate.control)) continue;
    const owner = associatedAuthenticationForm(candidate.control);
    if (owner.kind === PasswordFormScopeKind.Owned) {
      const existing = owned.get(owner.owner);
      if (existing) {
        existing.push(candidate);
      } else {
        owned.set(owner.owner, [candidate]);
      }
      continue;
    }
    unowned.push(candidate);
  }
  return { owned, unowned };
}

function passkeyCandidatesForScope({
  scope,
  indexed,
}: PasskeyCandidatesForScopeRequest): PasskeyControlCandidate[] {
  if (scope.formScope.kind === PasswordFormScopeKind.Owned) {
    const owned = indexed.owned.get(scope.formScope.owner);
    return owned ? owned : [];
  }
  return indexed.unowned.filter((candidate) =>
    scope.root.contains(candidate.control),
  );
}

function scopeHasPasswordField(scope: PasskeyOnlyScope): boolean {
  const fieldQuery: Parameters<typeof findPasswordFields>[0] = {
    root: scope.root,
    formScope: scope.formScope,
  };
  return findPasswordFields(fieldQuery).length > 0;
}

function scopeHasOneTimeCodeField(scope: PasskeyOnlyScope): boolean {
  const fieldQuery: Parameters<typeof findOneTimeCodeFields>[0] = {
    root: scope.root,
    formScope: scope.formScope,
  };
  return findOneTimeCodeFields(fieldQuery).length > 0;
}

function scopeHasUsernameField(scope: PasskeyOnlyScope): boolean {
  const fieldQuery: Parameters<typeof findUsernameFields>[0] = {
    root: scope.root,
    formScope: scope.formScope,
  };
  return findUsernameFields(fieldQuery).length > 0;
}

function takePreferredPasskeyOnlyObservations<Summary>({
  scopes,
  summarizeRoot,
  observationPriority,
  passkeyControlIsSafe,
  indexed,
  emptySummary,
}: TakePreferredPasskeyOnlyObservationsRequest<Summary>): Array<
  PreferredPasskeyObservationResult<Summary>
> {
  const preferred: Array<PreferredPasskeyObservationEntry<Summary>> = [];
  for (const scope of scopes) {
    if (scopeHasPasswordField(scope)) {
      continue;
    }
    const scopedCandidatesRequest: PasskeyCandidatesForScopeRequest = {
      scope,
      indexed,
    };
    const scopedCandidates = passkeyCandidatesForScope(scopedCandidatesRequest);
    const emptyObservation: PasskeyOnlyWorkflowObservation<Summary> = {
      root: scope.root,
      formScope: scope.formScope,
      summary: emptySummary,
    };
    const cheapSafetyRequest: ObservationHasSafePasskeyRequest<
      PasskeyOnlyWorkflowObservation<Summary>
    > = {
      observation: emptyObservation,
      passkeyCandidates: scopedCandidates,
      passkeyControlIsSafe,
    };
    const cheapSafe =
      !scopeHasPasswordField(scope) &&
      observationHasSafePasskey(cheapSafetyRequest);
    if (
      preferred.length >= MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS &&
      !cheapSafe &&
      !scopeHasOneTimeCodeField(scope) &&
      !scopeHasUsernameField(scope)
    ) {
      continue;
    }
    const summaryArgs: PasswordFormScopeQuery = {
      kind: PasswordFormQueryKind.Scoped,
      root: scope.root,
      formScope: scope.formScope,
    };
    const observation: PasskeyOnlyWorkflowObservation<Summary> = {
      root: scope.root,
      formScope: scope.formScope,
      summary: summarizeRoot(summaryArgs),
    };
    const safetyRequest: ObservationHasSafePasskeyRequest<
      PasskeyOnlyWorkflowObservation<Summary>
    > = {
      observation,
      passkeyCandidates: scopedCandidates,
      passkeyControlIsSafe,
    };
    const safe = observationHasSafePasskey(safetyRequest);
    const priority = observationPriority(observation);
    const preferredEntry: PreferredPasskeyObservationEntry<Summary> = {
      observation,
      safe,
      priority,
    };
    if (preferred.length < MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS) {
      preferred.push(preferredEntry);
      continue;
    }
    if (!safe && !scopeHasOneTimeCodeField(scope)) continue;
    const lowest = preferred.reduce((...pair) => {
      const current = pair[0];
      const entry = pair[1];
      if (entry.priority < current.priority) return entry;
      if (entry.priority === current.priority && !entry.safe && current.safe) {
        return entry;
      }
      return current;
    });
    if (
      priority > lowest.priority ||
      (priority === lowest.priority && safe && !lowest.safe)
    ) {
      preferred[preferred.indexOf(lowest)] = preferredEntry;
    }
  }
  return preferred;
}

function takeRankedPasskeyObservations<Observation>(
  ranked: RankedPasskeyObservationList<Observation>,
): Observation[] {
  return ranked
    .sort((...pair) => {
      const priorityDelta = pair[1].priority - pair[0].priority;
      return priorityDelta === 0
        ? Number(pair[1].safe) - Number(pair[0].safe)
        : priorityDelta;
    })
    .slice(0, MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS)
    .map((entry) => entry.observation);
}

function takeRankedWorkflowObservations<Observation>({
  fieldBearing,
  ranked,
}: TakeRankedWorkflowObservationsRequest<Observation>): Observation[] {
  const fieldBearingSet = new Set(fieldBearing);
  const byPriority = [...ranked].sort((...pair) => {
    const priorityDelta = pair[1].priority - pair[0].priority;
    return priorityDelta === 0
      ? Number(pair[1].safe) - Number(pair[0].safe)
      : priorityDelta;
  });
  const selected: Observation[] = [];
  const selectedSet = new Set<Observation>();
  const take = (entry: RankedPasskeyObservation<Observation>) => {
    if (selectedSet.has(entry.observation)) return;
    if (selected.length >= MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS) return;
    selected.push(entry.observation);
    selectedSet.add(entry.observation);
  };
  for (const entry of byPriority) {
    if (fieldBearingSet.has(entry.observation)) {
      take(entry);
      break;
    }
  }
  for (const entry of byPriority) {
    if (entry.safe && !fieldBearingSet.has(entry.observation)) {
      take(entry);
      break;
    }
  }
  for (const entry of byPriority) take(entry);
  return selected;
}

function observationHasSafePasskey<
  Observation extends {
    root: ParentNode;
    formScope: PasswordFormScope;
  },
>({
  observation,
  passkeyCandidates,
  passkeyControlIsSafe,
}: ObservationHasSafePasskeyRequest<Observation>): boolean {
  return passkeyCandidates.some((candidate) => {
    if (controlIsInert(candidate.control)) return false;
    const owner = associatedAuthenticationForm(candidate.control);
    const belongs =
      observation.formScope.kind === PasswordFormScopeKind.Owned
        ? owner.kind === PasswordFormScopeKind.Owned &&
          owner.owner === observation.formScope.owner
        : owner.kind === PasswordFormScopeKind.Unowned &&
          observation.root.contains(candidate.control);
    const safetyRequest: PasskeyControlSafetyRequest<Observation> = {
      candidate,
      observation,
    };
    return belongs && passkeyControlIsSafe(safetyRequest);
  });
}
