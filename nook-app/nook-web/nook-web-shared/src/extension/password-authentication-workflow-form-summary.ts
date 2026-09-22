import {
  IndependentPasskeyWorkflows,
  PasskeyOnlyWorkflowSummary,
  type AppendIndependentPasskeyOnlyWorkflowsRequest,
  type SummarizePasskeyOnlyWorkflowFormsRequest,
} from "./password-form-passkey-only-workflows";
import {
  PasswordFormScopeKind,
  passwordFieldDiscovery,
} from "./password-form-fields";
import type {
  LocalOwnedLoginObservationRootsRequest,
  PasswordFieldQuery,
  PasswordFormScope,
  UnownedAuthContainerRequest,
} from "./password-form-fields";
import {
  PasswordFormQueryKind,
  type PasswordFormScopeQuery,
} from "./password-form-submission-controls";
import { emptyPasswordFormSummary } from "./password-form-summary-state";
import type {
  PasswordFormObservation,
  PasswordFormSummary,
} from "./password-forms";

type PasskeyControlSafetyRequest = {
  candidate: { control: HTMLElement; explicitlyMarked: boolean };
  observation: PasswordFormObservation;
};

export type PasswordAuthenticationWorkflowFormSummaryDependencies = {
  browser: Pick<typeof globalThis, "document">;
  summarizeRoot: (request: PasswordFormScopeQuery) => PasswordFormSummary;
  observationPriority: (observation: PasswordFormObservation) => number;
  observationIsAdmissible: (observation: PasswordFormObservation) => boolean;
  passkeyControlIsSafe: (request: PasskeyControlSafetyRequest) => boolean;
};

/** Owns collection and ranking of authentication workflow form observations. */
export class PasswordAuthenticationWorkflowFormSummary {
  constructor(
    private readonly dependencies: PasswordAuthenticationWorkflowFormSummaryDependencies,
  ) {}

  summarize(): PasswordFormObservation[] {
    const root = this.dependencies.browser.document;
    const rootFieldQuery: PasswordFieldQuery = { root };
    const allPasswordFields =
      passwordFieldDiscovery.findPasswordFields(rootFieldQuery);
    const allUsernameFields =
      passwordFieldDiscovery.findUsernameFields(rootFieldQuery);
    const allOneTimeCodeFields =
      passwordFieldDiscovery.findOneTimeCodeFields(rootFieldQuery);
    const authUsernameFields = allUsernameFields.filter(
      passwordFieldDiscovery.isAuthUsernameField.bind(passwordFieldDiscovery),
    );
    const authFieldCount =
      allPasswordFields.length +
      authUsernameFields.length +
      allOneTimeCodeFields.length;
    const passkeyOnlyRequest: SummarizePasskeyOnlyWorkflowFormsRequest<PasswordFormSummary> =
      {
        root,
        summarizeRoot: this.dependencies.summarizeRoot,
        observationPriority: this.dependencies.observationPriority,
        passkeyControlIsSafe: this.dependencies.passkeyControlIsSafe,
        emptySummary: emptyPasswordFormSummary,
      };
    const passkeyOnly = new PasskeyOnlyWorkflowSummary(passkeyOnlyRequest)
      .observations;
    if (authFieldCount === 0) {
      return passkeyOnly;
    }
    const forms = Array.from(
      root.querySelectorAll<HTMLFormElement>("form"),
    ).filter((form) => {
      const formScope: PasswordFormScope = {
        kind: PasswordFormScopeKind.Owned,
        owner: form,
      };
      const formScopeQuery: PasswordFormScopeQuery = {
        kind: PasswordFormQueryKind.Scoped,
        root,
        formScope,
      };
      const summary = this.dependencies.summarizeRoot(formScopeQuery);

      return (
        summary.passwordFieldCount > 0 ||
        summary.oneTimeCodeFieldCount > 0 ||
        passwordFieldDiscovery
          .findUsernameFields(formScopeQuery)
          .some(
            passwordFieldDiscovery.isAuthUsernameField.bind(
              passwordFieldDiscovery,
            ),
          )
      );
    });
    const observations: PasswordFormObservation[] = forms.flatMap((form) => {
      const formScope: PasswordFormScope = {
        kind: PasswordFormScopeKind.Owned,
        owner: form,
      };

      const observationRootsRequest: LocalOwnedLoginObservationRootsRequest = {
        owner: form,
        passwordFields: allPasswordFields,
        usernameFields: authUsernameFields,
        oneTimeCodeFields: allOneTimeCodeFields,
      };
      const observationRoots =
        passwordFieldDiscovery.localOwnedLoginObservationRoots(
          observationRootsRequest,
        );

      return observationRoots.map((observationRoot) => {
        const observationRootQuery: PasswordFormScopeQuery = {
          kind: PasswordFormQueryKind.Scoped,
          root: observationRoot,
          formScope,
        };
        return {
          root: observationRoot,
          formScope,
          summary: this.dependencies.summarizeRoot(observationRootQuery),
        };
      });
    });
    const unownedFields = [
      ...allPasswordFields,
      ...authUsernameFields,
      ...allOneTimeCodeFields,
    ].filter((field) => !field.form);
    const unownedContainers = new Set(
      unownedFields.flatMap((field) => {
        const containerRequest: UnownedAuthContainerRequest = {
          field,
          root,
        };
        const container =
          passwordFieldDiscovery.nearestUnownedAuthContainer(containerRequest);
        return container === field ? [] : [container];
      }),
    );
    for (const container of unownedContainers) {
      const formScope: PasswordFormScope = {
        kind: PasswordFormScopeKind.Unowned,
      };
      const unownedObservationQuery: PasswordFormScopeQuery = {
        kind: PasswordFormQueryKind.Scoped,
        root: container,
        formScope,
      };
      const unownedObservation: PasswordFormObservation = {
        root: container,
        formScope,
        summary: this.dependencies.summarizeRoot(unownedObservationQuery),
      };
      observations.push(unownedObservation);
    }
    const independentWorkflowsRequest: AppendIndependentPasskeyOnlyWorkflowsRequest<PasswordFormObservation> =
      {
        fieldBearing: observations.filter(
          this.dependencies.observationIsAdmissible,
        ),
        passkeyOnly,
        observationPriority: this.dependencies.observationPriority,
        passkeyControlIsSafe: this.dependencies.passkeyControlIsSafe,
      };
    return new IndependentPasskeyWorkflows(independentWorkflowsRequest)
      .observations;
  }
}
