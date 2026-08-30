import {
  findOneTimeCodeFields,
  findPasskeyControls,
  findPasswordFields,
  localUnownedPasskeyContainer,
  pageHasPasskeyControl,
  PasswordFormScopeKind,
  type PasskeyControlCandidate,
  type PasswordFormScope,
} from "./password-form-fields";
import {
  associatedAuthenticationForm,
  controlIsInert,
  formBlocksCredentialDisclosure,
  MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS,
  PasswordFormQueryKind,
  semanticSubmitControlSelector,
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

type PasskeyOnlyScope = {
  root: ParentNode;
  formScope: PasswordFormScope;
};

type PasskeyControlIsSafe<Observation> = (
  candidate: PasskeyControlCandidate,
  observation: Observation,
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

export function summarizePasskeyOnlyWorkflowForms<Summary>(
  root: Document,
  summarizeRoot: (query: PasswordFormScopeQuery) => Summary,
  observationPriority: (
    observation: PasskeyOnlyWorkflowObservation<Summary>,
  ) => number,
  passkeyControlIsSafe: PasskeyControlIsSafe<
    PasskeyOnlyWorkflowObservation<Summary>
  >,
  emptySummary: Summary,
): Array<PasskeyOnlyWorkflowObservation<Summary>> {
  if (!pageHasPasskeyControl(root)) return [];
  const passkeyCandidates = findPasskeyControls(root);
  const indexed = indexPasskeyCandidatesByScope(passkeyCandidates);
  const scopes = collectPasskeyOnlyScopes(root, passkeyCandidates);
  const preferred = takePreferredPasskeyOnlyObservations(
    scopes,
    summarizeRoot,
    observationPriority,
    passkeyControlIsSafe,
    indexed,
    emptySummary,
  );
  const ranked = preferred.map((entry) => ({
    observation: entry.observation,
    safe: entry.safe,
    priority: observationPriority(entry.observation),
  }));
  return takeRankedPasskeyObservations(ranked);
}

export function appendIndependentPasskeyOnlyWorkflows<
  Observation extends {
    root: ParentNode;
    formScope: PasswordFormScope;
    summary: RankableWorkflowSummary;
  },
>(
  fieldBearing: Observation[],
  passkeyOnly: Observation[],
  observationPriority: (observation: Observation) => number,
  passkeyControlIsSafe: PasskeyControlIsSafe<Observation>,
): Observation[] {
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
  const rankingCandidates = shortlistWorkflowsForFactsRanking(
    fieldBearing,
    independent,
  );
  const ranked = rankingCandidates.map((observation) => ({
    observation,
    safe: observationHasSafePasskey(
      observation,
      passkeyCandidates,
      passkeyControlIsSafe,
    ),
    priority: observationPriority(observation),
  }));
  return takeRankedWorkflowObservations(fieldBearing, ranked);
}

function shortlistWorkflowsForFactsRanking<
  Observation extends {
    formScope: PasswordFormScope;
    summary: RankableWorkflowSummary;
  },
>(fieldBearing: Observation[], independent: Observation[]): Observation[] {
  return [
    ...takeBoundedPriorityWorkflows(fieldBearing),
    ...independent.slice(0, MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS),
  ];
}

function cheapWorkflowPriority(observation: {
  formScope: PasswordFormScope;
  summary: RankableWorkflowSummary;
}): number {
  const progressing =
    observation.summary.passkeyControlPresent ||
    (observation.formScope.kind === PasswordFormScopeKind.Owned &&
      !formBlocksCredentialDisclosure(observation.formScope.owner) &&
      ownedFormLooksProgressing(
        observation.formScope.owner,
        observation.summary,
      ));
  if (!progressing) return 1;
  if (observation.summary.oneTimeCodeFieldCount > 0) return 5;
  if (observation.summary.currentPasswordFieldCount > 0) return 4;
  if (observation.summary.genericPasswordFieldCount === 1) return 3;
  if (observation.summary.passwordFieldCount > 0) return 2;
  return 1;
}

function ownedFormLooksProgressing(
  form: HTMLFormElement,
  summary: RankableWorkflowSummary,
): boolean {
  return Boolean(
    form.querySelector(semanticSubmitControlSelector) ||
    ((summary.currentPasswordFieldCount > 0 ||
      summary.usernameFieldCount > 0) &&
      typeof form.requestSubmit === "function"),
  );
}

function takeBoundedByCheapPriority<
  Observation extends {
    formScope: PasswordFormScope;
    summary: RankableWorkflowSummary;
  },
>(observations: Observation[]): Observation[] {
  const selected: Array<{ observation: Observation; priority: number }> = [];
  for (const observation of observations) {
    const priority = cheapWorkflowPriority(observation);
    if (selected.length < MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS) {
      selected.push({ observation, priority });
      continue;
    }
    const lowest = selected.reduce((current, entry) =>
      entry.priority < current.priority ? entry : current,
    );
    if (priority > lowest.priority) {
      selected[selected.indexOf(lowest)] = { observation, priority };
    }
  }
  return selected.map((entry) => entry.observation);
}

function takeBoundedPriorityWorkflows<
  Observation extends {
    formScope: PasswordFormScope;
    summary: RankableWorkflowSummary;
  },
>(observations: Observation[]): Observation[] {
  const passwordBearing: Observation[] = [];
  const rest: Observation[] = [];
  for (const observation of observations) {
    if (observation.summary.passwordFieldCount > 0) {
      passwordBearing.push(observation);
    } else {
      rest.push(observation);
    }
  }
  return [
    ...takeBoundedByCheapPriority(passwordBearing),
    ...takeBoundedByCheapPriority(rest),
  ];
}

function collectPasskeyOnlyScopes(
  root: Document,
  passkeyCandidates: PasskeyControlCandidate[],
): PasskeyOnlyScope[] {
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
  const scopes: PasskeyOnlyScope[] = passkeyForms.map((form) => ({
    root,
    formScope: {
      kind: PasswordFormScopeKind.Owned,
      owner: form,
    },
  }));
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
      formlessPasskeys.map(({ control }) =>
        localUnownedPasskeyContainer({ field: control, root }),
      ),
    ),
  ];
  for (const localRoot of localPasskeyRoots) {
    scopes.push({
      root: localRoot,
      formScope: {
        kind: PasswordFormScopeKind.Unowned,
      },
    });
  }
  return scopes;
}

function indexPasskeyCandidatesByScope(
  passkeyCandidates: PasskeyControlCandidate[],
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

function passkeyCandidatesForScope(
  scope: PasskeyOnlyScope,
  indexed: IndexedPasskeyCandidates,
): PasskeyControlCandidate[] {
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

function takePreferredPasskeyOnlyObservations<Summary>(
  scopes: PasskeyOnlyScope[],
  summarizeRoot: (query: PasswordFormScopeQuery) => Summary,
  observationPriority: (
    observation: PasskeyOnlyWorkflowObservation<Summary>,
  ) => number,
  passkeyControlIsSafe: PasskeyControlIsSafe<
    PasskeyOnlyWorkflowObservation<Summary>
  >,
  indexed: IndexedPasskeyCandidates,
  emptySummary: Summary,
): Array<{
  observation: PasskeyOnlyWorkflowObservation<Summary>;
  safe: boolean;
}> {
  const preferred: Array<{
    observation: PasskeyOnlyWorkflowObservation<Summary>;
    safe: boolean;
    priority: number;
  }> = [];
  for (const scope of scopes) {
    if (scopeHasPasswordField(scope)) {
      continue;
    }
    const scopedCandidates = passkeyCandidatesForScope(scope, indexed);
    const cheapSafe =
      !scopeHasPasswordField(scope) &&
      observationHasSafePasskey(
        {
          root: scope.root,
          formScope: scope.formScope,
          summary: emptySummary,
        },
        scopedCandidates,
        passkeyControlIsSafe,
      );
    if (
      preferred.length >= MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS &&
      !cheapSafe &&
      !scopeHasOneTimeCodeField(scope)
    ) {
      continue;
    }
    const summaryArgs: PasswordFormScopeQuery = {
      kind: PasswordFormQueryKind.Scoped,
      root: scope.root,
      formScope: scope.formScope,
    };
    const observation = {
      root: scope.root,
      formScope: scope.formScope,
      summary: summarizeRoot(summaryArgs),
    };
    const safe = observationHasSafePasskey(
      observation,
      scopedCandidates,
      passkeyControlIsSafe,
    );
    const priority = observationPriority(observation);
    if (preferred.length < MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS) {
      preferred.push({ observation, safe, priority });
      continue;
    }
    if (!safe && !scopeHasOneTimeCodeField(scope)) continue;
    const lowest = preferred.reduce((current, entry) => {
      if (entry.priority < current.priority) return entry;
      if (
        entry.priority === current.priority &&
        !entry.safe &&
        current.safe
      ) {
        return entry;
      }
      return current;
    });
    if (
      priority > lowest.priority ||
      (priority === lowest.priority && safe && !lowest.safe)
    ) {
      preferred[preferred.indexOf(lowest)] = { observation, safe, priority };
    }
  }
  return preferred;
}

function takeRankedPasskeyObservations<Observation>(
  ranked: Array<RankedPasskeyObservation<Observation>>,
): Observation[] {
  return ranked
    .sort((left, right) => {
      const priorityDelta = right.priority - left.priority;
      return priorityDelta === 0
        ? Number(right.safe) - Number(left.safe)
        : priorityDelta;
    })
    .slice(0, MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS)
    .map((entry) => entry.observation);
}

function takeRankedWorkflowObservations<Observation>(
  fieldBearing: Observation[],
  ranked: Array<RankedPasskeyObservation<Observation>>,
): Observation[] {
  const fieldBearingSet = new Set(fieldBearing);
  const byPriority = [...ranked].sort((left, right) => {
    const priorityDelta = right.priority - left.priority;
    return priorityDelta === 0
      ? Number(right.safe) - Number(left.safe)
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
>(
  observation: Observation,
  passkeyCandidates: PasskeyControlCandidate[],
  passkeyControlIsSafe: PasskeyControlIsSafe<Observation>,
): boolean {
  return passkeyCandidates.some((candidate) => {
    if (controlIsInert(candidate.control)) return false;
    const owner = associatedAuthenticationForm(candidate.control);
    const belongs =
      observation.formScope.kind === PasswordFormScopeKind.Owned
        ? owner.kind === PasswordFormScopeKind.Owned &&
          owner.owner === observation.formScope.owner
        : owner.kind === PasswordFormScopeKind.Unowned &&
          observation.root.contains(candidate.control);
    return belongs && passkeyControlIsSafe(candidate, observation);
  });
}
