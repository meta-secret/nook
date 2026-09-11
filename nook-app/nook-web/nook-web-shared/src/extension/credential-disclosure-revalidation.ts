import type { LoginCredentialsFillRequest } from "./password-form-field-actions";
import { passwordFieldDiscovery } from "./password-form-fields";
import {
  authenticationSubmissionControls,
  type LoginAdvanceControl,
} from "./password-form-submission-controls";
import { PasswordFormFieldQuery } from "./password-form-summary-state";

type ApprovedAdvanceControl = LoginAdvanceControl | false;

export enum ApprovedPasswordFormKind {
  Unavailable = "unavailable",
  Available = "available",
}

export type ApprovedPasswordForm =
  | { readonly kind: ApprovedPasswordFormKind.Unavailable }
  | {
      readonly kind: ApprovedPasswordFormKind.Available;
      readonly form: HTMLFormElement;
    };

export interface CredentialDisclosureRevalidationRequest {
  readonly passwordField: HTMLInputElement;
  readonly approvedPasswordForm: ApprovedPasswordForm;
  readonly request: LoginCredentialsFillRequest;
  readonly selectedSubmitter: (form: HTMLFormElement) => ApprovedAdvanceControl;
}

export class CredentialDisclosureRevalidation {
  constructor(
    private readonly request: CredentialDisclosureRevalidationRequest,
  ) {}

  blocks(): boolean {
    const { passwordField, approvedPasswordForm, request } = this.request;
    const remainsInApprovedForm =
      approvedPasswordForm.kind === ApprovedPasswordFormKind.Available
        ? passwordField.form === approvedPasswordForm.form
        : !passwordField.form;
    const fieldRemainsEligible =
      !passwordField.readOnly &&
      remainsInApprovedForm &&
      passwordFieldDiscovery
        .findPasswordFields(new PasswordFormFieldQuery(request).query)
        .includes(passwordField);
    if (!fieldRemainsEligible) return true;
    if (approvedPasswordForm.kind === ApprovedPasswordFormKind.Unavailable)
      return false;
    const approvedForm = approvedPasswordForm.form;
    const disclosureRequest: Parameters<
      typeof authenticationSubmissionControls.selectedSubmitterBlocksCredentialDisclosure
    >[0] = {
      form: approvedForm,
      selectedSubmitter: this.request.selectedSubmitter(approvedForm),
    };
    return authenticationSubmissionControls.selectedSubmitterBlocksCredentialDisclosure(
      disclosureRequest,
    );
  }
}
