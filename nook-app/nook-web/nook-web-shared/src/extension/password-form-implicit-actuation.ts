import { authentication_implicit_submit_actuation_is_safe } from "./nook-companion-wasm/nook_companion_wasm.js";
import type {
  AuthenticationImplicitSubmitActuationObservation,
  AuthenticationPageObservationFacts,
} from "./nook-companion-wasm/nook_companion_wasm.js";
import {
  FormSubmissionResult,
  type FormSubmissionApproval,
  authenticationSubmissionControls,
} from "./password-form-submission-controls";

type OwnedFormObservation = {
  formScope: { kind: string; owner?: HTMLFormElement };
};

export enum OwnedAdvanceControlActivationKind {
  Absent = "absent",
  Activated = "activated",
}

export type OwnedAdvanceControlActivation =
  | { kind: OwnedAdvanceControlActivationKind.Absent }
  | {
      kind: OwnedAdvanceControlActivationKind.Activated;
      result: FormSubmissionResult;
    };

export type OwnedAuthenticationControlRequest<Request> = {
  request: Request;
  form: HTMLFormElement;
};

type CurrentOwnedFormObservationRequest<
  Observation extends OwnedFormObservation,
> = {
  root: ParentNode;
  form: HTMLFormElement;
  observations: () => Observation[];
};

export type ApprovedImplicitAuthenticationSubmitRequest<
  Observation extends OwnedFormObservation,
> = CurrentOwnedFormObservationRequest<Observation> & {
  factsForObservation: (
    observation: Observation,
  ) => AuthenticationPageObservationFacts;
  hasAuthenticationUsername: boolean;
  hasAuthenticationPassword: boolean;
  requestedApproval: FormSubmissionApproval | false;
};

export class ApprovedImplicitAuthenticationSubmission<
  Observation extends OwnedFormObservation,
> {
  constructor(
    private readonly request: ApprovedImplicitAuthenticationSubmitRequest<Observation>,
  ) {}
  execute(): FormSubmissionResult {
    const request = this.request;
    const actuationIsSafe = (): boolean => {
      const observation =
        this.currentOwnedAuthenticationFormObservation();
      return Boolean(
        observation &&
        new AuthenticationImplicitActuationEvidence(
          request.factsForObservation(observation),
        ).isSafe(),
      );
    };
    const implicitRequest: Parameters<
      typeof authenticationSubmissionControls.requestImplicitAuthenticationSubmit
    >[0] = {
      form: request.form,
      hasAuthenticationUsername: request.hasAuthenticationUsername,
      hasAuthenticationPassword: request.hasAuthenticationPassword,
      approval: request.requestedApproval || false,
      alternativeActuationIsSafe: actuationIsSafe,
    };
    return authenticationSubmissionControls.requestImplicitAuthenticationSubmit(
      implicitRequest,
    );
  }
  private currentOwnedAuthenticationFormObservation(): Observation | false {
    const { root, form, observations } = this.request;
    const formWithinRoot =
      root === form.ownerDocument ||
      (root instanceof Node && root.contains(form));
    return (
      observations().find(
        (candidate) =>
          formWithinRoot &&
          candidate.formScope.kind === "owned" &&
          candidate.formScope.owner === form,
      ) || false
    );
  }
}

class AuthenticationImplicitActuationEvidence {
  constructor(private readonly facts: AuthenticationPageObservationFacts) {}
  isSafe(): boolean {
    const facts = this.facts;
    const observation: AuthenticationImplicitSubmitActuationObservation = {
      fields: facts.fields,
      ceremony: facts.ceremony,
      controlLabel: "",
      controlMachineIdentity: "",
    };
    return authentication_implicit_submit_actuation_is_safe(observation);
  }
}
