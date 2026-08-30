import {
  findPasskeyControls,
  pageHasPasskeyControl,
  PasswordFormScopeKind,
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

export function summarizePasskeyOnlyWorkflowForms<Summary>(
  root: Document,
  summarizeRoot: (query: PasswordFormScopeQuery) => Summary,
  observationPriority: (
    observation: PasskeyOnlyWorkflowObservation<Summary>,
  ) => number,
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
  const hasFormlessPasskey = passkeyCandidates.some(({ control }) => {
    if (
      control instanceof HTMLButtonElement ||
      control instanceof HTMLInputElement
    ) {
      return !control.form;
    }
    return !(control.closest("form") instanceof HTMLFormElement);
  });
  if (hasFormlessPasskey || observations.length === 0) {
    const formScope: PasswordFormScope = {
      kind: PasswordFormScopeKind.Unowned,
    };
    const summaryArgs: PasswordFormScopeQuery = {
      kind: PasswordFormQueryKind.Scoped,
      root,
      formScope,
    };
    observations.push({
      root,
      formScope,
      summary: summarizeRoot(summaryArgs),
    });
  }
  return observations
    .sort((left, right) => {
      const actionableDelta =
        Number(observationHasActionablePasskey(right, passkeyCandidates)) -
        Number(observationHasActionablePasskey(left, passkeyCandidates));
      return actionableDelta === 0
        ? observationPriority(right) - observationPriority(left)
        : actionableDelta;
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
      const actionableDelta =
        Number(observationHasActionablePasskey(right, passkeyCandidates)) -
        Number(observationHasActionablePasskey(left, passkeyCandidates));
      return actionableDelta === 0
        ? observationPriority(right) - observationPriority(left)
        : actionableDelta;
    })
    .slice(0, MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS);
}

function observationHasActionablePasskey<Summary>(
  observation: PasskeyOnlyWorkflowObservation<Summary>,
  passkeyCandidates: Array<{ control: HTMLElement }>,
): boolean {
  return passkeyCandidates.some(({ control }) => {
    if (controlIsInert(control)) return false;
    const owner = associatedAuthenticationForm(control);
    return observation.formScope.kind === PasswordFormScopeKind.Owned
      ? owner.kind === PasswordFormScopeKind.Owned &&
          owner.owner === observation.formScope.owner
      : owner.kind === PasswordFormScopeKind.Unowned;
  });
}
