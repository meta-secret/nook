import { authentication_advance_control_is_safe } from "./nook-companion-wasm/nook_companion_wasm.js";
import type {
  AuthenticationAdvanceControlObservation,
  AuthenticationCredentialSubmissionObservation,
  AuthenticationPageObservationFacts,
} from "./nook-companion-wasm/nook_companion_wasm.js";
import {
  ownedObservationIsLocallyBounded,
  PasswordFormScopeKind,
} from "./password-form-fields";
import {
  controlIsInert,
  formBlocksCredentialDisclosure,
  formSubmissionMethod,
  observedFormDestination,
  observedFormIdentity,
  PageControlSubmissionMethod,
  semanticSubmitControlSelector,
  type LoginAdvanceControl,
} from "./password-form-submission-controls";
import type { PasswordFormObservation } from "./password-forms";

type BoundedAuthenticationAdvanceControlObservations =
  readonly AuthenticationAdvanceControlObservation[];
type ScopedLoginAdvanceControls = readonly LoginAdvanceControl[];
type AuthenticationCeremonyFacts =
  AuthenticationPageObservationFacts["ceremony"];

export type AuthenticationPageObservationContextRequest = {
  observation: PasswordFormObservation;
  boundedAdvanceObservations: BoundedAuthenticationAdvanceControlObservations;
  advanceControls: ScopedLoginAdvanceControls;
  sourceOrigin: string;
};

export type AuthenticationPageObservationContext = {
  sourceOrigin: string;
  formIdentity: string;
  destinationIdentity: string;
  implicitSubmissionMethod: AuthenticationCeremonyFacts["implicitSubmissionMethod"];
  advanceControl: AuthenticationCeremonyFacts["advanceControl"];
  credentialSubmission: AuthenticationCredentialSubmissionObservation;
};

export class AuthenticationPageObservationContextOwner {
  public constructor(
    private readonly request: AuthenticationPageObservationContextRequest,
  ) {}

  public observe(): AuthenticationPageObservationContext {
    const { observation, sourceOrigin } = this.request;
    const identityRequest: Parameters<typeof observedFormIdentity>[0] = {
      root: observation.root,
      formScope: observation.formScope,
    };
    const formIdentity = observedFormIdentity(identityRequest);
    const destinationIdentity = observedFormDestination(observation.formScope);
    const advanceControl = this.implicitSubmissionIsAvailable()
      ? "implicit-submission"
      : "absent";
    const implicitSubmissionMethod =
      observation.formScope.kind === PasswordFormScopeKind.Owned &&
      !ownedObservationIsLocallyBounded(observation)
        ? formSubmissionMethod(observation.formScope.owner)
        : PageControlSubmissionMethod.Absent;
    let credentialSubmission: AuthenticationCredentialSubmissionObservation = {
      kind: "absent",
    };
    const selectedAdvanceObservation =
      this.request.boundedAdvanceObservations[0];
    if (
      selectedAdvanceObservation &&
      selectedAdvanceObservation.actionability === "actionable" &&
      selectedAdvanceObservation.submissionMethod !==
        PageControlSubmissionMethod.Absent
    ) {
      credentialSubmission = {
        kind: "observed",
        facts: {
          actionability: selectedAdvanceObservation.actionability,
          method: selectedAdvanceObservation.submissionMethod,
          sourceOrigin: selectedAdvanceObservation.sourceOrigin,
          formIdentity: selectedAdvanceObservation.formIdentity,
          destinationIdentity: selectedAdvanceObservation.destinationIdentity,
        },
      };
    } else if (
      advanceControl === "implicit-submission" &&
      observation.formScope.kind === PasswordFormScopeKind.Owned
    ) {
      credentialSubmission = {
        kind: "observed",
        facts: {
          actionability: "actionable",
          method: formSubmissionMethod(observation.formScope.owner),
          sourceOrigin,
          formIdentity,
          destinationIdentity,
        },
      };
    }
    return {
      sourceOrigin,
      formIdentity,
      destinationIdentity,
      implicitSubmissionMethod,
      advanceControl,
      credentialSubmission,
    };
  }

  private implicitSubmissionIsAvailable(): boolean {
    const { observation, boundedAdvanceObservations, advanceControls } =
      this.request;
    return (
      observation.formScope.kind === PasswordFormScopeKind.Owned &&
      !ownedObservationIsLocallyBounded(observation) &&
      !boundedAdvanceObservations.some(
        (candidate) =>
          candidate.actionability === "actionable" &&
          authentication_advance_control_is_safe(candidate),
      ) &&
      !advanceControls.some(
        (control) =>
          control.matches(semanticSubmitControlSelector) &&
          !controlIsInert(control),
      ) &&
      !(
        observation.summary.currentPasswordFieldCount +
          observation.summary.genericPasswordFieldCount +
          observation.summary.newPasswordFieldCount >
          0 && formBlocksCredentialDisclosure(observation.formScope.owner)
      )
    );
  }
}
