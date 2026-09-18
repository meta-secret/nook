import { companionWasmReady } from '../../nook-web-shared/src/extension/companion-ready'
import { beforeAll, describe, expect, test } from 'bun:test'
import type {
  AuthenticationObservationBindingToken,
  AuthenticationPasskeyControlObservation,
} from '../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  AuthenticationWorkflowApproval as AuthenticationWorkflowApprovalSchema,
  AuthenticationWorkflowApprovalDisposition,
  AuthenticationWorkflowSnapshotIngress as AuthenticationWorkflowSnapshotMessageSchema,
} from '../src/lib/auth-workflow-messages'

beforeAll(async () => {
  await companionWasmReady
})

const passkeyControlPresent =
  'present' satisfies AuthenticationPasskeyControlObservation

const validMessage = {
  type: 'nook:authentication-workflow-snapshot',
  payload: {
    origin: 'https://login.example.com',
    observations: [
      {
        fields: {
          usernameFieldCount: 1,
          currentPasswordFieldCount: 1,
          newPasswordFieldCount: 0,
          genericPasswordFieldCount: 0,
          oneTimeCodeFieldCount: 0,
          actionablePasswordFieldCount: 1,
          readonlyPasswordFieldCount: 0,
        },
        ceremony: {
          oneTimeCodeProgression: 'advance-control-required',
          oneTimeCodeHandlerSignal: '',
          authenticationContext: {
            authenticationUsername: 'explicit',
            sourceOrigin: 'https://login.example.com',
            formIdentity: 'login',
            destinationIdentity: '/login',
          },
          manualCheckpoint: 'absent',
          advanceControl: 'absent',
        },
        authenticator: {
          authenticatorSetup: 'absent',
          backupCodesCopy: '',
          passkeyControl: 'absent',
          passkeyAccountAvailability: 'unavailable',
          matchingPasskeyAccountCount: 0,
          detailedPasskeyControl: { kind: 'absent' },
        },
        credentialSubmission: { kind: 'absent' },
        detailedAdvanceControl: { kind: 'absent' },
      },
    ],
  },
}
const [validObservation] = validMessage.payload.observations
if (!validObservation) {
  throw new Error('authentication workflow fixture requires an observation')
}

function admittedMessage() {
  const admission =
    AuthenticationWorkflowSnapshotMessageSchema.admit(validMessage)
  if (admission.kind !== 'accepted') {
    throw new Error('authentication workflow fixture must be admitted')
  }
  return admission.message
}

function admittedObservation() {
  const [observation] = admittedMessage().payload.observations
  if (!observation) {
    throw new Error('admitted authentication workflow requires an observation')
  }
  return observation
}

function approvalMatcherDependencies(): NonNullable<
  Parameters<
    typeof AuthenticationWorkflowApprovalSchema.compare
  >[0]['matcherDependencies']
> {
  type MatcherDependencies = NonNullable<
    Parameters<
      typeof AuthenticationWorkflowApprovalSchema.compare
    >[0]['matcherDependencies']
  >
  type ApprovedFacts = Parameters<
    MatcherDependencies['bind_authentication_page_observation_facts']
  >[0]
  type FactsBinding = Parameters<
    MatcherDependencies['authentication_page_observation_facts_match_binding']
  >[0]
  let approvedFactsJson = ''
  return {
    bind_authentication_page_observation_facts: (
      approvedFacts: ApprovedFacts,
    ) => {
      approvedFactsJson = JSON.stringify(approvedFacts)
      return '' satisfies AuthenticationObservationBindingToken
    },
    authentication_page_observation_facts_match_binding: (
      _binding: FactsBinding,
      currentFacts: ApprovedFacts,
    ) => approvedFactsJson === JSON.stringify(currentFacts),
  }
}

describe('authentication workflow snapshot messages', () => {
  test('invalidates pending approval after an action or fact transition', () => {
    const facts = admittedObservation()
    if (!facts.fields) throw new Error('approved fixture requires field facts')
    const approved = { workflowKey: 'login:continue', facts }
    const dependencies = approvalMatcherDependencies()
    expect(
      AuthenticationWorkflowApprovalSchema.compare({
        approved,
        current: { workflowKey: 'login:continue', facts },
        matcherDependencies: dependencies,
      }),
    ).toBe(AuthenticationWorkflowApprovalDisposition.Current)
    expect(
      AuthenticationWorkflowApprovalSchema.compare({
        approved,
        current: { workflowKey: 'otp:fill', facts },
        matcherDependencies: dependencies,
      }),
    ).toBe(AuthenticationWorkflowApprovalDisposition.Changed)
    expect(
      AuthenticationWorkflowApprovalSchema.compare({
        approved,
        current: {
          workflowKey: 'login:continue',
          facts: {
            ...facts,
            fields: { ...facts.fields, oneTimeCodeFieldCount: 1 },
          },
        },
        matcherDependencies: dependencies,
      }),
    ).toBe(AuthenticationWorkflowApprovalDisposition.Changed)
  })

  test('invalidates an authenticator picker across OTP challenge facts', () => {
    const approvedFacts = admittedObservation()
    if (!approvedFacts.ceremony)
      throw new Error('approved fixture requires ceremony facts')
    const dependencies = approvalMatcherDependencies()
    expect(
      AuthenticationWorkflowApprovalSchema.compare({
        approved: { workflowKey: 'login:otp', facts: approvedFacts },
        current: {
          workflowKey: 'login:otp',
          facts: {
            ...approvedFacts,
            ceremony: {
              ...approvedFacts.ceremony,
              oneTimeCodeHandlerSignal: 'onchange=submitNewChallenge()',
            },
          },
        },
        matcherDependencies: dependencies,
      }),
    ).toBe(AuthenticationWorkflowApprovalDisposition.Changed)
  })

  test('accepts bounded structural page observations', () => {
    expect(
      AuthenticationWorkflowSnapshotMessageSchema.admit(validMessage).kind,
    ).toBe('accepted')
  })

  test('accepts WebAuthn email evidence from the generated WASM contract', () => {
    const observation = validObservation
    expect(
      AuthenticationWorkflowSnapshotMessageSchema.admit({
        ...validMessage,
        payload: {
          ...validMessage.payload,
          observations: [
            {
              ...observation,
              ceremony: {
                ...observation.ceremony,
                authenticationContext: {
                  ...observation.ceremony.authenticationContext,
                  authenticationUsername: 'web-authn-email',
                },
              },
              detailedAdvanceControl: {
                kind: 'observed',
                observations: [
                  {
                    actionability: 'actionable',
                    ownership: 'owned-form',
                    semantics: 'semantic-submit',
                    authenticationUsername: 'web-authn-email',
                    passwordFieldCount: 0,
                    newPasswordFieldCount: 0,
                    oneTimeCodeFieldCount: 0,
                    semanticSubmitControlCount: 1,
                    sourceOrigin: 'https://auth.tesla.com',
                    formIdentity: '',
                    destinationIdentity:
                      'https://auth.tesla.com/oauth2/v1/authorize',
                    label: 'Next',
                    submissionMethod: 'get',
                    submissionDestinationSource: 'omitted',
                  },
                ],
              },
            },
          ],
        },
      }).kind,
    ).toBe('accepted')
  })

  test('accepts mixed phone-or-email evidence without admitting unknown evidence', () => {
    const observation = validObservation
    const control = {
      actionability: 'actionable',
      ownership: 'owned-form',
      semantics: 'semantic-submit',
      authenticationUsername: 'mixed-phone-or-email',
      passwordFieldCount: 0,
      newPasswordFieldCount: 0,
      oneTimeCodeFieldCount: 0,
      semanticSubmitControlCount: 1,
      sourceOrigin: 'https://www.airbnb.com',
      formIdentity: '',
      destinationIdentity: 'https://www.airbnb.com/login',
      label: 'Continue',
      submissionMethod: 'get',
      submissionDestinationSource: 'omitted',
    }
    const messageWithEvidence = (authenticationUsername: string) => ({
      ...validMessage,
      payload: {
        ...validMessage.payload,
        observations: [
          {
            ...observation,
            ceremony: {
              ...observation.ceremony,
              authenticationContext: {
                ...observation.ceremony.authenticationContext,
                authenticationUsername,
              },
            },
            detailedAdvanceControl: {
              kind: 'observed',
              observations: [{ ...control, authenticationUsername }],
            },
          },
        ],
      },
    })

    expect(
      AuthenticationWorkflowSnapshotMessageSchema.admit(
        messageWithEvidence('mixed-phone-or-email'),
      ).kind,
    ).toBe('accepted')
    expect(
      AuthenticationWorkflowSnapshotMessageSchema.admit(
        messageWithEvidence('mixed-contact-channel'),
      ).kind,
    ).toBe('rejected')
  })

  test('rejects invalid or oversized recovery copy', () => {
    const observation = validObservation
    for (const backupCodesCopy of [42, 'x'.repeat(513)]) {
      expect(
        AuthenticationWorkflowSnapshotMessageSchema.admit({
          ...validMessage,
          payload: {
            ...validMessage.payload,
            observations: [
              {
                ...observation,
                authenticator: {
                  ...observation.authenticator,
                  backupCodesCopy,
                },
              },
            ],
          },
        }).kind,
      ).toBe('rejected')
    }
  })

  test('accepts the generated passkey presence representation', () => {
    expect(
      AuthenticationWorkflowSnapshotMessageSchema.admit({
        ...validMessage,
        payload: {
          ...validMessage.payload,
          observations: [
            {
              ...validObservation,
              authenticator: {
                ...validObservation.authenticator,
                passkeyControl: passkeyControlPresent,
              },
            },
          ],
        },
      }).kind,
    ).toBe('accepted')
  })

  test('accepts bounded passkey and OTP candidate facts', () => {
    const observation = validObservation
    expect(
      AuthenticationWorkflowSnapshotMessageSchema.admit({
        ...validMessage,
        payload: {
          ...validMessage.payload,
          observations: [
            {
              ...observation,
              ceremony: {
                ...observation.ceremony,
                oneTimeCodeHandlerSignals: [
                  'oninput=this.form.requestSubmit()',
                ],
                advanceControl: 'implicit-submission',
              },
              authenticator: {
                ...observation.authenticator,
                detailedPasskeyControl: {
                  kind: 'candidates',
                  observation: [
                    {
                      kind: 'labeled',
                      observation: {
                        actionability: 'actionable',
                        ownership: 'owned-form',
                        semantics: 'activation',
                        authenticationUsername: 'explicit',
                        passwordFieldCount: 1,
                        newPasswordFieldCount: 0,
                        oneTimeCodeFieldCount: 0,
                        semanticSubmitControlCount: 0,
                        sourceOrigin: 'https://login.example.com',
                        formIdentity: 'login',
                        destinationIdentity: 'https://login.example.com/login',
                        label: 'Use passkey',
                        submissionDestinationSource: 'omitted',
                      },
                    },
                  ],
                },
              },
            },
          ],
        },
      }).kind,
    ).toBe('accepted')
  })

  test('rejects missing, negative, and fractional counts structurally', () => {
    const observationWithoutOneTimeCodeCount = {
      ...validObservation,
      fields: { ...validObservation.fields },
    }
    expect(
      Reflect.deleteProperty(
        observationWithoutOneTimeCodeCount.fields,
        'oneTimeCodeFieldCount',
      ),
    ).toBe(true)
    expect(
      AuthenticationWorkflowSnapshotMessageSchema.admit({
        ...validMessage,
        payload: {
          ...validMessage.payload,
          observations: [observationWithoutOneTimeCodeCount],
        },
      }).kind,
    ).toBe('rejected')

    for (const invalidCount of [-1, 0.5]) {
      expect(
        AuthenticationWorkflowSnapshotMessageSchema.admit({
          ...validMessage,
          payload: {
            ...validMessage.payload,
            observations: [
              {
                ...validObservation,
                fields: {
                  ...validObservation.fields,
                  oneTimeCodeFieldCount: invalidCount,
                },
              },
            ],
          },
        }).kind,
      ).toBe('rejected')
    }
  })

  test('leaves portable upper bounds to the Rust workflow policy', () => {
    expect(
      AuthenticationWorkflowSnapshotMessageSchema.admit({
        ...validMessage,
        payload: {
          ...validMessage.payload,
          observations: [
            {
              ...validObservation,
              fields: {
                ...validObservation.fields,
                oneTimeCodeFieldCount: 101,
              },
            },
          ],
        },
      }).kind,
    ).toBe('rejected')
    expect(
      AuthenticationWorkflowSnapshotMessageSchema.admit({
        ...validMessage,
        payload: {
          ...validMessage.payload,
          observations: [
            {
              ...validObservation,
              authenticator: {
                ...validObservation.authenticator,
                passkeyAccountAvailability: 'ready',
                matchingPasskeyAccountCount: 101,
              },
            },
          ],
        },
      }).kind,
    ).toBe('rejected')
    expect(
      AuthenticationWorkflowSnapshotMessageSchema.admit({
        ...validMessage,
        payload: {
          ...validMessage.payload,
          observations: Array.from({ length: 21 }, () => validObservation),
        },
      }).kind,
    ).toBe('accepted')
  })

  test('rejects empty observation batches structurally', () => {
    expect(
      AuthenticationWorkflowSnapshotMessageSchema.admit({
        ...validMessage,
        payload: { ...validMessage.payload, observations: [] },
      }).kind,
    ).toBe('rejected')
  })

  test('accepts a typed control batch and rejects the obsolete singular shape', () => {
    const control = {
      actionability: 'actionable',
      ownership: 'owned-form',
      semantics: 'semantic-submit',
      authenticationUsername: 'explicit',
      passwordFieldCount: 1,
      newPasswordFieldCount: 0,
      oneTimeCodeFieldCount: 0,
      semanticSubmitControlCount: 2,
      sourceOrigin: 'https://login.example.com',
      formIdentity: 'login',
      destinationIdentity: '/login',
      submissionDestinationSource: 'authored',
      label: 'Sign in',
    }
    expect(
      AuthenticationWorkflowSnapshotMessageSchema.admit({
        ...validMessage,
        payload: {
          ...validMessage.payload,
          observations: [
            {
              ...validObservation,
              detailedAdvanceControl: {
                kind: 'observed',
                observations: [control],
              },
            },
          ],
        },
      }).kind,
    ).toBe('accepted')
    expect(
      AuthenticationWorkflowSnapshotMessageSchema.admit({
        ...validMessage,
        payload: {
          ...validMessage.payload,
          observations: [
            {
              ...validObservation,
              detailedAdvanceControl: {
                kind: 'observed',
                observations: [
                  { ...control, submissionDestinationSource: 'inferred' },
                ],
              },
            },
          ],
        },
      }).kind,
    ).toBe('rejected')
    const missingDestinationSource = { ...control }
    Reflect.deleteProperty(
      missingDestinationSource,
      'submissionDestinationSource',
    )
    expect(
      AuthenticationWorkflowSnapshotMessageSchema.admit({
        ...validMessage,
        payload: {
          ...validMessage.payload,
          observations: [
            {
              ...validObservation,
              detailedAdvanceControl: {
                kind: 'observed',
                observations: [missingDestinationSource],
              },
            },
          ],
        },
      }).kind,
    ).toBe('rejected')
    expect(
      AuthenticationWorkflowSnapshotMessageSchema.admit({
        ...validMessage,
        payload: {
          ...validMessage.payload,
          observations: [
            {
              ...validObservation,
              detailedAdvanceControl: {
                kind: 'observed',
                observation: control,
              },
            },
          ],
        },
      }).kind,
    ).toBe('rejected')
  })
})
