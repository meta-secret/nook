import { describe, expect, test } from 'vitest'

import {
  CredentialFillEditability,
  CredentialFillFieldRole,
  CredentialFillRejection,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  CredentialFillJourneyOutcomeKind,
  SimulatedCredentialFieldIdentity,
  SimulatedCredentialFieldKind,
  SimulatedLoginJourneyValidationError,
  SimulatedLoginJourneyValidationFailure,
  SimulatedLoginPageIdentity,
  simulateLoginJourney,
  type CredentialFillJourneyOutcome,
  type CredentialFillJourneyRequest,
  type FakeLoginCredentials,
  type SimulatedCredentialFieldDefinition,
  type SimulatedLoginPageSnapshot,
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

const COMBINED_PAGE = new SimulatedLoginPageIdentity('combined-login')
const USERNAME_PAGE = new SimulatedLoginPageIdentity('username-entry')
const PASSWORD_PAGE = new SimulatedLoginPageIdentity('password-entry')
const READONLY_PAGE = new SimulatedLoginPageIdentity('readonly-password')
const UNRELATED_PAGE = new SimulatedLoginPageIdentity('unrelated-field')
const DUPLICATE_INDEX_PAGE = new SimulatedLoginPageIdentity('duplicate-index')
const NEW_PASSWORD_PAGE = new SimulatedLoginPageIdentity('new-password')
const OTP_PAGE = new SimulatedLoginPageIdentity('one-time-code')
const EMPTY_PAGE = new SimulatedLoginPageIdentity('empty-observation')
const AMBIGUOUS_PASSWORD_PAGE = new SimulatedLoginPageIdentity(
  'ambiguous-password',
)
const AMBIGUOUS_USERNAME_PAGE = new SimulatedLoginPageIdentity(
  'ambiguous-username',
)
const FIRST_REPLACED_PAGE = new SimulatedLoginPageIdentity('first-replaced')
const SECOND_REPLACED_PAGE = new SimulatedLoginPageIdentity('second-replaced')

const EMPTY_USERNAME_FIELD: SimulatedCredentialFieldDefinition = {
  kind: SimulatedCredentialFieldKind.Credential,
  field_identity: USERNAME,
  name: 'username',
  roleFactory: () => CredentialFillFieldRole.username(),
  editabilityFactory: () => CredentialFillEditability.writable(),
  value: '',
}

const EMPTY_PASSWORD_FIELD: SimulatedCredentialFieldDefinition = {
  kind: SimulatedCredentialFieldKind.Credential,
  field_identity: PASSWORD,
  name: 'password',
  roleFactory: () => CredentialFillFieldRole.current_password(),
  editabilityFactory: () => CredentialFillEditability.writable(),
  value: '',
}

type LoginJourneyScenario = {
  readonly name: string
  readonly journey: CredentialFillJourneyRequest
  readonly expected: CredentialFillJourneyOutcome[]
}

const LOGIN_JOURNEY_SCENARIOS: LoginJourneyScenario[] = [
  {
    name: 'fills a combined username and generic-password page',
    journey: {
      credentials: FAKE_CREDENTIALS,
      pages: [
        {
          page_identity: COMBINED_PAGE,
          fields: [
            EMPTY_USERNAME_FIELD,
            {
              ...EMPTY_PASSWORD_FIELD,
              roleFactory: () => CredentialFillFieldRole.generic_password(),
            },
          ],
          observed_field_identities: [USERNAME, PASSWORD],
        },
      ],
    },
    expected: [
      {
        kind: CredentialFillJourneyOutcomeKind.Completed,
        snapshot: {
          page_identity: COMBINED_PAGE,
          fields: [
            {
              field_identity: USERNAME,
              name: 'username',
              value: FAKE_CREDENTIALS.username,
            },
            {
              field_identity: PASSWORD,
              name: 'password',
              value: FAKE_CREDENTIALS.password,
            },
          ],
        },
      },
    ],
  },
  {
    name: 'replaces the username page with a password page',
    journey: {
      credentials: FAKE_CREDENTIALS,
      pages: [
        {
          page_identity: USERNAME_PAGE,
          fields: [EMPTY_USERNAME_FIELD],
          observed_field_identities: [USERNAME],
        },
        {
          page_identity: PASSWORD_PAGE,
          fields: [EMPTY_PASSWORD_FIELD],
          observed_field_identities: [PASSWORD],
        },
      ],
    },
    expected: [
      {
        kind: CredentialFillJourneyOutcomeKind.Replaced,
        next_page_identity: PASSWORD_PAGE,
        snapshot: {
          page_identity: USERNAME_PAGE,
          fields: [
            {
              field_identity: USERNAME,
              name: 'username',
              value: FAKE_CREDENTIALS.username,
            },
          ],
        },
      },
      {
        kind: CredentialFillJourneyOutcomeKind.Completed,
        snapshot: {
          page_identity: PASSWORD_PAGE,
          fields: [
            {
              field_identity: PASSWORD,
              name: 'password',
              value: FAKE_CREDENTIALS.password,
            },
          ],
        },
      },
    ],
  },
  {
    name: 'accepts the same field identity without leaking replacement values',
    journey: {
      credentials: FAKE_CREDENTIALS,
      pages: [
        {
          page_identity: FIRST_REPLACED_PAGE,
          fields: [
            {
              ...EMPTY_USERNAME_FIELD,
              name: 'shared-field',
              value: 'first-page-value',
            },
          ],
          observed_field_identities: [USERNAME],
        },
        {
          page_identity: SECOND_REPLACED_PAGE,
          fields: [
            {
              ...EMPTY_USERNAME_FIELD,
              name: 'shared-field',
              value: 'second-page-value',
            },
            EMPTY_PASSWORD_FIELD,
          ],
          observed_field_identities: [PASSWORD],
        },
      ],
    },
    expected: [
      {
        kind: CredentialFillJourneyOutcomeKind.Replaced,
        next_page_identity: SECOND_REPLACED_PAGE,
        snapshot: {
          page_identity: FIRST_REPLACED_PAGE,
          fields: [
            {
              field_identity: USERNAME,
              name: 'shared-field',
              value: FAKE_CREDENTIALS.username,
            },
          ],
        },
      },
      {
        kind: CredentialFillJourneyOutcomeKind.Completed,
        snapshot: {
          page_identity: SECOND_REPLACED_PAGE,
          fields: [
            {
              field_identity: USERNAME,
              name: 'shared-field',
              value: 'second-page-value',
            },
            {
              field_identity: PASSWORD,
              name: 'password',
              value: FAKE_CREDENTIALS.password,
            },
          ],
        },
      },
    ],
  },
  {
    name: 'rejects readonly password planning without mutation',
    journey: {
      credentials: FAKE_CREDENTIALS,
      pages: [
        {
          page_identity: READONLY_PAGE,
          fields: [
            {
              ...EMPTY_PASSWORD_FIELD,
              editabilityFactory: () => CredentialFillEditability.readonly(),
              value: 'readonly-value',
            },
          ],
          observed_field_identities: [PASSWORD],
        },
      ],
    },
    expected: [
      {
        kind: CredentialFillJourneyOutcomeKind.Rejected,
        rejection: CredentialFillRejection.PasswordFieldsReadonly,
        snapshot: {
          page_identity: READONLY_PAGE,
          fields: [
            {
              field_identity: PASSWORD,
              name: 'password',
              value: 'readonly-value',
            },
          ],
        },
      },
    ],
  },
  {
    name: 'leaves fields outside the current page observation untouched',
    journey: {
      credentials: FAKE_CREDENTIALS,
      pages: [
        {
          page_identity: UNRELATED_PAGE,
          fields: [
            EMPTY_USERNAME_FIELD,
            {
              ...EMPTY_PASSWORD_FIELD,
              field_identity: UNRELATED,
              name: 'unrelated-password',
              value: 'leave-this-value-untouched',
            },
          ],
          observed_field_identities: [USERNAME],
        },
      ],
    },
    expected: [
      {
        kind: CredentialFillJourneyOutcomeKind.Completed,
        snapshot: {
          page_identity: UNRELATED_PAGE,
          fields: [
            {
              field_identity: USERNAME,
              name: 'username',
              value: FAKE_CREDENTIALS.username,
            },
            {
              field_identity: UNRELATED,
              name: 'unrelated-password',
              value: 'leave-this-value-untouched',
            },
          ],
        },
      },
    ],
  },
  {
    name: 'rejects duplicate field indices without mutation',
    journey: {
      credentials: FAKE_CREDENTIALS,
      pages: [
        {
          page_identity: DUPLICATE_INDEX_PAGE,
          fields: [
            { ...EMPTY_USERNAME_FIELD, value: 'original-username' },
            { ...EMPTY_PASSWORD_FIELD, value: 'original-password' },
          ],
          observed_field_identities: [USERNAME, USERNAME, PASSWORD],
        },
      ],
    },
    expected: [
      {
        kind: CredentialFillJourneyOutcomeKind.Rejected,
        rejection: CredentialFillRejection.DuplicateFieldIndex,
        snapshot: {
          page_identity: DUPLICATE_INDEX_PAGE,
          fields: [
            {
              field_identity: USERNAME,
              name: 'username',
              value: 'original-username',
            },
            {
              field_identity: PASSWORD,
              name: 'password',
              value: 'original-password',
            },
          ],
        },
      },
    ],
  },
  {
    name: 'rejects one-time-code observations without mutation',
    journey: {
      credentials: FAKE_CREDENTIALS,
      pages: [
        {
          page_identity: OTP_PAGE,
          fields: [
            {
              kind: SimulatedCredentialFieldKind.OneTimeCode,
              field_identity: ONE_TIME_CODE,
              name: 'one-time-code',
              value: '123456',
            },
          ],
          observed_field_identities: [ONE_TIME_CODE],
        },
      ],
    },
    expected: [
      {
        kind: CredentialFillJourneyOutcomeKind.Rejected,
        rejection: CredentialFillRejection.OneTimeCodeFieldPresent,
        snapshot: {
          page_identity: OTP_PAGE,
          fields: [
            {
              field_identity: ONE_TIME_CODE,
              name: 'one-time-code',
              value: '123456',
            },
          ],
        },
      },
    ],
  },
  {
    name: 'rejects a page without observed credential fields',
    journey: {
      credentials: FAKE_CREDENTIALS,
      pages: [
        {
          page_identity: EMPTY_PAGE,
          fields: [
            {
              ...EMPTY_USERNAME_FIELD,
              field_identity: UNOBSERVED,
              name: 'unobserved-username',
              value: 'preserved-username',
            },
          ],
          observed_field_identities: [],
        },
      ],
    },
    expected: [
      {
        kind: CredentialFillJourneyOutcomeKind.Rejected,
        rejection: CredentialFillRejection.NoCredentialField,
        snapshot: {
          page_identity: EMPTY_PAGE,
          fields: [
            {
              field_identity: UNOBSERVED,
              name: 'unobserved-username',
              value: 'preserved-username',
            },
          ],
        },
      },
    ],
  },
  {
    name: 'rejects ambiguous password fields without mutation',
    journey: {
      credentials: FAKE_CREDENTIALS,
      pages: [
        {
          page_identity: AMBIGUOUS_PASSWORD_PAGE,
          fields: [
            {
              ...EMPTY_PASSWORD_FIELD,
              name: 'current-password',
              value: 'current-value',
            },
            {
              ...EMPTY_PASSWORD_FIELD,
              field_identity: SECOND_PASSWORD,
              name: 'generic-password',
              roleFactory: () => CredentialFillFieldRole.generic_password(),
              value: 'generic-value',
            },
          ],
          observed_field_identities: [PASSWORD, SECOND_PASSWORD],
        },
      ],
    },
    expected: [
      {
        kind: CredentialFillJourneyOutcomeKind.Rejected,
        rejection: CredentialFillRejection.AmbiguousPasswordField,
        snapshot: {
          page_identity: AMBIGUOUS_PASSWORD_PAGE,
          fields: [
            {
              field_identity: PASSWORD,
              name: 'current-password',
              value: 'current-value',
            },
            {
              field_identity: SECOND_PASSWORD,
              name: 'generic-password',
              value: 'generic-value',
            },
          ],
        },
      },
    ],
  },
  {
    name: 'rejects ambiguous username fields without mutation',
    journey: {
      credentials: FAKE_CREDENTIALS,
      pages: [
        {
          page_identity: AMBIGUOUS_USERNAME_PAGE,
          fields: [
            { ...EMPTY_USERNAME_FIELD, value: 'first-value' },
            {
              ...EMPTY_USERNAME_FIELD,
              field_identity: SECOND_USERNAME,
              name: 'second-username',
              value: 'second-value',
            },
          ],
          observed_field_identities: [USERNAME, SECOND_USERNAME],
        },
      ],
    },
    expected: [
      {
        kind: CredentialFillJourneyOutcomeKind.Rejected,
        rejection: CredentialFillRejection.AmbiguousUsernameField,
        snapshot: {
          page_identity: AMBIGUOUS_USERNAME_PAGE,
          fields: [
            {
              field_identity: USERNAME,
              name: 'username',
              value: 'first-value',
            },
            {
              field_identity: SECOND_USERNAME,
              name: 'second-username',
              value: 'second-value',
            },
          ],
        },
      },
    ],
  },
]

type InvalidLoginJourneyScenario = {
  readonly name: string
  readonly journey: CredentialFillJourneyRequest
  readonly expectedFailure: SimulatedLoginJourneyValidationFailure
  readonly expectedSnapshots: readonly SimulatedLoginPageSnapshot[]
}

const DUPLICATE = new SimulatedCredentialFieldIdentity('duplicate')
const UNKNOWN = new SimulatedCredentialFieldIdentity('unknown')
const DUPLICATE_PAGE = new SimulatedLoginPageIdentity('duplicate-page')
const VALIDATION_PAGE = new SimulatedLoginPageIdentity('validation-page')

const KNOWN_USERNAME_FIELD: SimulatedCredentialFieldDefinition = {
  ...EMPTY_USERNAME_FIELD,
  name: 'known-username',
  value: 'known-original',
}

const INVALID_LOGIN_JOURNEYS: InvalidLoginJourneyScenario[] = [
  {
    name: 'rejects an empty journey before materialization',
    journey: { credentials: FAKE_CREDENTIALS, pages: [] },
    expectedFailure: SimulatedLoginJourneyValidationFailure.EmptyJourney,
    expectedSnapshots: [],
  },
  {
    name: 'rejects duplicate page identities before materialization',
    journey: {
      credentials: FAKE_CREDENTIALS,
      pages: [
        {
          page_identity: DUPLICATE_PAGE,
          fields: [KNOWN_USERNAME_FIELD],
          observed_field_identities: [USERNAME],
        },
        {
          page_identity: new SimulatedLoginPageIdentity('duplicate-page'),
          fields: [],
          observed_field_identities: [],
        },
      ],
    },
    expectedFailure:
      SimulatedLoginJourneyValidationFailure.DuplicatePageIdentity,
    expectedSnapshots: [
      {
        page_identity: DUPLICATE_PAGE,
        fields: [
          {
            field_identity: USERNAME,
            name: 'known-username',
            value: 'known-original',
          },
        ],
      },
      {
        page_identity: new SimulatedLoginPageIdentity('duplicate-page'),
        fields: [],
      },
    ],
  },
  {
    name: 'rejects duplicate field identities before materialization',
    journey: {
      credentials: FAKE_CREDENTIALS,
      pages: [
        {
          page_identity: VALIDATION_PAGE,
          fields: [
            {
              ...EMPTY_USERNAME_FIELD,
              field_identity: DUPLICATE,
              name: 'first-duplicate',
              value: 'first-original',
            },
            {
              ...EMPTY_PASSWORD_FIELD,
              field_identity: new SimulatedCredentialFieldIdentity('duplicate'),
              name: 'second-duplicate',
              value: 'second-original',
            },
          ],
          observed_field_identities: [DUPLICATE],
        },
      ],
    },
    expectedFailure:
      SimulatedLoginJourneyValidationFailure.DuplicateFieldIdentity,
    expectedSnapshots: [
      {
        page_identity: VALIDATION_PAGE,
        fields: [
          {
            field_identity: DUPLICATE,
            name: 'first-duplicate',
            value: 'first-original',
          },
          {
            field_identity: new SimulatedCredentialFieldIdentity('duplicate'),
            name: 'second-duplicate',
            value: 'second-original',
          },
        ],
      },
    ],
  },
  {
    name: 'rejects unknown page field identities before materialization',
    journey: {
      credentials: FAKE_CREDENTIALS,
      pages: [
        {
          page_identity: VALIDATION_PAGE,
          fields: [KNOWN_USERNAME_FIELD],
          observed_field_identities: [UNKNOWN],
        },
      ],
    },
    expectedFailure:
      SimulatedLoginJourneyValidationFailure.UnknownPageFieldReference,
    expectedSnapshots: [
      {
        page_identity: VALIDATION_PAGE,
        fields: [
          {
            field_identity: USERNAME,
            name: 'known-username',
            value: 'known-original',
          },
        ],
      },
    ],
  },
]

function snapshotDefinitions(
  journey: CredentialFillJourneyRequest,
): readonly SimulatedLoginPageSnapshot[] {
  return journey.pages.map((page) => ({
    page_identity: page.page_identity,
    fields: page.fields.map((field) => ({
      field_identity: field.field_identity,
      name: field.name,
      value: field.value,
    })),
  }))
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

enum PageLifecycleEvent {
  FirstRoleMaterialized = 'firstRoleMaterialized',
  FirstEditabilityMaterialized = 'firstEditabilityMaterialized',
  FirstEditabilityDisposed = 'firstEditabilityDisposed',
  FirstRoleDisposed = 'firstRoleDisposed',
  SecondRoleMaterialized = 'secondRoleMaterialized',
  SecondEditabilityMaterialized = 'secondEditabilityMaterialized',
  SecondEditabilityDisposed = 'secondEditabilityDisposed',
  SecondRoleDisposed = 'secondRoleDisposed',
}

enum LaterPageEvent {
  RoleFactoryCalled = 'roleFactoryCalled',
}

describe('deterministic zero-vault login page journeys', () => {
  test.each(LOGIN_JOURNEY_SCENARIOS)('$name', (scenario) => {
    const journey = scenario.journey
    const firstResult = simulateLoginJourney(journey)
    const secondResult = simulateLoginJourney(journey)
    expect(firstResult).toEqual(scenario.expected)
    expect(secondResult).toEqual(scenario.expected)
  })

  test.each(INVALID_LOGIN_JOURNEYS)('$name', (scenario) => {
    const journey = scenario.journey
    const before = snapshotDefinitions(journey)
    const failure = captureValidationFailure(journey)
    const after = snapshotDefinitions(journey)
    expect(failure).toBe(scenario.expectedFailure)
    expect(before).toEqual(scenario.expectedSnapshots)
    expect(after).toEqual(before)
  })

  test('does not materialize a later page after first-page rejection', () => {
    const laterPageEvents: LaterPageEvent[] = []
    const laterRoleFactory = (): CredentialFillFieldRole => {
      laterPageEvents.push(LaterPageEvent.RoleFactoryCalled)
      throw new Error('later page role factory must not run')
    }
    const journey: CredentialFillJourneyRequest = {
      credentials: FAKE_CREDENTIALS,
      pages: [
        {
          page_identity: NEW_PASSWORD_PAGE,
          fields: [
            {
              kind: SimulatedCredentialFieldKind.NewPassword,
              field_identity: UNSAFE,
              name: 'new-password',
              value: 'new-password-value',
            },
          ],
          observed_field_identities: [UNSAFE],
        },
        {
          page_identity: USERNAME_PAGE,
          fields: [
            {
              ...EMPTY_USERNAME_FIELD,
              name: 'later-username',
              roleFactory: laterRoleFactory,
              value: 'original-later-username',
            },
          ],
          observed_field_identities: [USERNAME],
        },
      ],
    }
    const expected: CredentialFillJourneyOutcome[] = [
      {
        kind: CredentialFillJourneyOutcomeKind.Rejected,
        rejection: CredentialFillRejection.NewPasswordFieldPresent,
        snapshot: {
          page_identity: NEW_PASSWORD_PAGE,
          fields: [
            {
              field_identity: UNSAFE,
              name: 'new-password',
              value: 'new-password-value',
            },
          ],
        },
      },
    ]

    const firstResult = simulateLoginJourney(journey)
    const secondResult = simulateLoginJourney(journey)

    expect(firstResult).toEqual(expected)
    expect(secondResult).toEqual(expected)
    expect(laterPageEvents).toEqual([])
  })

  test('disposes a replaced page before materializing its successor', () => {
    const events: PageLifecycleEvent[] = []
    const firstRoleFactory = (): CredentialFillFieldRole => {
      events.push(PageLifecycleEvent.FirstRoleMaterialized)
      const role = CredentialFillFieldRole.username()
      const freeRole = role.free.bind(role)
      role.free = () => {
        events.push(PageLifecycleEvent.FirstRoleDisposed)
        freeRole()
      }
      return role
    }
    const firstEditabilityFactory = (): CredentialFillEditability => {
      events.push(PageLifecycleEvent.FirstEditabilityMaterialized)
      const editability = CredentialFillEditability.writable()
      const freeEditability = editability.free.bind(editability)
      editability.free = () => {
        events.push(PageLifecycleEvent.FirstEditabilityDisposed)
        freeEditability()
      }
      return editability
    }
    const secondRoleFactory = (): CredentialFillFieldRole => {
      events.push(PageLifecycleEvent.SecondRoleMaterialized)
      const role = CredentialFillFieldRole.current_password()
      const freeRole = role.free.bind(role)
      role.free = () => {
        events.push(PageLifecycleEvent.SecondRoleDisposed)
        freeRole()
      }
      return role
    }
    const secondEditabilityFactory = (): CredentialFillEditability => {
      events.push(PageLifecycleEvent.SecondEditabilityMaterialized)
      const editability = CredentialFillEditability.writable()
      const freeEditability = editability.free.bind(editability)
      editability.free = () => {
        events.push(PageLifecycleEvent.SecondEditabilityDisposed)
        freeEditability()
      }
      return editability
    }
    const journey: CredentialFillJourneyRequest = {
      credentials: FAKE_CREDENTIALS,
      pages: [
        {
          page_identity: USERNAME_PAGE,
          fields: [
            {
              ...EMPTY_USERNAME_FIELD,
              roleFactory: firstRoleFactory,
              editabilityFactory: firstEditabilityFactory,
            },
          ],
          observed_field_identities: [USERNAME],
        },
        {
          page_identity: PASSWORD_PAGE,
          fields: [
            {
              ...EMPTY_PASSWORD_FIELD,
              roleFactory: secondRoleFactory,
              editabilityFactory: secondEditabilityFactory,
            },
          ],
          observed_field_identities: [PASSWORD],
        },
      ],
    }

    simulateLoginJourney(journey)
    simulateLoginJourney(journey)

    expect(events).toEqual([
      PageLifecycleEvent.FirstRoleMaterialized,
      PageLifecycleEvent.FirstEditabilityMaterialized,
      PageLifecycleEvent.FirstEditabilityDisposed,
      PageLifecycleEvent.FirstRoleDisposed,
      PageLifecycleEvent.SecondRoleMaterialized,
      PageLifecycleEvent.SecondEditabilityMaterialized,
      PageLifecycleEvent.SecondEditabilityDisposed,
      PageLifecycleEvent.SecondRoleDisposed,
      PageLifecycleEvent.FirstRoleMaterialized,
      PageLifecycleEvent.FirstEditabilityMaterialized,
      PageLifecycleEvent.FirstEditabilityDisposed,
      PageLifecycleEvent.FirstRoleDisposed,
      PageLifecycleEvent.SecondRoleMaterialized,
      PageLifecycleEvent.SecondEditabilityMaterialized,
      PageLifecycleEvent.SecondEditabilityDisposed,
      PageLifecycleEvent.SecondRoleDisposed,
    ])
  })
})
