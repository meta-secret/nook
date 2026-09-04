import { describe, expect, test } from 'vitest'

import {
  CredentialFillEditability,
  CredentialFillFieldIndex,
  CredentialFillFieldRole,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  CredentialFillJourneyOutcomeKind,
  CredentialFillPlannerRejection,
  SimulatedCredentialField,
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
    name: 'username',
    field_index: new CredentialFillFieldIndex(3),
    role: CredentialFillFieldRole.username(),
    editability: CredentialFillEditability.writable(),
    value: '',
  }
  const passwordDefinition: SimulatedCredentialFieldDefinition = {
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
    name: 'username',
    field_index: new CredentialFillFieldIndex(5),
    role: CredentialFillFieldRole.username(),
    editability: CredentialFillEditability.writable(),
    value: '',
  }
  const passwordDefinition: SimulatedCredentialFieldDefinition = {
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
    name: 'password',
    field_index: new CredentialFillFieldIndex(8),
    role: CredentialFillFieldRole.current_password(),
    editability: CredentialFillEditability.readonly(),
    value: '',
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
    name: 'username',
    field_index: new CredentialFillFieldIndex(2),
    role: CredentialFillFieldRole.username(),
    editability: CredentialFillEditability.writable(),
    value: '',
  }
  const unrelatedDefinition: SimulatedCredentialFieldDefinition = {
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
    name: 'username',
    field_index: new CredentialFillFieldIndex(7),
    role: CredentialFillFieldRole.username(),
    editability: CredentialFillEditability.writable(),
    value: '',
  }
  const passwordDefinition: SimulatedCredentialFieldDefinition = {
    name: 'password',
    field_index: new CredentialFillFieldIndex(7),
    role: CredentialFillFieldRole.current_password(),
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

enum LoginJourneyScenarioKind {
  Completes = 'completes',
  Throws = 'throws',
}

type LoginJourneyScenarioBase = {
  readonly name: string
  readonly createJourney: () => CredentialFillJourneyRequest
}

type LoginJourneyScenario = LoginJourneyScenarioBase &
  (
    | {
        readonly kind: LoginJourneyScenarioKind.Completes
        readonly expected: CredentialFillJourneyOutcome[]
      }
    | {
        readonly kind: LoginJourneyScenarioKind.Throws
        readonly expectedMessage: string
      }
  )

const LOGIN_JOURNEY_SCENARIOS: LoginJourneyScenario[] = [
  {
    kind: LoginJourneyScenarioKind.Completes,
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
    kind: LoginJourneyScenarioKind.Completes,
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
    kind: LoginJourneyScenarioKind.Completes,
    name: 'rejects readonly password planning without mutation',
    createJourney: createReadonlyPasswordJourney,
    expected: [
      {
        kind: CredentialFillJourneyOutcomeKind.Rejected,
        message: CredentialFillPlannerRejection.PasswordFieldsReadonly,
        snapshot: [{ name: 'password', value: '' }],
      },
    ],
  },
  {
    kind: LoginJourneyScenarioKind.Completes,
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
    kind: LoginJourneyScenarioKind.Throws,
    name: 'propagates a non-modeled duplicate-index planner failure',
    createJourney: createDuplicateFieldIndexJourney,
    expectedMessage: 'the observed scope contains a duplicate field index',
  },
]

describe('deterministic zero-vault login journeys', () => {
  test.each(LOGIN_JOURNEY_SCENARIOS)('$name', (scenario) => {
    const journey = scenario.createJourney()
    switch (scenario.kind) {
      case LoginJourneyScenarioKind.Completes: {
        const result = simulateLoginJourney(journey)
        const expected = scenario.expected
        expect(result).toEqual(expected)
        break
      }
      case LoginJourneyScenarioKind.Throws: {
        const runJourney = (): CredentialFillJourneyOutcome[] =>
          simulateLoginJourney(journey)
        expect(runJourney).toThrow(scenario.expectedMessage)
        break
      }
    }
  })
})
