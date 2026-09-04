import { describe, expect, test } from 'vitest'

import {
  CredentialFillEditability,
  CredentialFillFieldIndex,
  CredentialFillFieldRole,
  CredentialFillRejection,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  CredentialFillJourneyOutcomeKind,
  SimulatedCredentialField,
  SimulatedCredentialFieldKind,
  simulateLoginJourney,
  type CredentialFillJourneyOutcome,
  type CredentialFillJourneyRequest,
  type FakeLoginCredentials,
  type SimulatedCredentialFieldDefinition,
  type SimulatedCredentialForm,
  type SimulatedCredentialFormSnapshot,
} from './companion-credential-fill-simulation'

const FAKE_CREDENTIALS: FakeLoginCredentials = {
  username: 'zero-vault-user@example.test',
  password: 'fake-login-password',
}

const USERNAME_FILLED_SNAPSHOT: SimulatedCredentialFormSnapshot = [
  { name: 'username', value: FAKE_CREDENTIALS.username },
  { name: 'password', value: '' },
]
const LOGIN_FILLED_SNAPSHOT: SimulatedCredentialFormSnapshot = [
  { name: 'username', value: FAKE_CREDENTIALS.username },
  { name: 'password', value: FAKE_CREDENTIALS.password },
]

function createCombinedUsernamePasswordJourney(): CredentialFillJourneyRequest {
  const usernameDefinition: SimulatedCredentialFieldDefinition = {
    kind: SimulatedCredentialFieldKind.Credential,
    name: 'username',
    field_index: new CredentialFillFieldIndex(3),
    role: CredentialFillFieldRole.username(),
    editability: CredentialFillEditability.writable(),
    value: '',
  }
  const passwordDefinition: SimulatedCredentialFieldDefinition = {
    kind: SimulatedCredentialFieldKind.Credential,
    name: 'password',
    field_index: new CredentialFillFieldIndex(19),
    role: CredentialFillFieldRole.generic_password(),
    editability: CredentialFillEditability.writable(),
    value: '',
  }
  const username = new SimulatedCredentialField(usernameDefinition)
  const password = new SimulatedCredentialField(passwordDefinition)
  const form: SimulatedCredentialForm = [username, password]
  return {
    form,
    steps: [{ observedFields: form }],
    credentials: FAKE_CREDENTIALS,
  }
}

function createSequentialUsernamePasswordJourney(): CredentialFillJourneyRequest {
  const usernameDefinition: SimulatedCredentialFieldDefinition = {
    kind: SimulatedCredentialFieldKind.Credential,
    name: 'username',
    field_index: new CredentialFillFieldIndex(5),
    role: CredentialFillFieldRole.username(),
    editability: CredentialFillEditability.writable(),
    value: '',
  }
  const passwordDefinition: SimulatedCredentialFieldDefinition = {
    kind: SimulatedCredentialFieldKind.Credential,
    name: 'password',
    field_index: new CredentialFillFieldIndex(12),
    role: CredentialFillFieldRole.current_password(),
    editability: CredentialFillEditability.writable(),
    value: '',
  }
  const username = new SimulatedCredentialField(usernameDefinition)
  const password = new SimulatedCredentialField(passwordDefinition)
  const form: SimulatedCredentialForm = [username, password]
  return {
    form,
    steps: [{ observedFields: [username] }, { observedFields: [password] }],
    credentials: FAKE_CREDENTIALS,
  }
}

function createReadonlyPasswordJourney(): CredentialFillJourneyRequest {
  const passwordDefinition: SimulatedCredentialFieldDefinition = {
    kind: SimulatedCredentialFieldKind.Credential,
    name: 'password',
    field_index: new CredentialFillFieldIndex(8),
    role: CredentialFillFieldRole.current_password(),
    editability: CredentialFillEditability.readonly(),
    value: 'readonly-value',
  }
  const password = new SimulatedCredentialField(passwordDefinition)
  const form: SimulatedCredentialForm = [password]
  return {
    form,
    steps: [{ observedFields: form }],
    credentials: FAKE_CREDENTIALS,
  }
}

function createJourneyWithUnrelatedField(): CredentialFillJourneyRequest {
  const usernameDefinition: SimulatedCredentialFieldDefinition = {
    kind: SimulatedCredentialFieldKind.Credential,
    name: 'username',
    field_index: new CredentialFillFieldIndex(2),
    role: CredentialFillFieldRole.username(),
    editability: CredentialFillEditability.writable(),
    value: '',
  }
  const unrelatedDefinition: SimulatedCredentialFieldDefinition = {
    kind: SimulatedCredentialFieldKind.Credential,
    name: 'unrelated-password',
    field_index: new CredentialFillFieldIndex(41),
    role: CredentialFillFieldRole.current_password(),
    editability: CredentialFillEditability.writable(),
    value: 'leave-this-value-untouched',
  }
  const username = new SimulatedCredentialField(usernameDefinition)
  const unrelated = new SimulatedCredentialField(unrelatedDefinition)
  const form: SimulatedCredentialForm = [username, unrelated]
  return {
    form,
    steps: [{ observedFields: [username] }],
    credentials: FAKE_CREDENTIALS,
  }
}

function createDuplicateFieldIndexJourney(): CredentialFillJourneyRequest {
  const usernameDefinition: SimulatedCredentialFieldDefinition = {
    kind: SimulatedCredentialFieldKind.Credential,
    name: 'username',
    field_index: new CredentialFillFieldIndex(7),
    role: CredentialFillFieldRole.username(),
    editability: CredentialFillEditability.writable(),
    value: 'original-username',
  }
  const passwordDefinition: SimulatedCredentialFieldDefinition = {
    kind: SimulatedCredentialFieldKind.Credential,
    name: 'password',
    field_index: new CredentialFillFieldIndex(7),
    role: CredentialFillFieldRole.current_password(),
    editability: CredentialFillEditability.writable(),
    value: 'original-password',
  }
  const username = new SimulatedCredentialField(usernameDefinition)
  const password = new SimulatedCredentialField(passwordDefinition)
  const form: SimulatedCredentialForm = [username, password]
  return {
    form,
    steps: [{ observedFields: form }],
    credentials: FAKE_CREDENTIALS,
  }
}

function createNewPasswordJourney(): CredentialFillJourneyRequest {
  const definition: SimulatedCredentialFieldDefinition = {
    kind: SimulatedCredentialFieldKind.NewPassword,
    name: 'new-password',
    field_index: new CredentialFillFieldIndex(13),
    value: 'new-password-value',
  }
  const field = new SimulatedCredentialField(definition)
  const form: SimulatedCredentialForm = [field]
  return {
    form,
    steps: [{ observedFields: form }],
    credentials: FAKE_CREDENTIALS,
  }
}

function createOneTimeCodeJourney(): CredentialFillJourneyRequest {
  const definition: SimulatedCredentialFieldDefinition = {
    kind: SimulatedCredentialFieldKind.OneTimeCode,
    name: 'one-time-code',
    field_index: new CredentialFillFieldIndex(14),
    value: '123456',
  }
  const field = new SimulatedCredentialField(definition)
  const form: SimulatedCredentialForm = [field]
  return {
    form,
    steps: [{ observedFields: form }],
    credentials: FAKE_CREDENTIALS,
  }
}

function createNoCredentialFieldJourney(): CredentialFillJourneyRequest {
  const definition: SimulatedCredentialFieldDefinition = {
    kind: SimulatedCredentialFieldKind.Credential,
    name: 'unobserved-username',
    field_index: new CredentialFillFieldIndex(15),
    role: CredentialFillFieldRole.username(),
    editability: CredentialFillEditability.writable(),
    value: 'preserved-username',
  }
  const field = new SimulatedCredentialField(definition)
  const form: SimulatedCredentialForm = [field]
  return {
    form,
    steps: [{ observedFields: [] }],
    credentials: FAKE_CREDENTIALS,
  }
}

function createAmbiguousPasswordJourney(): CredentialFillJourneyRequest {
  const currentDefinition: SimulatedCredentialFieldDefinition = {
    kind: SimulatedCredentialFieldKind.Credential,
    name: 'current-password',
    field_index: new CredentialFillFieldIndex(16),
    role: CredentialFillFieldRole.current_password(),
    editability: CredentialFillEditability.writable(),
    value: 'current-value',
  }
  const genericDefinition: SimulatedCredentialFieldDefinition = {
    kind: SimulatedCredentialFieldKind.Credential,
    name: 'generic-password',
    field_index: new CredentialFillFieldIndex(17),
    role: CredentialFillFieldRole.generic_password(),
    editability: CredentialFillEditability.writable(),
    value: 'generic-value',
  }
  const current = new SimulatedCredentialField(currentDefinition)
  const generic = new SimulatedCredentialField(genericDefinition)
  const form: SimulatedCredentialForm = [current, generic]
  return {
    form,
    steps: [{ observedFields: form }],
    credentials: FAKE_CREDENTIALS,
  }
}

function createAmbiguousUsernameJourney(): CredentialFillJourneyRequest {
  const firstDefinition: SimulatedCredentialFieldDefinition = {
    kind: SimulatedCredentialFieldKind.Credential,
    name: 'first-username',
    field_index: new CredentialFillFieldIndex(18),
    role: CredentialFillFieldRole.username(),
    editability: CredentialFillEditability.writable(),
    value: 'first-value',
  }
  const secondDefinition: SimulatedCredentialFieldDefinition = {
    kind: SimulatedCredentialFieldKind.Credential,
    name: 'second-username',
    field_index: new CredentialFillFieldIndex(20),
    role: CredentialFillFieldRole.username(),
    editability: CredentialFillEditability.writable(),
    value: 'second-value',
  }
  const first = new SimulatedCredentialField(firstDefinition)
  const second = new SimulatedCredentialField(secondDefinition)
  const form: SimulatedCredentialForm = [first, second]
  return {
    form,
    steps: [{ observedFields: form }],
    credentials: FAKE_CREDENTIALS,
  }
}

type LoginJourneyScenario = {
  readonly name: string
  readonly createJourney: () => CredentialFillJourneyRequest
  readonly expected: CredentialFillJourneyOutcome[]
}

const LOGIN_JOURNEY_SCENARIOS: LoginJourneyScenario[] = [
  {
    name: 'fills a combined username and generic-password form',
    createJourney: createCombinedUsernamePasswordJourney,
    expected: [
      {
        kind: CredentialFillJourneyOutcomeKind.Filled,
        snapshot: LOGIN_FILLED_SNAPSHOT,
      },
    ],
  },
  {
    name: 'fills username then password across sequential steps',
    createJourney: createSequentialUsernamePasswordJourney,
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
    createJourney: createReadonlyPasswordJourney,
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
    createJourney: createJourneyWithUnrelatedField,
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
    createJourney: createDuplicateFieldIndexJourney,
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
    name: 'rejects new-password observations without mutation',
    createJourney: createNewPasswordJourney,
    expected: [
      {
        kind: CredentialFillJourneyOutcomeKind.Rejected,
        rejection: CredentialFillRejection.NewPasswordFieldPresent,
        snapshot: [{ name: 'new-password', value: 'new-password-value' }],
      },
    ],
  },
  {
    name: 'rejects one-time-code observations without mutation',
    createJourney: createOneTimeCodeJourney,
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
    createJourney: createNoCredentialFieldJourney,
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
    createJourney: createAmbiguousPasswordJourney,
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
    createJourney: createAmbiguousUsernameJourney,
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

describe('deterministic zero-vault login journeys', () => {
  test.each(LOGIN_JOURNEY_SCENARIOS)('$name', (scenario) => {
    const journey = scenario.createJourney()
    const result = simulateLoginJourney(journey)
    const expected = scenario.expected
    expect(result).toEqual(expected)
  })
})
