import {
  PasswordFormQueryKind,
  summarizeRoot,
  type PasswordFormObservation,
} from "./password-forms";

export function refreshAuthenticationWorkflowObservation(
  observation: PasswordFormObservation,
): PasswordFormObservation {
  const summaryRequest: Parameters<typeof summarizeRoot>[0] = {
    kind: PasswordFormQueryKind.Scoped,
    root: observation.root,
    formScope: observation.formScope,
  };
  return {
    ...observation,
    summary: summarizeRoot(summaryRequest),
  };
}
