import { authentication_implicit_submit_actuation_is_safe } from "./nook-companion-wasm/nook_companion_wasm.js";
import type {
  AuthenticationImplicitSubmitActuationObservation,
  AuthenticationPageObservationFacts,
} from "./nook-companion-wasm/nook_companion_wasm.js";
import {
  FormSubmissionResult,
  requestImplicitAuthenticationSubmit,
  type FormSubmissionApproval,
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

function currentOwnedAuthenticationFormObservation<
  Observation extends OwnedFormObservation,
>({
  root,
  form,
  observations,
}: CurrentOwnedFormObservationRequest<Observation>): Observation | false {
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

function authenticationImplicitSubmitActuationIsSafe(
  facts: AuthenticationPageObservationFacts,
): boolean {
  const observation: AuthenticationImplicitSubmitActuationObservation = {
    fields: facts.fields,
    ceremony: facts.ceremony,
    controlLabel: "",
    controlMachineIdentity: "",
  };
  return authentication_implicit_submit_actuation_is_safe(observation);
}

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

export function requestApprovedImplicitAuthenticationSubmit<
  Observation extends OwnedFormObservation,
>(
  request: ApprovedImplicitAuthenticationSubmitRequest<Observation>,
): FormSubmissionResult {
  const actuationIsSafe = (): boolean => {
    const observation = currentOwnedAuthenticationFormObservation(request);
    return Boolean(
      observation &&
      authenticationImplicitSubmitActuationIsSafe(
        request.factsForObservation(observation),
      ),
    );
  };
  const implicitRequest: Parameters<
    typeof requestImplicitAuthenticationSubmit
  >[0] = {
    form: request.form,
    hasAuthenticationUsername: request.hasAuthenticationUsername,
    hasAuthenticationPassword: request.hasAuthenticationPassword,
    approval: request.requestedApproval || false,
    alternativeActuationIsSafe: actuationIsSafe,
  };
  return requestImplicitAuthenticationSubmit(implicitRequest);
}
