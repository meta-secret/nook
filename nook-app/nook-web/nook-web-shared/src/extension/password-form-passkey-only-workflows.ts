import {
  findPasskeyControls,
  localUnownedPasskeyContainer,
  pageHasPasskeyControl,
  PasswordFormScopeKind,
  type PasskeyControlCandidate,
  type PasswordFormScope,
} from "./password-form-fields";
import {
  associatedAuthenticationForm,
  controlIsInert,
  MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS,
  PasswordFormQueryKind,
  type PasswordFormScopeQuery,
} from "./password-form-submission-controls";

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
  const ranked = [...fieldBearing, ...independent].map((observation) => ({
    observation,
    safe: observationHasSafePasskey(
      observation,
      passkeyCandidates,
      passkeyControlIsSafe,
    ),
    priority: observationPriority(observation),
  }));
  return takeRankedPasskeyObservations(ranked);
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
  const queryRoot =
    scope.formScope.kind === PasswordFormScopeKind.Owned
      ? scope.formScope.owner
      : scope.root;
  return (
    queryRoot.querySelector('input[type="password"]') instanceof
    HTMLInputElement
  );
}

function takePreferredPasskeyOnlyObservations<Summary>(
  scopes: PasskeyOnlyScope[],
  summarizeRoot: (query: PasswordFormScopeQuery) => Summary,
  passkeyControlIsSafe: PasskeyControlIsSafe<
    PasskeyOnlyWorkflowObservation<Summary>
  >,
  indexed: IndexedPasskeyCandidates,
  emptySummary: Summary,
): Array<{
  observation: PasskeyOnlyWorkflowObservation<Summary>;
  safe: boolean;
}> {
  const ordered = [...scopes].sort((left, right) => {
    return (
      Number(scopeHasPasswordField(left)) - Number(scopeHasPasswordField(right))
    );
  });
  const preferred: Array<{
    observation: PasskeyOnlyWorkflowObservation<Summary>;
    safe: boolean;
  }> = [];
  let safeCount = 0;
  for (const scope of ordered) {
    if (
      safeCount >= MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS &&
      preferred.length >= MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS
    ) {
      break;
    }
    const scopedCandidates = passkeyCandidatesForScope(scope, indexed);
    const cheapSafe = observationHasSafePasskey(
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
      !cheapSafe
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
    if (preferred.length < MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS) {
      preferred.push({ observation, safe });
      if (safe) safeCount += 1;
      continue;
    }
    if (!safe) continue;
    const replaceAt = preferred.findIndex((entry) => !entry.safe);
    if (replaceAt < 0) break;
    preferred[replaceAt] = { observation, safe };
    safeCount += 1;
  }
  return preferred;
}

function takeRankedPasskeyObservations<Observation>(
  ranked: Array<RankedPasskeyObservation<Observation>>,
): Observation[] {
  return ranked
    .sort((left, right) => {
      const safeDelta = Number(right.safe) - Number(left.safe);
      return safeDelta === 0 ? right.priority - left.priority : safeDelta;
    })
    .slice(0, MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS)
    .map((entry) => entry.observation);
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
