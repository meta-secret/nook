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

export function summarizePasskeyOnlyWorkflowForms<Summary>(
  root: Document,
  summarizeRoot: (query: PasswordFormScopeQuery) => Summary,
  observationPriority: (
    observation: PasskeyOnlyWorkflowObservation<Summary>,
  ) => number,
  passkeyControlIsSafe: PasskeyControlIsSafe<
    PasskeyOnlyWorkflowObservation<Summary>
  >,
): Array<PasskeyOnlyWorkflowObservation<Summary>> {
  if (!pageHasPasskeyControl(root)) return [];
  const passkeyCandidates = findPasskeyControls(root);
  const scopes = collectPasskeyOnlyScopes(root, passkeyCandidates);
  const ranked = scopes.map((scope) => {
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
    return {
      observation,
      safe: observationHasSafePasskey(
        observation,
        passkeyCandidates,
        passkeyControlIsSafe,
      ),
      priority: observationPriority(observation),
    };
  });
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
