import {
  AuthenticationWorkflowAction,
  AuthenticationWorkflowKind,
  CompanionAuthenticationWorkflowMatchKind,
  CredentialFillRejection,
  authentication_advance_control_is_safe,
  classify_companion_authentication_workflow_facts,
  companion_authentication_workflow_match_kind,
  type AuthenticationPageObservationFacts,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  AuthenticationWorkflowClassification,
  LiveApprovedAuthenticationWorkflow,
  LiveAuthenticationWorkflowDisposition,
} from '../../../../nook-web-shared/src/extension/password-form-classified-observations'
import {
  FormSubmissionResult,
  PasswordFormQueryKind,
  passwordFormCredentialInteraction,
  passwordFormInteraction,
  passwordFieldDiscovery,
} from '../../../../nook-web-shared/src/extension/password-forms'
import type { SiteFixtureField } from '../../../../nook-web-extension/e2e/mock-auth/src/lib/site-fixtures'
import {
  CredentialFillJourneyOutcomeKind,
  SimulatedCredentialFieldIdentity,
  SimulatedCredentialFieldKind,
  SimulatedLoginPageIdentity,
  simulateLoginJourney,
  type CredentialFillJourneyRequest,
  type FakeLoginCredentials,
  type SimulatedCredentialFieldDefinition,
} from './companion-credential-fill-simulation'

export type DomAuthenticationFixture = {
  readonly html: string
}

export type DomAuthenticationSimulationRequest = {
  readonly fixture: DomAuthenticationFixture
  readonly credentials: FakeLoginCredentials
}

export enum DomAuthenticationSimulationOutcomeKind {
  Login = 'login',
  FailClosed = 'fail-closed',
}

type DomAuthenticationSimulationEvidence = {
  readonly observationCount: number
  readonly observedRoots: readonly ParentNode[]
  readonly matchKind: CompanionAuthenticationWorkflowMatchKind
  readonly selectedRoot: ParentNode | false
  readonly workflowKind: AuthenticationWorkflowKind | false
  readonly workflowAction: AuthenticationWorkflowAction | false
  readonly credentialFillOutcome: CredentialFillJourneyOutcomeKind | false
  readonly credentialFillRejection: CredentialFillRejection | false
  readonly implicitSubmissionMethod: AuthenticationPageObservationFacts['ceremony']['implicitSubmissionMethod']
  readonly advanceControl: AuthenticationPageObservationFacts['ceremony']['advanceControl']
  readonly detailedAdvanceControlKind: NonNullable<
    AuthenticationPageObservationFacts['detailedAdvanceControl']
  >['kind']
  readonly credentialSubmissionKind: AuthenticationPageObservationFacts['credentialSubmission']['kind']
  readonly filled: boolean
  readonly submissionResult: FormSubmissionResult
  readonly submittedControlIdentity: string
}

export type DomAuthenticationSimulationResult =
  DomAuthenticationSimulationEvidence & {
    readonly kind: DomAuthenticationSimulationOutcomeKind
  }

function renderFixture(fixture: DomAuthenticationFixture): void {
  document.body.innerHTML = fixture.html
}

function submissionControlIdentity(event: SubmitEvent): string {
  const { submitter } = event
  if (!(submitter instanceof HTMLElement)) return ''
  if (submitter.id) return submitter.id
  if (submitter instanceof HTMLInputElement) return submitter.value
  return ((value) => (value ? value.trim() : ''))(submitter.textContent)
}

function orderedObservedFields(
  observation: DomCredentialObservation,
): HTMLInputElement[] {
  const observedFields = [
    ...passwordFieldDiscovery.findUsernameFields(observation),
    ...passwordFieldDiscovery.findPasswordFields(observation),
    ...passwordFieldDiscovery.findOneTimeCodeFields(observation),
  ]
  const observed = new Set(observedFields)
  return Array.from(
    document.querySelectorAll<HTMLInputElement>('input'),
  ).filter((field) => observed.has(field))
}

function fixtureField(field: HTMLInputElement): SiteFixtureField {
  const fixture: SiteFixtureField = {
    type: field.type,
    name: field.name,
    id: field.id,
    autocomplete: field.autocomplete,
    placeholder: field.placeholder,
  }
  const ariaLabel = field.getAttribute('aria-label')
  const dataQa = field.getAttribute('data-qa')
  const dataTestId = field.getAttribute('data-testid')
  if (ariaLabel) fixture['aria-label'] = ariaLabel
  if (dataQa) fixture['data-qa'] = dataQa
  if (dataTestId) fixture['data-testid'] = dataTestId
  return fixture
}

type DomCredentialPlanning = {
  readonly kind: CredentialFillJourneyOutcomeKind
  readonly rejection: CredentialFillRejection | false
}

type DomCredentialObservation = Parameters<
  typeof passwordFormInteraction.fillLoginCredentials
>[0]

type DomCredentialPlanningRequest = {
  readonly observation: DomCredentialObservation
  readonly credentials: FakeLoginCredentials
}

function planDomCredentialFill({
  observation,
  credentials,
}: DomCredentialPlanningRequest): DomCredentialPlanning {
  const fields: SimulatedCredentialFieldDefinition[] = []
  const observedFieldIdentities: SimulatedCredentialFieldIdentity[] = []
  for (const [index, input] of orderedObservedFields(observation).entries()) {
    const fieldIdentity = new SimulatedCredentialFieldIdentity(
      `dom-observed-field-${index}`,
    )
    const definition: SimulatedCredentialFieldDefinition = {
      kind: SimulatedCredentialFieldKind.Classified,
      field_identity: fieldIdentity,
      name: input.name,
      field: fixtureField(input),
      value: input.value,
    }
    fields.push(definition)
    observedFieldIdentities.push(fieldIdentity)
  }
  const journeyRequest: CredentialFillJourneyRequest = {
    credentials,
    pages: [
      {
        page_identity: new SimulatedLoginPageIdentity('dom-observed-page'),
        fields,
        observed_field_identities: observedFieldIdentities,
      },
    ],
  }
  const [outcome] = simulateLoginJourney(journeyRequest)
  if (!outcome) throw new Error('DOM credential plan returned no outcome')
  return {
    kind: outcome.kind,
    rejection:
      outcome.kind === CredentialFillJourneyOutcomeKind.Rejected
        ? outcome.rejection
        : false,
  }
}

export function simulateDomAuthentication({
  fixture,
  credentials,
}: DomAuthenticationSimulationRequest): DomAuthenticationSimulationResult {
  renderFixture(fixture)
  let submittedControlIdentity = ''
  for (const form of document.querySelectorAll<HTMLFormElement>('form')) {
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      submittedControlIdentity = submissionControlIdentity(event)
    })
  }

  const workflowForms =
    passwordFormInteraction.summarizeAuthenticationWorkflowForms()
  const classifiedRequest: ConstructorParameters<
    typeof AuthenticationWorkflowClassification
  >[0] = {
    workflowForms,
    authenticatorSetupHint: false,
    backupCodesHint: false,
  }
  const classified = new AuthenticationWorkflowClassification(classifiedRequest)
    .observations
  const matchRequest: Parameters<
    typeof classify_companion_authentication_workflow_facts
  >[0] = {
    observations: classified.map((candidate) => candidate.facts),
  }
  const match = classify_companion_authentication_workflow_facts(matchRequest)
  const matchKind = companion_authentication_workflow_match_kind(match)
  const matched =
    matchKind === CompanionAuthenticationWorkflowMatchKind.Matched &&
    'snapshot' in match
  const workflowKind = matched ? match.snapshot.kind : false
  const workflowAction = matched ? match.snapshot.action : false
  const selected = matched
    ? ((value) => (value ? value : false))(
        classified[match.snapshot.observationIndex],
      )
    : false
  const selectedRoot = selected ? selected.observation.root : false
  const implicitSubmissionMethod = selected
    ? selected.facts.ceremony.implicitSubmissionMethod
    : 'absent'
  const advanceControl = selected
    ? selected.facts.ceremony.advanceControl
    : 'absent'
  const credentialSubmissionKind = selected
    ? selected.facts.credentialSubmission.kind
    : 'absent'
  const detailedAdvanceControl = selected
    ? selected.facts.detailedAdvanceControl
    : false
  const detailedAdvanceControlKind = detailedAdvanceControl
    ? detailedAdvanceControl.kind
    : 'absent'
  const detailedAdvanceControlSupportsLogin =
    detailedAdvanceControl && detailedAdvanceControl.kind === 'observed'
      ? detailedAdvanceControl.observations.some(
          authentication_advance_control_is_safe,
        )
      : false
  if (!selected) {
    return {
      kind: DomAuthenticationSimulationOutcomeKind.FailClosed,
      observationCount: workflowForms.length,
      observedRoots: workflowForms.map((workflowForm) => workflowForm.root),
      matchKind,
      selectedRoot,
      workflowKind,
      workflowAction,
      credentialFillOutcome: false,
      credentialFillRejection: false,
      implicitSubmissionMethod,
      advanceControl,
      detailedAdvanceControlKind,
      credentialSubmissionKind,
      filled: false,
      submissionResult: FormSubmissionResult.NotObserved,
      submittedControlIdentity,
    }
  }

  const fillRequest: Parameters<
    typeof passwordFormInteraction.fillLoginCredentials
  >[0] = {
    kind: PasswordFormQueryKind.Scoped,
    ...selected.observation,
    credentials,
  }
  const planningRequest: DomCredentialPlanningRequest = {
    observation: fillRequest,
    credentials,
  }
  const credentialFill = planDomCredentialFill(planningRequest)
  const loginApproved =
    workflowKind === AuthenticationWorkflowKind.Login &&
    workflowAction === AuthenticationWorkflowAction.ContinueWithNook &&
    credentialFill.kind === CredentialFillJourneyOutcomeKind.Completed &&
    (advanceControl === 'implicit-submission'
      ? credentialSubmissionKind === 'observed'
      : credentialSubmissionKind === 'observed' ||
        detailedAdvanceControlSupportsLogin)
  if (!loginApproved) {
    return {
      kind: DomAuthenticationSimulationOutcomeKind.FailClosed,
      observationCount: workflowForms.length,
      observedRoots: workflowForms.map((workflowForm) => workflowForm.root),
      matchKind,
      selectedRoot,
      workflowKind,
      workflowAction,
      credentialFillOutcome: credentialFill.kind,
      credentialFillRejection: credentialFill.rejection,
      implicitSubmissionMethod,
      advanceControl,
      detailedAdvanceControlKind,
      credentialSubmissionKind,
      filled: false,
      submissionResult: FormSubmissionResult.NotObserved,
      submittedControlIdentity,
    }
  }
  const filled = passwordFormInteraction.fillLoginCredentials(fillRequest)
  const approvalIsActive = (): boolean => {
    const approvalRequest: ConstructorParameters<
      typeof LiveApprovedAuthenticationWorkflow
    >[0] = {
      approved: selected,
      authenticatorSetupHint: false,
      backupCodesHint: false,
    }
    return (
      new LiveApprovedAuthenticationWorkflow(approvalRequest).disposition ===
      LiveAuthenticationWorkflowDisposition.Current
    )
  }
  const approvedFill = filled && approvalIsActive()
  if (filled && !approvedFill)
    passwordFormCredentialInteraction.clearLoginCredentials(fillRequest)
  const submissionRequest: Parameters<
    typeof passwordFormInteraction.submitLoginForm
  >[0] = {
    kind: PasswordFormQueryKind.Scoped,
    ...selected.observation,
    submissionApproval: {
      isApproved: approvalIsActive,
      reject: () =>
        passwordFormCredentialInteraction.clearLoginCredentials(fillRequest),
    },
  }
  const submissionResult = approvedFill
    ? passwordFormInteraction.submitLoginForm(submissionRequest)
    : FormSubmissionResult.NotObserved
  return {
    kind: DomAuthenticationSimulationOutcomeKind.Login,
    observationCount: workflowForms.length,
    observedRoots: workflowForms.map((workflowForm) => workflowForm.root),
    matchKind,
    selectedRoot,
    workflowKind,
    workflowAction,
    credentialFillOutcome: credentialFill.kind,
    credentialFillRejection: credentialFill.rejection,
    implicitSubmissionMethod,
    advanceControl,
    detailedAdvanceControlKind,
    credentialSubmissionKind,
    filled: approvedFill && submissionResult !== FormSubmissionResult.Rejected,
    submissionResult,
    submittedControlIdentity,
  }
}
