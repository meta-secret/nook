/* eslint-disable nook-typed-api/no-raw-object-arguments, max-params -- This offscreen adapter maps Chrome session messages onto generated WASM calls. */
import { err, ok, type Result } from 'neverthrow'
import {
  CompanionWasmContentResponseKind,
  CompanionWasmLabelKind,
  CompanionWasmSessionMessageType,
  type CompanionWasmPageInputFieldObservation,
  type CompanionWasmPageInputFieldRequest,
  type CompanionWasmLabelRequest,
  type CompanionWasmSessionMessage,
  type CompanionWasmSessionResponse,
} from '../../../nook-web-shared/src/extension/companion-wasm-runtime-messages'
import { companionWasmReady } from '../../../nook-web-shared/src/extension/companion-ready'
import {
  NookLoginContextObservation,
  NookPageInputFieldObservation,
  AuthenticationWorkflowActivity,
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
  authentication_username_evidence,
  authentication_workflow_pilot_presentation_capability,
  authentication_workflow_activity_progress,
  authentication_implicit_submit_actuation_is_safe,
  bind_authentication_page_observation_facts,
  has_login_context,
  looks_like_email_verification_body,
  looks_like_login_advance_control_label,
  looks_like_manual_checkpoint_label,
  looks_like_one_time_code_auto_submit_signal,
  looks_like_one_time_code_field,
  looks_like_passkey_control_label,
  looks_like_username_field,
  parse_page_input_type,
  is_nook_vault_app_url,
  project_password_workflow_activity,
  revalidate_approved_authentication_workflow,
  strongest_authentication_username_evidence,
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

function classifyPageInputField(
  observation: CompanionWasmPageInputFieldObservation,
): CompanionWasmSessionResponse {
  const field = new NookPageInputFieldObservation(
    parse_page_input_type(observation.inputType),
    observation.disabled,
    observation.readOnly,
    [...observation.autocompleteTokens],
    observation.identityText,
    observation.loginContext,
  )
  try {
    return {
      authenticationUsernameEvidence: authentication_username_evidence(field),
      looksLikeUsernameField: looks_like_username_field(field),
      looksLikeOneTimeCodeField: looks_like_one_time_code_field(field),
    }
  } finally {
    field.free()
  }
}

function classifyPageInputs(
  fields: readonly CompanionWasmPageInputFieldRequest[],
  labels: readonly CompanionWasmLabelRequest[],
): CompanionWasmSessionResponse {
  const classified = fields.map((request) => {
    const context = request.loginContextObservation
    const loginContextObservation = new NookLoginContextObservation(
      context.formIdentity,
      [...context.ancestorIdentities],
      context.advanceControlLabel,
      context.pathContext,
    )
    try {
      const loginContext = has_login_context(loginContextObservation)
      const field = new NookPageInputFieldObservation(
        parse_page_input_type(request.observation.inputType),
        request.observation.disabled,
        request.observation.readOnly,
        [...request.observation.autocompleteTokens],
        request.observation.identityText,
        loginContext,
      )
      try {
        return {
          index: request.index,
          loginContext,
          authenticationUsernameEvidence:
            authentication_username_evidence(field),
          looksLikeUsernameField: looks_like_username_field(field),
          looksLikeOneTimeCodeField: looks_like_one_time_code_field(field),
        }
      } finally {
        field.free()
      }
    } finally {
      loginContextObservation.free()
    }
  })
  const evidence = classified.map(
    (field) => field.authenticationUsernameEvidence,
  )
  const labelResults = labels.map((label) => ({
    ...label,
    matches: labelMatches(label),
  }))
  return {
    fields: classified,
    strongestAuthenticationUsernameEvidence:
      strongest_authentication_username_evidence(evidence),
    labels: labelResults,
  }
}

function labelMatches(label: CompanionWasmLabelRequest): boolean {
  switch (label.kind) {
    case CompanionWasmLabelKind.LoginAdvance:
      return looks_like_login_advance_control_label(label.value)
    case CompanionWasmLabelKind.ManualCheckpoint:
      return looks_like_manual_checkpoint_label(label.value)
    case CompanionWasmLabelKind.PasskeyControl:
      return looks_like_passkey_control_label(label.value)
    case CompanionWasmLabelKind.EmailVerificationBody:
      return looks_like_email_verification_body(label.value)
    case CompanionWasmLabelKind.OneTimeCodeAutoSubmitSignal:
      return looks_like_one_time_code_auto_submit_signal(label.value)
  }
}

export async function handleCompanionWasmMessage(
  message: CompanionWasmSessionMessage,
): Promise<Result<CompanionWasmSessionResponse, SessionOperationFailure>> {
  try {
    await companionWasmReady
    switch (message.type) {
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
      case CompanionWasmSessionMessageType.AuthenticationEnrollmentWorkflowMatch:
        return ok(
          authentication_enrollment_workflow_match(
            message.payload.authenticatorSetupHint,
            message.payload.backupCodesCopy,
            message.payload.manualCheckpointPresent,
          ),
        )
      case CompanionWasmSessionMessageType.HasLoginContext: {
        const observation = message.payload.observation
        const loginContext = new NookLoginContextObservation(
          observation.formIdentity,
          [...observation.ancestorIdentities],
          observation.advanceControlLabel,
          observation.pathContext,
        )
        try {
          return ok(has_login_context(loginContext))
        } finally {
          loginContext.free()
        }
      }
      case CompanionWasmSessionMessageType.ClassifyPageInputField:
        return ok(classifyPageInputField(message.payload.observation))
      case CompanionWasmSessionMessageType.ClassifyPageInputs:
        return ok(
          classifyPageInputs(message.payload.fields, message.payload.labels),
        )
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
      case CompanionWasmSessionMessageType.LooksLikeLoginAdvanceControlLabel:
        return ok(looks_like_login_advance_control_label(message.payload.label))
      case CompanionWasmSessionMessageType.LooksLikeManualCheckpointLabel:
        return ok(looks_like_manual_checkpoint_label(message.payload.label))
      case CompanionWasmSessionMessageType.LooksLikePasskeyControlLabel:
        return ok(looks_like_passkey_control_label(message.payload.label))
      case CompanionWasmSessionMessageType.LooksLikeEmailVerificationBody:
        return ok(looks_like_email_verification_body(message.payload.body))
      case CompanionWasmSessionMessageType.LooksLikeOneTimeCodeAutoSubmitSignal:
        return ok(
          looks_like_one_time_code_auto_submit_signal(message.payload.signal),
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
    }
  } catch {
    return invalidRequest()
  }
}
