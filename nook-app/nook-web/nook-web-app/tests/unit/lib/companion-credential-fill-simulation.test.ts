import { describe, expect, test } from 'vitest'

import {
  CredentialFillEditability,
  CredentialFillFieldIndex,
  CredentialFillFieldRole,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  SimulatedCredentialField,
  SimulatedCredentialForm,
  simulateCredentialFill,
  type CredentialFillSimulationRequest,
  type FakeLoginCredentials,
  type SimulatedCredentialFieldDefinition,
  type SimulatedCredentialFields,
  type SimulatedCredentialFormDefinition,
} from './companion-credential-fill-simulation'

const FAKE_CREDENTIALS: FakeLoginCredentials = {
  username: 'zero-vault-user@example.test',
  password: 'fake-login-password',
}

function runCombinedUsernamePasswordScenario(): void {
  const usernameDefinition: SimulatedCredentialFieldDefinition = {
    field_index: new CredentialFillFieldIndex(3),
    role: CredentialFillFieldRole.username(),
    editability: CredentialFillEditability.writable(),
    value: '',
  }
  const passwordDefinition: SimulatedCredentialFieldDefinition = {
    field_index: new CredentialFillFieldIndex(19),
    role: CredentialFillFieldRole.generic_password(),
    editability: CredentialFillEditability.writable(),
    value: '',
  }
  const username = new SimulatedCredentialField(usernameDefinition)
  const password = new SimulatedCredentialField(passwordDefinition)
  const fields: SimulatedCredentialFields = [username, password]
  const formDefinition: SimulatedCredentialFormDefinition = { fields }
  const form = new SimulatedCredentialForm(formDefinition)
  const request: CredentialFillSimulationRequest = {
    observedFields: fields,
    form,
    credentials: FAKE_CREDENTIALS,
  }

  try {
    simulateCredentialFill(request)
    expect(username.value).toBe(FAKE_CREDENTIALS.username)
    expect(password.value).toBe(FAKE_CREDENTIALS.password)
  } finally {
    form.free()
  }
}

function runSequentialUsernamePasswordScenario(): void {
  const usernameDefinition: SimulatedCredentialFieldDefinition = {
    field_index: new CredentialFillFieldIndex(5),
    role: CredentialFillFieldRole.username(),
    editability: CredentialFillEditability.writable(),
    value: '',
  }
  const passwordDefinition: SimulatedCredentialFieldDefinition = {
    field_index: new CredentialFillFieldIndex(12),
    role: CredentialFillFieldRole.current_password(),
    editability: CredentialFillEditability.writable(),
    value: '',
  }
  const username = new SimulatedCredentialField(usernameDefinition)
  const password = new SimulatedCredentialField(passwordDefinition)
  const fields: SimulatedCredentialFields = [username, password]
  const formDefinition: SimulatedCredentialFormDefinition = { fields }
  const form = new SimulatedCredentialForm(formDefinition)
  const usernameRequest: CredentialFillSimulationRequest = {
    observedFields: [username],
    form,
    credentials: FAKE_CREDENTIALS,
  }
  const passwordRequest: CredentialFillSimulationRequest = {
    observedFields: [password],
    form,
    credentials: FAKE_CREDENTIALS,
  }

  try {
    simulateCredentialFill(usernameRequest)
    expect(username.value).toBe(FAKE_CREDENTIALS.username)
    expect(password.value).toBe('')

    simulateCredentialFill(passwordRequest)
    expect(username.value).toBe(FAKE_CREDENTIALS.username)
    expect(password.value).toBe(FAKE_CREDENTIALS.password)
  } finally {
    form.free()
  }
}

function runReadonlyFailureScenario(): void {
  const passwordDefinition: SimulatedCredentialFieldDefinition = {
    field_index: new CredentialFillFieldIndex(8),
    role: CredentialFillFieldRole.current_password(),
    editability: CredentialFillEditability.readonly(),
    value: '',
  }
  const password = new SimulatedCredentialField(passwordDefinition)
  const fields: SimulatedCredentialFields = [password]
  const formDefinition: SimulatedCredentialFormDefinition = { fields }
  const form = new SimulatedCredentialForm(formDefinition)
  const request: CredentialFillSimulationRequest = {
    observedFields: fields,
    form,
    credentials: FAKE_CREDENTIALS,
  }

  try {
    expect(() => simulateCredentialFill(request)).toThrow(
      'every password field is read-only, so credential disclosure is blocked',
    )
    expect(password.value).toBe('')
  } finally {
    form.free()
  }
}

function runUnrelatedFieldScenario(): void {
  const usernameDefinition: SimulatedCredentialFieldDefinition = {
    field_index: new CredentialFillFieldIndex(2),
    role: CredentialFillFieldRole.username(),
    editability: CredentialFillEditability.writable(),
    value: '',
  }
  const unrelatedDefinition: SimulatedCredentialFieldDefinition = {
    field_index: new CredentialFillFieldIndex(41),
    role: CredentialFillFieldRole.current_password(),
    editability: CredentialFillEditability.writable(),
    value: 'leave-this-value-untouched',
  }
  const username = new SimulatedCredentialField(usernameDefinition)
  const unrelated = new SimulatedCredentialField(unrelatedDefinition)
  const fields: SimulatedCredentialFields = [username, unrelated]
  const formDefinition: SimulatedCredentialFormDefinition = { fields }
  const form = new SimulatedCredentialForm(formDefinition)
  const observedFields: SimulatedCredentialFields = [username]
  const request: CredentialFillSimulationRequest = {
    observedFields,
    form,
    credentials: FAKE_CREDENTIALS,
  }

  try {
    simulateCredentialFill(request)
    expect(username.value).toBe(FAKE_CREDENTIALS.username)
    expect(unrelated.value).toBe('leave-this-value-untouched')
  } finally {
    form.free()
  }
}

type LoginJourneyScenario = {
  readonly name: string
  readonly run: () => void
}

type LoginJourneyScenarios = LoginJourneyScenario[]

const LOGIN_JOURNEY_SCENARIOS: LoginJourneyScenarios = [
  {
    name: 'fills a combined username and generic-password form',
    run: runCombinedUsernamePasswordScenario,
  },
  {
    name: 'fills username then password across sequential steps',
    run: runSequentialUsernamePasswordScenario,
  },
  {
    name: 'fails readonly password planning without mutation',
    run: runReadonlyFailureScenario,
  },
  {
    name: 'leaves fields outside the observed step untouched',
    run: runUnrelatedFieldScenario,
  },
]

describe('deterministic zero-vault login journeys', () => {
  test.each(LOGIN_JOURNEY_SCENARIOS)('$name', (scenario) => scenario.run())
})
