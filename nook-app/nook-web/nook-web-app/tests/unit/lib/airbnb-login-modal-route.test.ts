// @vitest-environment-options { "url": "https://www.airbnb.com/" }

import { afterEach, describe, expect, test } from 'vitest'

import {
  AirbnbLoginModalRouteKind,
  observeAirbnbLoginModalRoute,
} from '../../../../nook-web-shared/src/extension/airbnb-login-modal-route'

enum AirbnbFormActionKind {
  Omitted = 'omitted',
  Explicit = 'explicit',
}

type AirbnbFormAction =
  | { readonly kind: AirbnbFormActionKind.Omitted }
  | { readonly kind: AirbnbFormActionKind.Explicit; readonly value: string }

enum AirbnbFormPresentationKind {
  Modal = 'modal',
  Document = 'document',
}

type AirbnbFormFixture = {
  readonly action: AirbnbFormAction
  readonly presentation: AirbnbFormPresentationKind
  readonly dialogAttributes: string
  readonly formAttributes: string
  readonly fieldMarkup: string
  readonly submitMarkup: string
}

type AirbnbFixtureCase = {
  readonly name: string
  readonly fixture: AirbnbFormFixture
}

type AirbnbUnsafeActionCase = {
  readonly name: string
  readonly action: string
}

const AIRBNB_IDENTITY_FIELD =
  '<label for="phone-or-email">Phone number or email</label><input id="phone-or-email" type="text" inputmode="email" autocomplete="tel-national">'
const AIRBNB_CONTINUE_CONTROL = '<button type="submit">Continue</button>'

const AIRBNB_DEFAULT_FIXTURE: AirbnbFormFixture = {
  action: { kind: AirbnbFormActionKind.Omitted },
  presentation: AirbnbFormPresentationKind.Modal,
  dialogAttributes: '',
  formAttributes: '',
  fieldMarkup: AIRBNB_IDENTITY_FIELD,
  submitMarkup: AIRBNB_CONTINUE_CONTROL,
}

function installAirbnbForm(fixture: AirbnbFormFixture): HTMLFormElement {
  const actionMarkup =
    fixture.action.kind === AirbnbFormActionKind.Explicit
      ? ` action="${fixture.action.value}"`
      : ''
  const formAttributes = fixture.formAttributes
    ? ` ${fixture.formAttributes}`
    : ''
  const dialogAttributes = fixture.dialogAttributes
    ? ` ${fixture.dialogAttributes}`
    : ''
  const form = `<form${actionMarkup}${formAttributes}>${fixture.fieldMarkup}${fixture.submitMarkup}</form>`
  document.body.innerHTML =
    fixture.presentation === AirbnbFormPresentationKind.Document
      ? form
      : `<div role="dialog"${dialogAttributes}>${form}</div>`
  const installed = document.querySelector('form')
  if (!(installed instanceof HTMLFormElement)) {
    throw new Error('expected Airbnb form fixture')
  }
  return installed
}

function observeInstalledForm(fixture: AirbnbFormFixture) {
  const form = installAirbnbForm(fixture)
  const request = { form }
  return observeAirbnbLoginModalRoute(request)
}

afterEach(() => {
  document.body.replaceChildren()
  window.history.replaceState({}, '', '/')
})

describe('Airbnb homepage login modal route detector', () => {
  test('accepts an omitted action only with the strict rendered modal shape', () => {
    const form = installAirbnbForm(AIRBNB_DEFAULT_FIXTURE)

    expect(form.hasAttribute('action')).toBe(false)
    expect(form.action).toBe('https://www.airbnb.com/')
    const request = { form }
    expect(observeAirbnbLoginModalRoute(request)).toEqual({
      kind: AirbnbLoginModalRouteKind.Present,
      destinationIdentity: 'https://www.airbnb.com/login',
    })
  })

  test('preserves the explicit homepage action contract', () => {
    const fixture: AirbnbFormFixture = {
      ...AIRBNB_DEFAULT_FIXTURE,
      action: { kind: AirbnbFormActionKind.Explicit, value: '/' },
    }
    expect(observeInstalledForm(fixture)).toEqual({
      kind: AirbnbLoginModalRouteKind.Present,
      destinationIdentity: 'https://www.airbnb.com/login',
    })
  })

  const omittedActionRejections: readonly AirbnbFixtureCase[] = [
    {
      name: 'generic homepage form without a modal',
      fixture: {
        ...AIRBNB_DEFAULT_FIXTURE,
        presentation: AirbnbFormPresentationKind.Document,
      },
    },
    {
      name: 'form with an identity-bearing class',
      fixture: {
        ...AIRBNB_DEFAULT_FIXTURE,
        formAttributes: 'class="login-form"',
      },
    },
    {
      name: 'form with an identity-bearing id',
      fixture: {
        ...AIRBNB_DEFAULT_FIXTURE,
        formAttributes: 'id="login-form"',
      },
    },
    {
      name: 'form with a non-empty aria label',
      fixture: {
        ...AIRBNB_DEFAULT_FIXTURE,
        formAttributes: 'aria-label="Log in"',
      },
    },
    {
      name: 'modal with an unsafe identity field shape',
      fixture: {
        ...AIRBNB_DEFAULT_FIXTURE,
        fieldMarkup:
          '<label for="phone-or-email">Phone number or email</label><input id="phone-or-email" type="email" autocomplete="tel-national">',
      },
    },
    {
      name: 'modal with an ambiguous submit surface',
      fixture: {
        ...AIRBNB_DEFAULT_FIXTURE,
        submitMarkup: `${AIRBNB_CONTINUE_CONTROL}<button type="submit">Primary action</button>`,
      },
    },
  ]

  test.each(omittedActionRejections)(
    'rejects omitted-action $name',
    ({ fixture }) => {
      expect(observeInstalledForm(fixture)).toEqual({
        kind: AirbnbLoginModalRouteKind.Absent,
      })
    },
  )

  const unsafeActionCases: readonly AirbnbUnsafeActionCase[] = [
    { name: 'a homepage query redirect', action: '/?next=1' },
    {
      name: 'a cross-origin attacker route',
      action: 'https://attacker.example/login',
    },
    {
      name: 'an Airbnb hostname lookalike route',
      action: 'https://www.airbnb.com.attacker.example/',
    },
  ]

  test.each(unsafeActionCases)(
    'rejects an explicit unsafe action: $name',
    ({ action }) => {
      const fixture: AirbnbFormFixture = {
        ...AIRBNB_DEFAULT_FIXTURE,
        action: { kind: AirbnbFormActionKind.Explicit, value: action },
      }
      expect(observeInstalledForm(fixture)).toEqual({
        kind: AirbnbLoginModalRouteKind.Absent,
      })
    },
  )

  test('rejects an omitted action when the current homepage has a query', () => {
    window.history.replaceState({}, '', '/?next=1')
    expect(observeInstalledForm(AIRBNB_DEFAULT_FIXTURE)).toEqual({
      kind: AirbnbLoginModalRouteKind.Absent,
    })
  })

  test('rejects a hidden or inert modal despite the matching fields', () => {
    const hiddenFixture: AirbnbFormFixture = {
      ...AIRBNB_DEFAULT_FIXTURE,
      dialogAttributes: 'aria-hidden="true"',
    }
    expect(observeInstalledForm(hiddenFixture)).toEqual({
      kind: AirbnbLoginModalRouteKind.Absent,
    })
    const inertFixture: AirbnbFormFixture = {
      ...AIRBNB_DEFAULT_FIXTURE,
      dialogAttributes: 'inert',
    }
    expect(observeInstalledForm(inertFixture)).toEqual({
      kind: AirbnbLoginModalRouteKind.Absent,
    })
  })
})
