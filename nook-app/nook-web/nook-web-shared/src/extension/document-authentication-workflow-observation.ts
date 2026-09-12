import { PasswordFormScopeKind } from "./password-form-fields";

import {
  PasswordFormQueryKind,
  type PasswordFormScopeQuery,
} from "./password-form-submission-controls";

import {
  type PasswordFormObservation,
  passwordFormInteraction,
} from "./password-forms";

/** Owns this browser host’s resources and interaction lifecycle. */
class DocumentAuthenticationObservation {
  constructor(private readonly browser: typeof globalThis) {}

  documentAuthenticationWorkflowObservation(): PasswordFormObservation {
    const root = this.browser.document;
    const request: PasswordFormScopeQuery = {
      kind: PasswordFormQueryKind.Root,
      root,
    };
    return {
      root,
      formScope: { kind: PasswordFormScopeKind.Unowned },
      summary: passwordFormInteraction.summarizeRoot(request),
    };
  }
}

export const documentAuthenticationObservation =
  new DocumentAuthenticationObservation(globalThis);
