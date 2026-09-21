import {
  NookLoginContextObservation,
  NookPageInputFieldObservation,
  authentication_username_evidence,
  has_login_context,
  looks_like_email_verification_body,
  looks_like_login_advance_control_label,
  looks_like_manual_checkpoint_label,
  looks_like_one_time_code_auto_submit_signal,
  looks_like_one_time_code_field,
  looks_like_passkey_control_label,
  looks_like_username_field,
  parse_page_input_type,
  strongest_authentication_username_evidence,
  type AuthenticationUsernameEvidence,
} from "./nook-companion-wasm/nook_companion_wasm.js";
import {
  CompanionWasmLabelKind,
  type CompanionWasmPageInputFieldObservation,
} from "./companion-wasm-runtime-messages";

type LoginContextObservation = {
  formIdentity: string;
  ancestorIdentities: string[];
  advanceControlLabel: string;
  pathContext: string;
};

type AuthenticationUsernameEvidenceList = AuthenticationUsernameEvidence[];

type DirectLabelRequest = {
  kind: CompanionWasmLabelKind;
  value: string;
};

export type DirectFieldClassification = {
  readonly authenticationUsernameEvidence: AuthenticationUsernameEvidence;
  readonly looksLikeUsernameField: boolean;
  readonly looksLikeOneTimeCodeField: boolean;
};

/** Synchronous Rust policy adapter for non-extension hosts such as unit tests. */
export class PasswordFormFieldDirectClassification {
  loginContext(observation: LoginContextObservation): boolean {
    const value = new NookLoginContextObservation(
      observation.formIdentity,
      observation.ancestorIdentities,
      observation.advanceControlLabel,
      observation.pathContext,
    );
    try {
      return has_login_context(value);
    } finally {
      value.free();
    }
  }

  field(
    observation: CompanionWasmPageInputFieldObservation,
  ): DirectFieldClassification {
    const value = new NookPageInputFieldObservation(
      parse_page_input_type(observation.inputType),
      observation.disabled,
      observation.readOnly,
      [...observation.autocompleteTokens],
      observation.identityText,
      observation.loginContext,
    );
    try {
      return {
        authenticationUsernameEvidence: authentication_username_evidence(value),
        looksLikeUsernameField: looks_like_username_field(value),
        looksLikeOneTimeCodeField: looks_like_one_time_code_field(value),
      };
    } finally {
      value.free();
    }
  }

  strongestUsernameEvidence(
    evidence: AuthenticationUsernameEvidenceList,
  ): AuthenticationUsernameEvidence {
    return strongest_authentication_username_evidence(evidence);
  }

  label({ kind, value }: DirectLabelRequest): boolean {
    switch (kind) {
      case CompanionWasmLabelKind.LoginAdvance:
        return looks_like_login_advance_control_label(value);
      case CompanionWasmLabelKind.PasskeyControl:
        return looks_like_passkey_control_label(value);
      case CompanionWasmLabelKind.ManualCheckpoint:
        return looks_like_manual_checkpoint_label(value);
      case CompanionWasmLabelKind.OneTimeCodeAutoSubmitSignal:
        return looks_like_one_time_code_auto_submit_signal(value);
      case CompanionWasmLabelKind.EmailVerificationBody:
        return looks_like_email_verification_body(value);
    }
  }
}
