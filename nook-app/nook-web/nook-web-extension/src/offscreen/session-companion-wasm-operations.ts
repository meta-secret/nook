import { classify_companion_login_save_outcome } from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { FocusedFieldRecognitionOperation } from './session-focused-field-recognition'
import { PersonalFieldFillOperation } from './session-personal-field-fill'
import { authenticatorEnrollmentCandidateResolver } from './authenticator-enrollment-candidates'
import { reviewedAuthenticatorLabelValidator } from './authenticator-reviewed-labels'
import { GoogleLoginContinuationMessageType } from '../../../nook-web-shared/src/extension/google-login-continuation-messages'
/* eslint-disable nook-typed-api/no-raw-object-arguments, max-params -- This offscreen adapter maps Chrome session messages onto generated WASM calls. */
import { err, ok, type Result } from 'neverthrow'
import { Schema } from 'effect'
import {
  CompanionWasmContentResponseKind,
  CompanionWasmLabelKind,
  CompanionWasmSessionMessageType,
  type CompanionWasmSessionMessage,
  type CompanionWasmSessionResponse,
} from '../../../nook-web-shared/src/extension/companion-wasm-runtime-messages'
import { companionWasmReady } from '../../../nook-web-shared/src/extension/companion-ready'
import {
  NookPageInputClassifier,
  project_authentication_login_checklist,
  classify_authentication_authenticator_setup_batch,
  extract_authentication_backup_code_candidates,
  project_authentication_navigation_path,
  decode_website_login_save_offer_response,
  decode_website_login_save_action_response,
  decode_authentication_outcome_response,
  decode_authenticator_preview_response,
  decode_authenticator_backup_attach_response,
  decode_authenticator_code_response,
  decode_authenticator_enrollment_stage_response,
  decode_authenticator_enrollment_confirm_response,
  decode_authenticator_picker_open_response,
  decode_generated_password_response,
  decode_authenticator_options_response,
  AuthenticationWorkflowActivity,
  site_page_need,
  authentication_page_observation_facts_match_binding,
  authentication_page_observation_facts_priority,
  authentication_page_observation_facts_is_admissible,
  authentication_advance_control_allows_password_disclosure_planning,
  authentication_advance_control_is_safe,
  authentication_control_transportable,
  authentication_passkey_control_candidate_is_safe,
  authentication_enrollment_workflow_match,
  authentication_recovery_copy_evidence,
  decode_authentication_workflow_runtime_response,
  decode_login_picker_open_response,
  decode_website_login_options,
  decode_website_login_save_pending_response,
  authentication_workflow_pilot_presentation_capability,
  authentication_workflow_activity_progress,
  authentication_implicit_submit_actuation_is_safe,
  bind_authentication_page_observation_facts,
  is_nook_vault_app_url,
  project_password_workflow_activity,
  revalidate_approved_authentication_workflow,
  can_activate_authentication_route_control,
} from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  SessionOperationFailure,
  SessionOperationFailureKind,
} from '../lib/session-operation-queue'

function invalidRequest(): Result<never, SessionOperationFailure> {
  return err(
    new SessionOperationFailure(SessionOperationFailureKind.InvalidRequest),
  )
}

export async function handleCompanionWasmMessage(
  message: CompanionWasmSessionMessage,
): Promise<Result<CompanionWasmSessionResponse, SessionOperationFailure>> {
  try {
    await companionWasmReady
    switch (message.type) {
      case CompanionWasmSessionMessageType.ClassifyLoginSaveOutcome:
        return ok(classify_companion_login_save_outcome(message.payload))
      case GoogleLoginContinuationMessageType.Session:
        return invalidRequest()
      case CompanionWasmSessionMessageType.ProjectAuthenticationLoginChecklist:
        return ok(project_authentication_login_checklist(message.payload))
      case CompanionWasmSessionMessageType.GetAuthenticationActivityProgress:
        return ok({
          activityProgress: authentication_workflow_activity_progress(
            Schema.decodeUnknownSync(
              Schema.Enum(AuthenticationWorkflowActivity),
            )(message.payload.activity),
          ),
        })
      case CompanionWasmSessionMessageType.AuthenticationAuthenticatorSetupObservation:
        return ok({
          authenticatorSetupObservation:
            classify_authentication_authenticator_setup_batch(message.payload),
        })
      case CompanionWasmSessionMessageType.AuthenticationWorkflowPilotPresentationCapability:
        return ok(
          authentication_workflow_pilot_presentation_capability(
            message.payload.snapshot,
          ),
        )
      case CompanionWasmSessionMessageType.PasswordWorkflowActivity:
        return ok(
          project_password_workflow_activity({
            currentPasswordFieldCount:
              message.payload.currentPasswordFieldCount,
            newPasswordFieldCount: message.payload.newPasswordFieldCount,
          }),
        )
      case CompanionWasmSessionMessageType.BindAuthenticationPageObservationFacts:
        return ok(
          bind_authentication_page_observation_facts(message.payload.facts),
        )
      case CompanionWasmSessionMessageType.AuthenticationPageObservationFactsMatchBinding:
        return ok(
          authentication_page_observation_facts_match_binding(
            message.payload.binding,
            message.payload.facts,
          ),
        )
      case CompanionWasmSessionMessageType.AuthenticationEnrollmentWorkflowMatch: {
        const match = authentication_enrollment_workflow_match(
          message.payload.authenticatorSetupHint,
          message.payload.backupCodesCopy,
          message.payload.manualCheckpointPresent,
        )
        if (match.kind !== 'matched') return ok(match)
        return ok({
          ...match,
          pilotCapability:
            authentication_workflow_pilot_presentation_capability(
              match.snapshot,
            ),
        })
      }
      case CompanionWasmSessionMessageType.HasLoginContext:
        return ok(
          NookPageInputClassifier.classify_context(message.payload.observation)
            .loginContext,
        )
      case CompanionWasmSessionMessageType.ClassifyFocusedCredentialField:
      case CompanionWasmSessionMessageType.RevalidateFocusedCredentialField:
        return ok(new FocusedFieldRecognitionOperation(message).run())
      case CompanionWasmSessionMessageType.ClassifyPersonalField:
      case CompanionWasmSessionMessageType.PlanPersonalFill:
        return ok(new PersonalFieldFillOperation(message).run())
      case CompanionWasmSessionMessageType.ClassifyPageInputField:
        return ok(
          NookPageInputClassifier.classify_field(message.payload.observation),
        )
      case CompanionWasmSessionMessageType.ClassifyPageInputs:
        return ok(NookPageInputClassifier.classify_page_inputs(message.payload))
      case CompanionWasmSessionMessageType.EvaluateAuthenticationPolicies:
        return ok({
          transportability: message.payload.transportability.map((request) =>
            authentication_control_transportable(request),
          ),
          advanceControls: message.payload.advanceControls.map((request) =>
            authentication_advance_control_is_safe(request),
          ),
          passwordDisclosureControls:
            message.payload.passwordDisclosureControls.map((request) =>
              authentication_advance_control_allows_password_disclosure_planning(
                request,
              ),
            ),
          passkeyCandidates: message.payload.passkeyCandidates.map((request) =>
            authentication_passkey_control_candidate_is_safe(request),
          ),
          pageFactsPriorities: message.payload.pageFacts.map((request) =>
            authentication_page_observation_facts_priority(request),
          ),
          pageFactsAdmissibility: message.payload.pageFacts.map((request) =>
            authentication_page_observation_facts_is_admissible(request),
          ),
          implicitSubmissions: message.payload.implicitSubmissions.map(
            (request) => {
              const strictPolicy =
                authentication_implicit_submit_actuation_is_safe(request)
              const context = request.ceremony.authenticationContext
              if (!context) return strictPolicy
              const fields = request.fields
              return (
                strictPolicy ||
                can_activate_authentication_route_control(
                  context.sourceOrigin,
                  context.formIdentity,
                  context.destinationIdentity,
                  request.controlLabel,
                  request.controlMachineIdentity,
                  false,
                  fields.usernameFieldCount > 0,
                  true,
                  fields.currentPasswordFieldCount +
                    fields.genericPasswordFieldCount +
                    fields.newPasswordFieldCount >
                    0,
                )
              )
            },
          ),
          activityProgress: [
            AuthenticationWorkflowActivity.ReadyLogin,
            AuthenticationWorkflowActivity.FillingLogin,
            AuthenticationWorkflowActivity.VerifyingLogin,
            AuthenticationWorkflowActivity.FillingAuthenticator,
            AuthenticationWorkflowActivity.SaveOffer,
          ].map((activity) =>
            authentication_workflow_activity_progress(activity),
          ),
        })
      case CompanionWasmSessionMessageType.RevalidateApprovedAuthenticationWorkflow:
        return ok({
          revalidationDecision: revalidate_approved_authentication_workflow({
            approved: message.payload.approved,
            live: message.payload.live,
          }),
        })
      case CompanionWasmSessionMessageType.SitePageNeed:
        // Rust maps the classified workflow to what This site lists.
        return ok({
          sitePageNeed: site_page_need(message.payload.workflowMatch),
        })
      case CompanionWasmSessionMessageType.LooksLikeLoginAdvanceControlLabel:
        return ok(
          NookPageInputClassifier.classify_label({
            kind: CompanionWasmLabelKind.LoginAdvance,
            value: message.payload.label,
          }),
        )
      case CompanionWasmSessionMessageType.LooksLikeManualCheckpointLabel:
        return ok(
          NookPageInputClassifier.classify_label({
            kind: CompanionWasmLabelKind.ManualCheckpoint,
            value: message.payload.label,
          }),
        )
      case CompanionWasmSessionMessageType.LooksLikePasskeyControlLabel:
        return ok(
          NookPageInputClassifier.classify_label({
            kind: CompanionWasmLabelKind.PasskeyControl,
            value: message.payload.label,
          }),
        )
      case CompanionWasmSessionMessageType.LooksLikeEmailVerificationBody:
        return ok(
          NookPageInputClassifier.classify_label({
            kind: CompanionWasmLabelKind.EmailVerificationBody,
            value: message.payload.body,
          }),
        )
      case CompanionWasmSessionMessageType.LooksLikeOneTimeCodeAutoSubmitSignal:
        return ok(
          NookPageInputClassifier.classify_label({
            kind: CompanionWasmLabelKind.OneTimeCodeAutoSubmitSignal,
            value: message.payload.signal,
          }),
        )
      case CompanionWasmSessionMessageType.AuthenticationRecoveryCopyEvidence:
        return ok(
          authentication_recovery_copy_evidence({
            texts: [...message.payload.texts],
          }),
        )
      case CompanionWasmSessionMessageType.IsNookVaultAppUrl:
        return ok(
          is_nook_vault_app_url(
            message.payload.candidateUrl,
            message.payload.baseUrl,
          ),
        )
      case CompanionWasmSessionMessageType.DecodeAuthenticationWorkflowRuntimeResponse:
        return ok(
          decode_authentication_workflow_runtime_response(
            message.payload.response,
          ),
        )
      case CompanionWasmSessionMessageType.DecodeContentRuntimeResponse:
        switch (message.payload.kind) {
          case CompanionWasmContentResponseKind.LoginSaveOffer:
            return ok(
              decode_website_login_save_offer_response(
                message.payload.response,
              ),
            )
          case CompanionWasmContentResponseKind.LoginSaveAction:
            return ok(
              decode_website_login_save_action_response(
                message.payload.response,
              ),
            )
          case CompanionWasmContentResponseKind.AuthenticationOutcome:
            return ok(
              decode_authentication_outcome_response(message.payload.response),
            )
          case CompanionWasmContentResponseKind.AuthenticatorPreview:
            return ok(
              decode_authenticator_preview_response(message.payload.response),
            )
          case CompanionWasmContentResponseKind.AuthenticatorBackupAttach:
            return ok(
              decode_authenticator_backup_attach_response(
                message.payload.response,
              ),
            )
          case CompanionWasmContentResponseKind.AuthenticatorCode:
            return ok(
              decode_authenticator_code_response(message.payload.response),
            )
          case CompanionWasmContentResponseKind.AuthenticatorEnrollmentStage:
            return ok(
              decode_authenticator_enrollment_stage_response(
                message.payload.response,
              ),
            )
          case CompanionWasmContentResponseKind.AuthenticatorEnrollmentConfirm:
            return ok(
              decode_authenticator_enrollment_confirm_response(
                message.payload.response,
              ),
            )
          case CompanionWasmContentResponseKind.AuthenticatorPickerOpen:
            return ok(
              decode_authenticator_picker_open_response(
                message.payload.response,
              ),
            )
          case CompanionWasmContentResponseKind.GeneratedPassword:
            return ok(
              decode_generated_password_response(message.payload.response),
            )
          case CompanionWasmContentResponseKind.AuthenticatorOptions:
            return ok(
              decode_authenticator_options_response(message.payload.response),
            )
          case CompanionWasmContentResponseKind.LoginOptions:
            return ok(decode_website_login_options(message.payload.response))
          case CompanionWasmContentResponseKind.LoginPickerOpen:
            return ok(
              decode_login_picker_open_response(message.payload.response),
            )
          case CompanionWasmContentResponseKind.LoginSavePending:
            return ok(
              decode_website_login_save_pending_response(
                message.payload.response,
              ),
            )
        }
        return invalidRequest()
      case CompanionWasmSessionMessageType.ExtractAuthenticationBackupCodeCandidates:
        return ok(
          extract_authentication_backup_code_candidates(message.payload),
        )
      case CompanionWasmSessionMessageType.ProjectAuthenticationNavigationPath:
        return ok(project_authentication_navigation_path(message.payload))
      case CompanionWasmSessionMessageType.ResolveAuthenticatorEnrollmentCandidates:
        return authenticatorEnrollmentCandidateResolver.resolve(message)
      case CompanionWasmSessionMessageType.ValidateReviewedAuthenticatorLabels:
        return reviewedAuthenticatorLabelValidator.validate(message.payload)
    }
  } catch {
    return invalidRequest()
  }
}
