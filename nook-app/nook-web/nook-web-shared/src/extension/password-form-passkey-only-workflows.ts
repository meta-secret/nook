import {
  findPasskeyControls,
  pageHasPasskeyControl,
  PasswordFormScopeKind,
  type PasswordFormScope,
} from "./password-form-fields";
import {
  MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS,
  PasswordFormQueryKind,
  type PasswordFormScopeQuery,
} from "./password-form-submission-controls";

type PasskeyOnlyWorkflowObservation<Summary> = {
  root: Document;
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
    .sort(
      // eslint-disable-next-line max-params -- Array.sort owns the comparator callback signature.
      (left, right) => observationPriority(right) - observationPriority(left),
    )
    .slice(0, MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS);
}
