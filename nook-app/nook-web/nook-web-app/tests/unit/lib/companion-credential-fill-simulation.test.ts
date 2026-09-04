import { describe, expect, test } from 'vitest'

import { CredentialFillRejection } from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  CredentialFillJourneyOutcomeKind,
  SimulatedCredentialFieldEditability,
  SimulatedCredentialFieldIdentity,
  SimulatedCredentialFieldKind,
  SimulatedCredentialFieldRole,
  SimulatedLoginJourneyValidationError,
  SimulatedLoginJourneyValidationFailure,
  simulateLoginJourney,
  type CredentialFillJourneyOutcome,
  type CredentialFillJourneyRequest,
  type FakeLoginCredentials,
  type SimulatedCredentialFieldDefinitions,
  type SimulatedCredentialFormSnapshot,
} from './companion-credential-fill-simulation'

const FAKE_CREDENTIALS: FakeLoginCredentials = {
  username: 'zero-vault-user@example.test',
  password: 'fake-login-password',
}

const USERNAME = new SimulatedCredentialFieldIdentity('username')
const PASSWORD = new SimulatedCredentialFieldIdentity('password')
const SECOND_PASSWORD = new SimulatedCredentialFieldIdentity('second-password')
const SECOND_USERNAME = new SimulatedCredentialFieldIdentity('second-username')
const UNRELATED = new SimulatedCredentialFieldIdentity('unrelated')
const UNSAFE = new SimulatedCredentialFieldIdentity('unsafe')
const ONE_TIME_CODE = new SimulatedCredentialFieldIdentity('one-time-code')
const UNOBSERVED = new SimulatedCredentialFieldIdentity('unobserved')

const USERNAME_FILLED_SNAPSHOT: SimulatedCredentialFormSnapshot = [
  { name: 'username', value: FAKE_CREDENTIALS.username },
  { name: 'password', value: '' },
]
const LOGIN_FILLED_SNAPSHOT: SimulatedCredentialFormSnapshot = [
  { name: 'username', value: FAKE_CREDENTIALS.username },
  { name: 'password', value: FAKE_CREDENTIALS.password },
]

type LoginJourneyScenario = {
  readonly name: string
  readonly journey: CredentialFillJourneyRequest
  readonly expected: CredentialFillJourneyOutcome[]
}

const LOGIN_JOURNEY_SCENARIOS: LoginJourneyScenario[] = [
  {
    name: 'fills a combined username and generic-password form',
    journey: {
      credentials: FAKE_CREDENTIALS,
      fields: [
        {
          kind: SimulatedCredentialFieldKind.Credential,
          field_identity: USERNAME,
          name: 'username',
          role: SimulatedCredentialFieldRole.Username,
          editability: SimulatedCredentialFieldEditability.Writable,
          value: '',
        },
        {
          kind: SimulatedCredentialFieldKind.Credential,
          field_identity: PASSWORD,
          name: 'password',
          role: SimulatedCredentialFieldRole.GenericPassword,
          editability: SimulatedCredentialFieldEditability.Writable,
          value: '',
        },
      ],
      steps: [{ observed_field_identities: [USERNAME, PASSWORD] }],
    },
    expected: [
      {
        kind: CredentialFillJourneyOutcomeKind.Filled,
        snapshot: LOGIN_FILLED_SNAPSHOT,
      },
    ],
  },
  {
    name: 'fills username then password across sequential steps',
    journey: {
      credentials: FAKE_CREDENTIALS,
      fields: [
        {
          kind: SimulatedCredentialFieldKind.Credential,
          field_identity: USERNAME,
          name: 'username',
          role: SimulatedCredentialFieldRole.Username,
          editability: SimulatedCredentialFieldEditability.Writable,
          value: '',
        },
        {
          kind: SimulatedCredentialFieldKind.Credential,
          field_identity: PASSWORD,
          name: 'password',
          role: SimulatedCredentialFieldRole.CurrentPassword,
          editability: SimulatedCredentialFieldEditability.Writable,
          value: '',
        },
      ],
      steps: [
        { observed_field_identities: [USERNAME] },
        { observed_field_identities: [PASSWORD] },
      ],
    },
    expected: [
      {
        kind: CredentialFillJourneyOutcomeKind.Filled,
        snapshot: USERNAME_FILLED_SNAPSHOT,
      },
      {
        kind: CredentialFillJourneyOutcomeKind.Filled,
        snapshot: LOGIN_FILLED_SNAPSHOT,
      },
    ],
  },
  {
    name: 'rejects readonly password planning without mutation',
    journey: {
      credentials: FAKE_CREDENTIALS,
      fields: [
        {
          kind: SimulatedCredentialFieldKind.Credential,
          field_identity: PASSWORD,
          name: 'password',
          role: SimulatedCredentialFieldRole.CurrentPassword,
          editability: SimulatedCredentialFieldEditability.Readonly,
          value: 'readonly-value',
        },
      ],
      steps: [{ observed_field_identities: [PASSWORD] }],
    },
    expected: [
      {
        kind: CredentialFillJourneyOutcomeKind.Rejected,
        rejection: CredentialFillRejection.PasswordFieldsReadonly,
        snapshot: [{ name: 'password', value: 'readonly-value' }],
      },
    ],
  },
  {
    name: 'leaves fields outside the observed step untouched',
    journey: {
      credentials: FAKE_CREDENTIALS,
      fields: [
        {
          kind: SimulatedCredentialFieldKind.Credential,
          field_identity: USERNAME,
          name: 'username',
          role: SimulatedCredentialFieldRole.Username,
          editability: SimulatedCredentialFieldEditability.Writable,
          value: '',
        },
        {
          kind: SimulatedCredentialFieldKind.Credential,
          field_identity: UNRELATED,
          name: 'unrelated-password',
          role: SimulatedCredentialFieldRole.CurrentPassword,
          editability: SimulatedCredentialFieldEditability.Writable,
          value: 'leave-this-value-untouched',
        },
      ],
      steps: [{ observed_field_identities: [USERNAME] }],
    },
    expected: [
      {
        kind: CredentialFillJourneyOutcomeKind.Filled,
        snapshot: [
          { name: 'username', value: FAKE_CREDENTIALS.username },
          {
            name: 'unrelated-password',
            value: 'leave-this-value-untouched',
          },
        ],
      },
    ],
  },
  {
    name: 'rejects duplicate field indices without mutation',
    journey: {
      credentials: FAKE_CREDENTIALS,
      fields: [
        {
          kind: SimulatedCredentialFieldKind.Credential,
          field_identity: USERNAME,
          name: 'username',
          role: SimulatedCredentialFieldRole.Username,
          editability: SimulatedCredentialFieldEditability.Writable,
          value: 'original-username',
        },
        {
          kind: SimulatedCredentialFieldKind.Credential,
          field_identity: PASSWORD,
          name: 'password',
          role: SimulatedCredentialFieldRole.CurrentPassword,
          editability: SimulatedCredentialFieldEditability.Writable,
          value: 'original-password',
        },
      ],
      steps: [{ observed_field_identities: [USERNAME, USERNAME, PASSWORD] }],
    },
    expected: [
      {
        kind: CredentialFillJourneyOutcomeKind.Rejected,
        rejection: CredentialFillRejection.DuplicateFieldIndex,
        snapshot: [
          { name: 'username', value: 'original-username' },
          { name: 'password', value: 'original-password' },
        ],
      },
    ],
  },
  {
    name: 'stops before a later username step after new-password rejection',
    journey: {
      credentials: FAKE_CREDENTIALS,
      fields: [
        {
          kind: SimulatedCredentialFieldKind.NewPassword,
          field_identity: UNSAFE,
          name: 'new-password',
          value: 'new-password-value',
        },
        {
          kind: SimulatedCredentialFieldKind.Credential,
          field_identity: USERNAME,
          name: 'later-username',
          role: SimulatedCredentialFieldRole.Username,
          editability: SimulatedCredentialFieldEditability.Writable,
          value: 'original-later-username',
        },
      ],
      steps: [
        { observed_field_identities: [UNSAFE] },
        { observed_field_identities: [USERNAME] },
      ],
    },
    expected: [
      {
        kind: CredentialFillJourneyOutcomeKind.Rejected,
        rejection: CredentialFillRejection.NewPasswordFieldPresent,
        snapshot: [
          { name: 'new-password', value: 'new-password-value' },
          { name: 'later-username', value: 'original-later-username' },
        ],
      },
    ],
  },
  {
    name: 'rejects one-time-code observations without mutation',
    journey: {
      credentials: FAKE_CREDENTIALS,
      fields: [
        {
          kind: SimulatedCredentialFieldKind.OneTimeCode,
          field_identity: ONE_TIME_CODE,
          name: 'one-time-code',
          value: '123456',
        },
      ],
      steps: [{ observed_field_identities: [ONE_TIME_CODE] }],
    },
    expected: [
      {
        kind: CredentialFillJourneyOutcomeKind.Rejected,
        rejection: CredentialFillRejection.OneTimeCodeFieldPresent,
        snapshot: [{ name: 'one-time-code', value: '123456' }],
      },
    ],
  },
  {
    name: 'rejects an empty observed step without mutating the form',
    journey: {
      credentials: FAKE_CREDENTIALS,
      fields: [
        {
          kind: SimulatedCredentialFieldKind.Credential,
          field_identity: UNOBSERVED,
          name: 'unobserved-username',
          role: SimulatedCredentialFieldRole.Username,
          editability: SimulatedCredentialFieldEditability.Writable,
          value: 'preserved-username',
        },
      ],
      steps: [{ observed_field_identities: [] }],
    },
    expected: [
      {
        kind: CredentialFillJourneyOutcomeKind.Rejected,
        rejection: CredentialFillRejection.NoCredentialField,
        snapshot: [
          { name: 'unobserved-username', value: 'preserved-username' },
        ],
      },
    ],
  },
  {
    name: 'rejects ambiguous password fields without mutation',
    journey: {
      credentials: FAKE_CREDENTIALS,
      fields: [
        {
          kind: SimulatedCredentialFieldKind.Credential,
          field_identity: PASSWORD,
          name: 'current-password',
          role: SimulatedCredentialFieldRole.CurrentPassword,
          editability: SimulatedCredentialFieldEditability.Writable,
          value: 'current-value',
        },
        {
          kind: SimulatedCredentialFieldKind.Credential,
          field_identity: SECOND_PASSWORD,
          name: 'generic-password',
          role: SimulatedCredentialFieldRole.GenericPassword,
          editability: SimulatedCredentialFieldEditability.Writable,
          value: 'generic-value',
        },
      ],
      steps: [{ observed_field_identities: [PASSWORD, SECOND_PASSWORD] }],
    },
    expected: [
      {
        kind: CredentialFillJourneyOutcomeKind.Rejected,
        rejection: CredentialFillRejection.AmbiguousPasswordField,
        snapshot: [
          { name: 'current-password', value: 'current-value' },
          { name: 'generic-password', value: 'generic-value' },
        ],
      },
    ],
  },
  {
    name: 'rejects ambiguous username fields without mutation',
    journey: {
      credentials: FAKE_CREDENTIALS,
      fields: [
        {
          kind: SimulatedCredentialFieldKind.Credential,
          field_identity: USERNAME,
          name: 'first-username',
          role: SimulatedCredentialFieldRole.Username,
          editability: SimulatedCredentialFieldEditability.Writable,
          value: 'first-value',
        },
        {
          kind: SimulatedCredentialFieldKind.Credential,
          field_identity: SECOND_USERNAME,
          name: 'second-username',
          role: SimulatedCredentialFieldRole.Username,
          editability: SimulatedCredentialFieldEditability.Writable,
          value: 'second-value',
        },
      ],
      steps: [{ observed_field_identities: [USERNAME, SECOND_USERNAME] }],
    },
    expected: [
      {
        kind: CredentialFillJourneyOutcomeKind.Rejected,
        rejection: CredentialFillRejection.AmbiguousUsernameField,
        snapshot: [
          { name: 'first-username', value: 'first-value' },
          { name: 'second-username', value: 'second-value' },
        ],
      },
    ],
  },
]

type InvalidLoginJourneyScenario = {
  readonly name: string
  readonly journey: CredentialFillJourneyRequest
  readonly expectedFailure: SimulatedLoginJourneyValidationFailure
  readonly expectedSnapshot: SimulatedCredentialFormSnapshot
}

const DUPLICATE = new SimulatedCredentialFieldIdentity('duplicate')
const UNKNOWN = new SimulatedCredentialFieldIdentity('unknown')

const INVALID_LOGIN_JOURNEYS: InvalidLoginJourneyScenario[] = [
  {
    name: 'rejects duplicate owned field identities before materialization',
    journey: {
      credentials: FAKE_CREDENTIALS,
      fields: [
        {
          kind: SimulatedCredentialFieldKind.Credential,
          field_identity: DUPLICATE,
          name: 'first-duplicate',
          role: SimulatedCredentialFieldRole.Username,
          editability: SimulatedCredentialFieldEditability.Writable,
          value: 'first-original',
        },
        {
          kind: SimulatedCredentialFieldKind.Credential,
          field_identity: new SimulatedCredentialFieldIdentity('duplicate'),
          name: 'second-duplicate',
          role: SimulatedCredentialFieldRole.CurrentPassword,
          editability: SimulatedCredentialFieldEditability.Writable,
          value: 'second-original',
        },
      ],
      steps: [{ observed_field_identities: [DUPLICATE] }],
    },
    expectedFailure:
      SimulatedLoginJourneyValidationFailure.DuplicateFieldIdentity,
    expectedSnapshot: [
      { name: 'first-duplicate', value: 'first-original' },
      { name: 'second-duplicate', value: 'second-original' },
    ],
  },
  {
    name: 'rejects unknown step field identities before materialization',
    journey: {
      credentials: FAKE_CREDENTIALS,
      fields: [
        {
          kind: SimulatedCredentialFieldKind.Credential,
          field_identity: USERNAME,
          name: 'known-username',
          role: SimulatedCredentialFieldRole.Username,
          editability: SimulatedCredentialFieldEditability.Writable,
          value: 'known-original',
        },
      ],
      steps: [{ observed_field_identities: [UNKNOWN] }],
    },
    expectedFailure:
      SimulatedLoginJourneyValidationFailure.UnknownStepFieldReference,
    expectedSnapshot: [{ name: 'known-username', value: 'known-original' }],
  },
]

function snapshotDefinitions(
  fields: SimulatedCredentialFieldDefinitions,
): SimulatedCredentialFormSnapshot {
  return fields.map((field) => ({ name: field.name, value: field.value }))
}

function captureValidationFailure(
  journey: CredentialFillJourneyRequest,
): SimulatedLoginJourneyValidationFailure {
  try {
    simulateLoginJourney(journey)
    throw new Error('expected simulated journey validation to fail')
  } catch (error) {
    if (!(error instanceof SimulatedLoginJourneyValidationError)) throw error
    return error.failure
  }
}

describe('deterministic zero-vault login journeys', () => {
  test.each(LOGIN_JOURNEY_SCENARIOS)('$name', (scenario) => {
    const journey = scenario.journey
    const firstResult = simulateLoginJourney(journey)
    const secondResult = simulateLoginJourney(journey)
    const expected = scenario.expected
    expect(firstResult).toEqual(expected)
    expect(secondResult).toEqual(expected)
  })

  test.each(INVALID_LOGIN_JOURNEYS)('$name', (scenario) => {
    const journey = scenario.journey
    const fields = journey.fields
    const before = snapshotDefinitions(fields)
    const failure = captureValidationFailure(journey)
    const after = snapshotDefinitions(fields)
    const expectedSnapshot = scenario.expectedSnapshot
    expect(failure).toBe(scenario.expectedFailure)
    expect(before).toEqual(expectedSnapshot)
    expect(after).toEqual(before)
  })
})
