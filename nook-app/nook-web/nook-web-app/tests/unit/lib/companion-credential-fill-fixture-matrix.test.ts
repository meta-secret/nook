import { describe, expect, test } from 'vitest'

import siteShells from '../../../../nook-web-extension/e2e/mock-auth/fixtures/site-shells.json'
import { CredentialFillRejection } from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  SiteFixtureLookupKind,
  getSiteFixture,
  getTemplateFixture,
  listShellTemplateIds,
  listSiteFixtureIds,
} from '../../../../nook-web-extension/e2e/mock-auth/src/lib/site-fixtures'
import {
  CredentialFillJourneyOutcomeKind,
  SimulatedCredentialFieldIdentity,
  SimulatedCredentialFieldKind,
  SimulatedLoginPageIdentity,
  simulateLoginJourney,
  siteFixtureLoginJourney,
  type CredentialFillJourneyOutcome,
  type CredentialFillJourneyRequest,
  type FakeLoginCredentials,
  type SiteFixtureLoginJourneyRequest,
} from './companion-credential-fill-simulation'

const LOCAL_USERNAME = new SimulatedCredentialFieldIdentity('local-username')
const LOCAL_PASSWORD = new SimulatedCredentialFieldIdentity('local-password')
const HEADER_USERNAME = new SimulatedCredentialFieldIdentity('header-username')
const SEARCH_FIELD = new SimulatedCredentialFieldIdentity('search-field')
const NEWSLETTER_FIELD = new SimulatedCredentialFieldIdentity(
  'newsletter-field',
)

const FAKE_CREDENTIALS: FakeLoginCredentials = {
  username: 'fixture-user@example.test',
  password: 'fixture-password',
}

function assertCredentialValues(
  outcomes: readonly CredentialFillJourneyOutcome[],
): void {
  expect(outcomes.length).toBeGreaterThan(0)
  for (const outcome of outcomes) {
    const values = outcome.snapshot.fields.map((field) => field.value)
    for (const value of values) {
      expect([
        '',
        FAKE_CREDENTIALS.username,
        FAKE_CREDENTIALS.password,
      ]).toContain(value)
    }
    switch (outcome.kind) {
      case CredentialFillJourneyOutcomeKind.Rejected:
        expect(values).toEqual(values.map(() => ''))
        break
      case CredentialFillJourneyOutcomeKind.Replaced:
      case CredentialFillJourneyOutcomeKind.Completed:
        break
    }
  }
}

function assertTemplateOutcome(
  templateId: string,
  outcomes: readonly CredentialFillJourneyOutcome[],
): void {
  switch (templateId) {
    case 'dual-identity-password':
      expect(outcomes).toMatchObject([
        {
          kind: CredentialFillJourneyOutcomeKind.Rejected,
          rejection: CredentialFillRejection.AmbiguousUsernameField,
        },
      ])
      break
    case 'password-then-otp':
      expect(outcomes).toMatchObject([
        { kind: CredentialFillJourneyOutcomeKind.Replaced },
        {
          kind: CredentialFillJourneyOutcomeKind.Rejected,
          rejection: CredentialFillRejection.OneTimeCodeFieldPresent,
        },
      ])
      break
    default:
      expect(outcomes.at(-1)).toMatchObject({
        kind: CredentialFillJourneyOutcomeKind.Completed,
      })
      break
  }
}

describe('canonical mock-auth credential-fill matrix', () => {
  test('fills only the bounded login fields from a polluted page-wide form', () => {
    const pageIdentity = new SimulatedLoginPageIdentity('page-wide-aspnet-form')
    const fields: CredentialFillJourneyRequest['pages'][number]['fields'] = [
      {
        kind: SimulatedCredentialFieldKind.Classified,
        field_identity: HEADER_USERNAME,
        name: 'header username',
        field: { autocomplete: 'username', name: 'header-user' },
        value: 'header-value',
      },
      {
        kind: SimulatedCredentialFieldKind.Classified,
        field_identity: SEARCH_FIELD,
        name: 'search',
        field: { type: 'search', name: 'search' },
        value: 'account help',
      },
      {
        kind: SimulatedCredentialFieldKind.Classified,
        field_identity: LOCAL_USERNAME,
        name: 'username',
        field: { autocomplete: 'username', name: 'username' },
        value: '',
      },
      {
        kind: SimulatedCredentialFieldKind.Classified,
        field_identity: LOCAL_PASSWORD,
        name: 'password',
        field: {
          type: 'password',
          autocomplete: 'current-password',
          name: 'password',
        },
        value: '',
      },
      {
        kind: SimulatedCredentialFieldKind.Classified,
        field_identity: NEWSLETTER_FIELD,
        name: 'newsletter',
        field: { type: 'email', name: 'newsletter-email' },
        value: 'reader@example.test',
      },
    ]
    const boundedRequest: CredentialFillJourneyRequest = {
      credentials: FAKE_CREDENTIALS,
      pages: [
        {
          page_identity: pageIdentity,
          fields,
          observed_field_identities: [LOCAL_USERNAME, LOCAL_PASSWORD],
        },
      ],
    }
    const first = simulateLoginJourney(boundedRequest)
    const second = simulateLoginJourney(boundedRequest)
    expect(first).toEqual(second)
    expect(first).toMatchObject([
      {
        kind: CredentialFillJourneyOutcomeKind.Completed,
        snapshot: {
          fields: [
            { value: 'header-value' },
            { value: 'account help' },
            { value: FAKE_CREDENTIALS.username },
            { value: FAKE_CREDENTIALS.password },
            { value: 'reader@example.test' },
          ],
        },
      },
    ])

    const pollutedRequest: CredentialFillJourneyRequest = {
      credentials: FAKE_CREDENTIALS,
      pages: [
        {
          page_identity: pageIdentity,
          fields,
          observed_field_identities: [
            HEADER_USERNAME,
            SEARCH_FIELD,
            LOCAL_USERNAME,
            LOCAL_PASSWORD,
            NEWSLETTER_FIELD,
          ],
        },
      ],
    }
    expect(simulateLoginJourney(pollutedRequest)).toMatchObject([
      {
        kind: CredentialFillJourneyOutcomeKind.Rejected,
        rejection: CredentialFillRejection.AmbiguousUsernameField,
        snapshot: {
          fields: [
            { value: 'header-value' },
            { value: 'account help' },
            { value: '' },
            { value: '' },
            { value: 'reader@example.test' },
          ],
        },
      },
    ])
  })

  test('simulates every template twice and covers every site mapping', () => {
    const templateIds = listShellTemplateIds()
    expect(templateIds).toHaveLength(23)
    const templateResults = new Map<string, CredentialFillJourneyOutcome[]>()

    for (const templateId of templateIds) {
      const lookup = getTemplateFixture(templateId)
      switch (lookup.kind) {
        case SiteFixtureLookupKind.Missing:
          throw new Error('canonical template fixture is missing')
        case SiteFixtureLookupKind.Found: {
          const request: SiteFixtureLoginJourneyRequest = {
            fixture: lookup.fixture,
            credentials: FAKE_CREDENTIALS,
          }
          const journey = siteFixtureLoginJourney(request)
          const first = simulateLoginJourney(journey)
          const second = simulateLoginJourney(journey)
          expect(first).toEqual(second)
          assertCredentialValues(first)
          assertTemplateOutcome(templateId, first)
          templateResults.set(templateId, first)
          break
        }
      }
    }

    expect(templateResults.size).toBe(templateIds.length)
    const siteIds = listSiteFixtureIds()
    const catalogSiteIds = Object.keys(siteShells).sort()
    expect(catalogSiteIds).toHaveLength(1000)
    expect(siteIds).toHaveLength(1000)
    expect(siteIds).toEqual(catalogSiteIds)
    for (const siteId of siteIds) {
      const lookup = getSiteFixture(siteId)
      switch (lookup.kind) {
        case SiteFixtureLookupKind.Missing:
          throw new Error('canonical site fixture is missing')
        case SiteFixtureLookupKind.Found: {
          const templateResult = templateResults.get(lookup.fixture.template)
          if (!templateResult) {
            throw new Error('site fixture template was not simulated')
          }
          const request: SiteFixtureLoginJourneyRequest = {
            fixture: lookup.fixture,
            credentials: FAKE_CREDENTIALS,
          }
          const journey = siteFixtureLoginJourney(request)
          const first = simulateLoginJourney(journey)
          const second = simulateLoginJourney(journey)
          expect(first).toEqual(second)
          assertCredentialValues(first)
          expect(first.map((outcome) => outcome.kind)).toEqual(
            templateResult.map((outcome) => outcome.kind),
          )
          assertTemplateOutcome(lookup.fixture.template, first)
          break
        }
      }
    }
  })

  test('keeps a generated-classifier Ignored field snapshot-only', () => {
    const pageIdentity = new SimulatedLoginPageIdentity(
      'unrelated-fixture-page',
    )
    const fieldIdentity = new SimulatedCredentialFieldIdentity('search-field')
    const journey: CredentialFillJourneyRequest = {
      credentials: FAKE_CREDENTIALS,
      pages: [
        {
          page_identity: pageIdentity,
          fields: [
            {
              kind: SimulatedCredentialFieldKind.Classified,
              field_identity: fieldIdentity,
              name: 'search',
              field: { type: 'text', name: 'search' },
              value: 'unchanged-search-value',
            },
          ],
          observed_field_identities: [fieldIdentity],
        },
      ],
    }

    expect(simulateLoginJourney(journey)).toEqual([
      {
        kind: CredentialFillJourneyOutcomeKind.Rejected,
        rejection: CredentialFillRejection.NoCredentialField,
        snapshot: {
          page_identity: pageIdentity,
          fields: [
            {
              field_identity: fieldIdentity,
              name: 'search',
              value: 'unchanged-search-value',
            },
          ],
        },
      },
    ])
  })
})
