import type { LoginCredentialsFillRequest } from "./password-form-field-actions";
import { passwordFieldDiscovery } from "./password-form-fields";
import {
  authenticationSubmissionControls,
  type LoginAdvanceControl,
} from "./password-form-submission-controls";
import { PasswordFormFieldQuery } from "./password-form-summary-state";

type ApprovedAdvanceControl = LoginAdvanceControl | false;

export interface CredentialDisclosureRevalidationRequest {
  readonly passwordField: HTMLInputElement;
  readonly approvedPasswordForm: HTMLFormElement | null;
  readonly request: LoginCredentialsFillRequest;
  readonly selectedSubmitter: (
    form: HTMLFormElement,
  ) => ApprovedAdvanceControl;
}

export class CredentialDisclosureRevalidation {
  constructor(private readonly request: CredentialDisclosureRevalidationRequest) {}

  blocks(): boolean {
    const { passwordField, approvedPasswordForm, request } = this.request;
    const fieldRemainsEligible =
      !passwordField.readOnly &&
      passwordField.form === approvedPasswordForm &&
      passwordFieldDiscovery
        .findPasswordFields(new PasswordFormFieldQuery(request).query)
        .includes(passwordField);
    if (!fieldRemainsEligible) return true;
    if (!approvedPasswordForm) return false;
    const disclosureRequest: Parameters<
      typeof authenticationSubmissionControls.selectedSubmitterBlocksCredentialDisclosure
    >[0] = {
      form: approvedPasswordForm,
      selectedSubmitter: this.request.selectedSubmitter(approvedPasswordForm),
    };
    return authenticationSubmissionControls.selectedSubmitterBlocksCredentialDisclosure(
      disclosureRequest,
    );
  }
}
