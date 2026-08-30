import {
  findOneTimeCodeFields,
  findPasskeyControls,
  findPasswordFields,
  findUsernameFields,
  localUnownedPasskeyContainer,
  pageHasPasskeyControl,
  PasswordFormScopeKind,
  type PasskeyControlCandidate,
  type PasswordFormScope,
  type UnownedAuthContainerRequest,
} from "./password-form-fields";
import {
  associatedAuthenticationForm,
  authenticationAdvanceControlSelector,
  controlIsInert,
  formBlocksCredentialDisclosure,
  formHasPostMethodSubmitter,
  formHasSemanticSubmitter,
  MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS,
  PasswordFormQueryKind,
  type PasswordFormScopeQuery,
} from "./password-form-submission-controls";

type RankableWorkflowSummary = {
  oneTimeCodeFieldCount: number;
  currentPasswordFieldCount: number;
  genericPasswordFieldCount: number;
  passwordFieldCount: number;
  usernameFieldCount: number;
  passkeyControlPresent: boolean;
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
};

type OwnedFormProgressionRequest = {
  form: HTMLFormElement;
  summary: RankableWorkflowSummary;
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
      priority: cheapWorkflowLooksProgressing(observation)
        ? observationPriority(observation)
        : 0,
    };
  });
  const rankedRequest: TakeRankedWorkflowObservationsRequest<Observation> = {
    fieldBearing,
    ranked,
  };
  return takeRankedWorkflowObservations(rankedRequest);
}

function shortlistWorkflowsForFactsRanking<
  Observation extends RankableWorkflowObservation,
>({
  fieldBearing,
  independent,
}: ShortlistWorkflowsRequest<Observation>): Observation[] {
  return [
    ...takeBoundedPriorityWorkflows(fieldBearing),
    ...independent.slice(0, MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS),
  ];
}

function cheapWorkflowPriority(
  observation: RankableWorkflowObservation,
): number {
  if (!cheapWorkflowLooksProgressing(observation)) return 1;
  if (observation.summary.oneTimeCodeFieldCount > 0) return 5;
  if (observation.summary.currentPasswordFieldCount > 0) return 4;
  if (observation.summary.genericPasswordFieldCount === 1) return 3;
  if (observation.summary.passwordFieldCount > 0) return 2;
  if (observation.summary.usernameFieldCount > 0) return 2;
  return 1;
}

function unownedScopeLooksProgressing(root: ParentNode): boolean {
  return Boolean(
    root instanceof Document || root instanceof Element
      ? root.querySelector(authenticationAdvanceControlSelector)
      : false,
  );
}

function ownedFormLooksProgressing({
  form,
  summary,
}: OwnedFormProgressionRequest): boolean {
  return Boolean(
    formHasSemanticSubmitter(form) ||
    ((summary.currentPasswordFieldCount > 0 ||
      summary.usernameFieldCount > 0) &&
      typeof form.requestSubmit === "function"),
  );
}

function takeBoundedPriorityWorkflows<
  Observation extends RankableWorkflowObservation,
>(observations: RankableWorkflowObservationList<Observation>): Observation[] {
  const selected: Array<BoundedPriorityWorkflowEntry<Observation>> = [];
  for (const observation of observations) {
    const priority = cheapWorkflowPriority(observation);
    const progressing = cheapWorkflowLooksProgressing(observation);
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

function cheapWorkflowLooksProgressing(
  observation: RankableWorkflowObservation,
): boolean {
  if (observation.summary.passkeyControlPresent) return true;
  if (observation.formScope.kind === PasswordFormScopeKind.Unowned) {
    return unownedScopeLooksProgressing(observation.root);
  }
  const progressionRequest: OwnedFormProgressionRequest = {
    form: observation.formScope.owner,
    summary: observation.summary,
  };
  return (
    (!formBlocksCredentialDisclosure(observation.formScope.owner) ||
      formHasPostMethodSubmitter(observation.formScope.owner)) &&
    ownedFormLooksProgressing(progressionRequest)
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
