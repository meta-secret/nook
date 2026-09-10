import { passwordFieldDiscovery } from "./password-form-fields";
import { PasswordFormFieldQuery } from "./password-form-summary-state";
import {
  PasswordFormQueryKind,
  type PasswordFormScopeQuery,
} from "./password-form-submission-controls";
import type { PasswordFormSummary } from "./password-forms";
type PasswordFormSummaryRequest = PasswordFormScopeQuery;

/** Owns browser observations shared by the concrete authentication interaction. */
export class PasswordFormSummaryObservation {
  constructor(protected readonly browser: typeof globalThis) {}
  summarizeRoot(request: PasswordFormSummaryRequest): PasswordFormSummary {
    const { root } = request;
    const passwordFields = passwordFieldDiscovery.findPasswordFields(
      new PasswordFormFieldQuery(request).query,
    );
    const usernameFields = passwordFieldDiscovery.findUsernameFields(
      new PasswordFormFieldQuery(request).query,
    );
    const oneTimeCodeFields = passwordFieldDiscovery.findOneTimeCodeFields(
      new PasswordFormFieldQuery(request).query,
    );
    const currentPasswordFieldCount = passwordFields.filter((field) => {
      // eslint-disable-next-line nook-typed-api/no-raw-object-arguments -- Existing call shape is preserved for this lint-only fix.
      return passwordFieldDiscovery.hasAutocompleteToken({
        field,
        expected: "current-password",
      });
    }).length;
    const newPasswordFieldCount = passwordFields.filter((field) => {
      // eslint-disable-next-line nook-typed-api/no-raw-object-arguments -- Existing call shape is preserved for this lint-only fix.
      return passwordFieldDiscovery.hasAutocompleteToken({
        field,
        expected: "new-password",
      });
    }).length;
    const forms = new Set<HTMLFormElement>();
    for (const field of [
      ...passwordFields,
      ...usernameFields,
      ...oneTimeCodeFields,
    ]) {
      if (field.form) forms.add(field.form);
    }
    return {
      passwordFieldCount: passwordFields.length,
      currentPasswordFieldCount,
      newPasswordFieldCount,
      genericPasswordFieldCount:
        passwordFields.length -
        currentPasswordFieldCount -
        newPasswordFieldCount,
      usernameFieldCount: usernameFields.length,
      oneTimeCodeFieldCount: oneTimeCodeFields.length,
      manualCheckpointPresent:
        passwordFieldDiscovery.pageHasManualCheckpoint(root),
      passkeyControlPresent: passwordFieldDiscovery.pageHasPasskeyControl(root),
      formCount: forms.size,
      observedAt: Date.now(),
    };
  }

  summarizePasswordForms(): PasswordFormSummary {
    const request: PasswordFormSummaryRequest = {
      kind: PasswordFormQueryKind.Root,
      root: this.browser.document,
    };
    return this.summarizeRoot(request);
  }
}
