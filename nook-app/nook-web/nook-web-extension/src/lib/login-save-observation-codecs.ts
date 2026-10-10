import { Schema } from 'effect'
import { AuthenticationWorkflowKind } from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import type {
  LoginSaveCaptureBaseline,
  LoginSaveCommitEvidence,
  LoginSaveOutcomeObservation,
  LoginSubmissionCapture,
  LoginSubmissionFieldMetadata,
  LoginSubmissionIntent,
  AuthenticationAdvanceControlObservation,
  AuthenticationDetailedAdvanceControlObservation,
  AuthenticationDetailedPasskeyControlObservation,
  AuthenticationDetailedPasskeyControlCandidateObservation,
  AuthenticationCeremonyContextObservation,
  AuthenticationCeremonyObservationFacts,
  AuthenticationAuthenticatorObservationFacts,
  AuthenticationFieldObservationFacts,
  AuthenticationCredentialSubmissionFacts,
  AuthenticationCredentialSubmissionObservation,
  AuthenticationPageObservationFacts,
  LoginSubmissionTarget,
  LoginCapturedFieldIndex,
} from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { AuthenticationOutcomeObservationViewSchema } from './outcome-evidence-messages'

export enum LoginSaveEvidenceKind {
  SubmittedLogin = 'SubmittedLogin',
  ExplicitAuthentication = 'ExplicitAuthentication',
}
enum AuthenticationObservationKind {
  Absent = 'absent',
  Observed = 'observed',
  ExplicitlyMarked = 'explicitly-marked',
  Labeled = 'labeled',
  Candidates = 'candidates',
}
enum LoginSubmissionTargetKind {
  CredentialScope = 'CredentialScope',
  CredentialField = 'CredentialField',
  OutsideCredentialScope = 'OutsideCredentialScope',
}

type BrowserObservation<Value> = Value extends string | number | boolean
  ? Value
  : Value extends readonly (infer Entry)[]
    ? BrowserObservation<Entry>[]
    : { [Key in keyof Value]: BrowserObservation<Value[Key]> }
type ObservationFields<Value> = {
  readonly [Key in keyof Value]-?: Pick<Value, Key> extends Required<
    Pick<Value, Key>
  >
    ? Schema.Codec<BrowserObservation<Value[Key]>>
    : Schema.optionalKey<Schema.Codec<BrowserObservation<Required<Value>[Key]>>>
}

/** Browser-envelope validation; portable eligibility remains in Rust. */
export class LoginSaveObservationCodecs {
  private readonly workflow = Schema.Literals([
    AuthenticationWorkflowKind.Login,
    AuthenticationWorkflowKind.Signup,
    AuthenticationWorkflowKind.PasswordChange,
    AuthenticationWorkflowKind.TotpChallenge,
    AuthenticationWorkflowKind.TotpEnrollment,
    AuthenticationWorkflowKind.Manual,
  ])
  private readonly usernameEvidence = Schema.Literals([
    'absent',
    'generic',
    'standards-based-email',
    'mixed-phone-or-email',
    'web-authn-email',
    'strong',
    'explicit',
  ])
  private readonly method = Schema.Literals(['absent', 'post', 'get', 'dialog'])
  private readonly absentFields: ObservationFields<
    Extract<
      AuthenticationDetailedAdvanceControlObservation,
      { kind: `${AuthenticationObservationKind.Absent}` }
    >
  > = { kind: Schema.Literal('absent') }
  private readonly absent = Schema.Struct(this.absentFields)
  private readonly controlFields: ObservationFields<AuthenticationAdvanceControlObservation> =
    {
      actionability: Schema.Literals(['inert', 'actionable']),
      ownership: Schema.Literals(['unowned', 'owned-form', 'locally-scoped']),
      semantics: Schema.Literals(['activation', 'semantic-submit']),
      authenticationUsername: this.usernameEvidence,
      passwordFieldCount: Schema.Number,
      newPasswordFieldCount: Schema.Number,
      oneTimeCodeFieldCount: Schema.Number,
      semanticSubmitControlCount: Schema.Number,
      sourceOrigin: Schema.String,
      formIdentity: Schema.String,
      destinationIdentity: Schema.String,
      label: Schema.String,
      machineIdentity: Schema.optionalKey(Schema.String),
      submissionMethod: Schema.optionalKey(this.method),
      submissionDestinationSource: Schema.Literals(['omitted', 'authored']),
    }
  private readonly control = Schema.Struct(this.controlFields)
  private readonly advanceFields: ObservationFields<
    Extract<
      AuthenticationDetailedAdvanceControlObservation,
      { kind: `${AuthenticationObservationKind.Observed}` }
    >
  > = {
    kind: Schema.Literal('observed'),
    observations: Schema.mutable(Schema.Array(this.control)),
  }
  private readonly observedPasskeyFields: ObservationFields<
    Extract<
      AuthenticationDetailedPasskeyControlObservation,
      { kind: `${AuthenticationObservationKind.Observed}` }
    >
  > = { kind: Schema.Literal('observed'), observation: this.control }
  private readonly markedPasskeyFields: ObservationFields<
    Extract<
      AuthenticationDetailedPasskeyControlObservation,
      { kind: `${AuthenticationObservationKind.ExplicitlyMarked}` }
    >
  > = { kind: Schema.Literal('explicitly-marked'), observation: this.control }
  private readonly labeledPasskeyFields: ObservationFields<
    Extract<
      AuthenticationDetailedPasskeyControlCandidateObservation,
      { kind: `${AuthenticationObservationKind.Labeled}` }
    >
  > = { kind: Schema.Literal('labeled'), observation: this.control }
  private readonly passkeyCandidate = Schema.Union([
    Schema.Struct(this.labeledPasskeyFields),
    Schema.Struct(this.markedPasskeyFields),
  ])
  private readonly passkeyCandidatesFields: ObservationFields<
    Extract<
      AuthenticationDetailedPasskeyControlObservation,
      { kind: `${AuthenticationObservationKind.Candidates}` }
    >
  > = {
    kind: Schema.Literal('candidates'),
    observation: Schema.mutable(Schema.Array(this.passkeyCandidate)),
  }
  private readonly passkey = Schema.Union([
    this.absent,
    Schema.Struct(this.observedPasskeyFields),
    Schema.Struct(this.markedPasskeyFields),
    Schema.Struct(this.passkeyCandidatesFields),
  ])
  private readonly contextIdentityFields: ObservationFields<AuthenticationCeremonyContextObservation> =
    {
      authenticationUsername: this.usernameEvidence,
      sourceOrigin: Schema.String,
      formIdentity: Schema.String,
      destinationIdentity: Schema.String,
    }
  private readonly ceremonyFields: ObservationFields<AuthenticationCeremonyObservationFacts> =
    {
      oneTimeCodeProgression: Schema.Literals([
        'advance-control-required',
        'auto-submit-observed',
      ]),
      oneTimeCodeHandlerSignal: Schema.optionalKey(Schema.String),
      oneTimeCodeHandlerSignals: Schema.optionalKey(
        Schema.mutable(Schema.Array(Schema.String)),
      ),
      authenticationContext: Schema.optionalKey(
        Schema.Struct(this.contextIdentityFields),
      ),
      manualCheckpoint: Schema.Literals(['absent', 'present']),
      advanceControl: Schema.Literals([
        'absent',
        'present',
        'implicit-submission',
      ]),
      implicitSubmissionMethod: Schema.optionalKey(this.method),
    }
  private readonly authenticatorFields: ObservationFields<AuthenticationAuthenticatorObservationFacts> =
    {
      authenticatorSetup: Schema.Literals(['absent', 'present']),
      backupCodesCopy: Schema.String,
      passkeyControl: Schema.Literals(['absent', 'present']),
      passkeyAccountAvailability: Schema.Literals(['unavailable', 'ready']),
      matchingPasskeyAccountCount: Schema.Number,
      detailedPasskeyControl: Schema.optionalKey(this.passkey),
    }
  private readonly fieldCountFields: ObservationFields<AuthenticationFieldObservationFacts> =
    {
      usernameFieldCount: Schema.Number,
      currentPasswordFieldCount: Schema.Number,
      newPasswordFieldCount: Schema.Number,
      genericPasswordFieldCount: Schema.Number,
      oneTimeCodeFieldCount: Schema.Number,
      actionablePasswordFieldCount: Schema.Number,
      readonlyPasswordFieldCount: Schema.Number,
    }
  private readonly submissionFactFields: ObservationFields<AuthenticationCredentialSubmissionFacts> =
    {
      actionability: Schema.Literals(['inert', 'actionable']),
      method: this.method,
      sourceOrigin: Schema.String,
      formIdentity: Schema.String,
      destinationIdentity: Schema.String,
    }
  private readonly submissionFields: ObservationFields<
    Extract<
      AuthenticationCredentialSubmissionObservation,
      { kind: `${AuthenticationObservationKind.Observed}` }
    >
  > = {
    kind: Schema.Literal('observed'),
    facts: Schema.Struct(this.submissionFactFields),
  }
  private readonly contextFields: ObservationFields<AuthenticationPageObservationFacts> =
    {
      fields: Schema.Struct(this.fieldCountFields),
      ceremony: Schema.Struct(this.ceremonyFields),
      authenticator: Schema.Struct(this.authenticatorFields),
      credentialSubmission: Schema.Union([
        this.absent,
        Schema.Struct(this.submissionFields),
      ]),
      detailedAdvanceControl: Schema.optionalKey(
        Schema.Union([this.absent, Schema.Struct(this.advanceFields)]),
      ),
    }
  private readonly scopeTargetFields: ObservationFields<
    Extract<
      LoginSubmissionTarget,
      { kind: `${LoginSubmissionTargetKind.CredentialScope}` }
    >
  > = { kind: Schema.Literal('CredentialScope') }
  private readonly outsideTargetFields: ObservationFields<
    Extract<
      LoginSubmissionTarget,
      { kind: `${LoginSubmissionTargetKind.OutsideCredentialScope}` }
    >
  > = { kind: Schema.Literal('OutsideCredentialScope') }
  private readonly capturedIndexFields: ObservationFields<LoginCapturedFieldIndex> =
    { value: Schema.Number }
  private readonly fieldTargetFields: ObservationFields<
    Extract<
      LoginSubmissionTarget,
      { kind: `${LoginSubmissionTargetKind.CredentialField}` }
    >
  > = {
    kind: Schema.Literal('CredentialField'),
    field_index: Schema.Struct(this.capturedIndexFields),
  }
  private readonly target = Schema.Union([
    Schema.Struct(this.scopeTargetFields),
    Schema.Struct(this.fieldTargetFields),
    Schema.Struct(this.outsideTargetFields),
  ])
  private readonly metadataFields: ObservationFields<LoginSubmissionFieldMetadata> =
    {
      input_type: Schema.String,
      disabled: Schema.Boolean,
      read_only: Schema.Boolean,
      autocomplete_tokens: Schema.mutable(Schema.Array(Schema.String)),
      identity_text: Schema.String,
      login_context: Schema.Boolean,
      password_history: Schema.Literals(['PreviouslyPassword', 'Unobserved']),
    }
  // The non-secret page facts reach the canonical Rust decoder after first-ingress ownership.
  private readonly intentFields: ObservationFields<LoginSubmissionIntent> = {
    event: Schema.Literals(['FormSubmit', 'Click', 'Enter', 'Other']),
    trust: Schema.Literals(['Trusted', 'Untrusted']),
    target: this.target,
    control_label: Schema.String,
    context: Schema.Struct(this.contextFields),
  }
  private readonly intent = Schema.Struct(this.intentFields)

  private readonly captureFields: ObservationFields<LoginSubmissionCapture> = {
    intent: this.intent,
    fields: Schema.mutable(Schema.Array(Schema.Struct(this.metadataFields))),
    submitted_at: Schema.Number,
    submitted_url: Schema.String,
    controls: Schema.mutable(Schema.Array(Schema.String)),
    explicit_candidate: Schema.Literals(['Present', 'Absent']),
  }
  readonly capture = Schema.Struct(this.captureFields)

  private readonly baselineFields: ObservationFields<LoginSaveCaptureBaseline> =
    {
      source: Schema.Literals(['SubmittedLogin', 'ExplicitAuthentication']),
      submitted_at: Schema.Number,
      submitted_url: Schema.String,
      captured_workflow: this.workflow,
      initial_auth_fields: Schema.Literals(['Present', 'Absent']),
      controls: Schema.mutable(Schema.Array(Schema.String)),
    }
  readonly baseline = Schema.Struct(this.baselineFields)
  private readonly outcomeFields: ObservationFields<LoginSaveOutcomeObservation> =
    {
      observation: AuthenticationOutcomeObservationViewSchema,
      captured_workflow: this.workflow,
      submission: Schema.Literals(['Captured', 'Absent']),
      origin: Schema.Literals(['SameOrigin', 'ChangedOrigin']),
      initial_auth_fields: Schema.Literals(['Present', 'Absent']),
      transition: Schema.Literals([
        'None',
        'SameDocumentMutation',
        'SameDocumentNavigation',
        'DocumentNavigation',
      ]),
      checkpoint: Schema.Literals(['Clear', 'Pending']),
      no_auth_elapsed_ms: Schema.Number,
      baseline_controls: Schema.mutable(Schema.Array(Schema.String)),
      current_controls: Schema.mutable(Schema.Array(Schema.String)),
    }
  readonly outcome = Schema.Struct(this.outcomeFields)
  private readonly submittedFields: ObservationFields<
    Extract<
      LoginSaveCommitEvidence,
      { kind: `${LoginSaveEvidenceKind.SubmittedLogin}` }
    >
  > = {
    kind: Schema.Literal('SubmittedLogin'),
    observation: this.outcome,
  }
  private readonly explicitFields: ObservationFields<
    Extract<
      LoginSaveCommitEvidence,
      { kind: `${LoginSaveEvidenceKind.ExplicitAuthentication}` }
    >
  > = {
    kind: Schema.Literal('ExplicitAuthentication'),
    observation: AuthenticationOutcomeObservationViewSchema,
  }
  readonly evidence = Schema.Union([
    Schema.Struct(this.submittedFields),
    Schema.Struct(this.explicitFields),
  ])
}
