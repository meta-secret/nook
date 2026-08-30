import {
  findPasskeyControls,
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

type PasskeyControlIsSafe<Observation> = (
  candidate: PasskeyControlCandidate,
  observation: Observation,
) => boolean;

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
  const observations = passkeyForms.map((form) => {
    const formScope: PasswordFormScope = {
      kind: PasswordFormScopeKind.Owned,
      owner: form,
    };
    const summaryArgs: PasswordFormScopeQuery = {
      kind: PasswordFormQueryKind.Scoped,
      root,
      formScope,
    };
    return {
      root,
      formScope,
      summary: summarizeRoot(summaryArgs),
    };
  });
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
        nearestUnownedPasskeyContainer(control, root),
      ),
    ),
  ];
  for (const localRoot of localPasskeyRoots) {
    const formScope: PasswordFormScope = {
      kind: PasswordFormScopeKind.Unowned,
    };
    const summaryArgs: PasswordFormScopeQuery = {
      kind: PasswordFormQueryKind.Scoped,
      root: localRoot,
      formScope,
    };
    observations.push({
      root: localRoot,
      formScope,
      summary: summarizeRoot(summaryArgs),
    });
  }
  return observations
    .sort((left, right) => {
      const safeDelta =
        Number(
          observationHasSafePasskey(
            right,
            passkeyCandidates,
            passkeyControlIsSafe,
          ),
        ) -
        Number(
          observationHasSafePasskey(
            left,
            passkeyCandidates,
            passkeyControlIsSafe,
          ),
        );
      return safeDelta === 0
        ? observationPriority(right) - observationPriority(left)
        : safeDelta;
    })
    .slice(0, MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS);
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
    return !fieldBearing.some(
      (existing) =>
        existing.formScope.kind === PasswordFormScopeKind.Unowned &&
        existing.root === observation.root,
    );
  });
  const passkeyCandidates = findPasskeyControls(document);
  return [...fieldBearing, ...independent]
    .sort((left, right) => {
      const safeDelta =
        Number(
          observationHasSafePasskey(
            right,
            passkeyCandidates,
            passkeyControlIsSafe,
          ),
        ) -
        Number(
          observationHasSafePasskey(
            left,
            passkeyCandidates,
            passkeyControlIsSafe,
          ),
        );
      return safeDelta === 0
        ? observationPriority(right) - observationPriority(left)
        : safeDelta;
    })
    .slice(0, MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS);
}

function nearestUnownedPasskeyContainer(
  control: HTMLElement,
  root: Document,
): ParentNode {
  let container = control.parentElement;
  while (
    container &&
    container !== root.body &&
    container !== root.documentElement
  ) {
    if (
      container.matches(
        'dialog, [role="dialog"], [role="form"], [id*="login" i], [id*="signin" i], [id*="signup" i], [id*="reset" i], [class*="login" i], [class*="signin" i], [class*="signup" i], [class*="reset" i]',
      )
    ) {
      return container;
    }
    container = container.parentElement;
  }
  return control.parentElement instanceof HTMLElement
    ? control.parentElement
    : root;
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
        : owner.kind === PasswordFormScopeKind.Unowned;
    return belongs && passkeyControlIsSafe(candidate, observation);
  });
}
