import {
  PasswordFormQueryKind,
  type PasswordFormObservation,
  passwordFormInteraction,
} from "./password-forms";

export class RefreshedAuthenticationObservation {
  constructor(private readonly request: PasswordFormObservation) {}
  get value(): PasswordFormObservation {
    const observation = this.request;
    const summaryRequest: Parameters<
      typeof passwordFormInteraction.summarizeRoot
    >[0] = {
      kind: PasswordFormQueryKind.Scoped,
      root: observation.root,
      formScope: observation.formScope,
    };
    return {
      ...observation,
      summary: passwordFormInteraction.summarizeRoot(summaryRequest),
    };
  }
}
