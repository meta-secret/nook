// @vitest-environment-options { "url": "https://www.airbnb.com/" }

import { afterEach, describe, expect, test } from 'vitest'

import {
  AirbnbLoginModalRouteKind,
  isAirbnbLoginModalContinueControl,
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

enum AirbnbPageSurfaceKind {
  IsolatedModal = 'isolated-modal',
  HomepageShell = 'homepage-shell',
}

type AirbnbFormFixture = {
  readonly action: AirbnbFormAction
  readonly presentation: AirbnbFormPresentationKind
  readonly pageSurface: AirbnbPageSurfaceKind
  readonly dialogAttributes: string
  readonly dialogAncestorAttributes: string
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
const AIRBNB_CONTINUE_CONTROL =
  '<button type="submit" class="airbnb-continue-button">Continue</button>'

const AIRBNB_DEFAULT_FIXTURE: AirbnbFormFixture = {
  action: { kind: AirbnbFormActionKind.Omitted },
  presentation: AirbnbFormPresentationKind.Modal,
  pageSurface: AirbnbPageSurfaceKind.IsolatedModal,
  dialogAttributes: '',
  dialogAncestorAttributes: '',
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
  const dialog = `<div role="dialog"${dialogAttributes}>${form}</div>`
  const wrappedDialog = fixture.dialogAncestorAttributes
    ? `<section ${fixture.dialogAncestorAttributes}>${dialog}</section>`
    : dialog
  const homepageShell = `<form action="/homes" aria-label="Search"><input type="search" aria-label="Where"></form>${wrappedDialog}`
  document.body.innerHTML =
    fixture.presentation === AirbnbFormPresentationKind.Document
      ? form
      : fixture.pageSurface === AirbnbPageSurfaceKind.HomepageShell
        ? `<main>${homepageShell}</main>`
        : wrappedDialog
  const formSelector =
    fixture.pageSurface === AirbnbPageSurfaceKind.HomepageShell
      ? '[role="dialog"] form'
      : 'form'
  const installed = document.querySelector(formSelector)
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

  test('accepts the modal in the homepage shell beside unrelated search controls', () => {
    const fixture: AirbnbFormFixture = {
      ...AIRBNB_DEFAULT_FIXTURE,
      pageSurface: AirbnbPageSurfaceKind.HomepageShell,
    }
    const form = installAirbnbForm(fixture)

    expect(form.closest('[role="dialog"]')).toBeInstanceOf(HTMLElement)
    expect(document.querySelector('form[aria-label="Search"]')).toBeInstanceOf(
      HTMLFormElement,
    )
    expect(observeInstalledForm(fixture)).toEqual({
      kind: AirbnbLoginModalRouteKind.Present,
      destinationIdentity: 'https://www.airbnb.com/login',
    })
  })

  test('canonicalizes only the strict modal Continue control', () => {
    const form = installAirbnbForm(AIRBNB_DEFAULT_FIXTURE)
    const control = form.querySelector('button[type="submit"]')
    if (!(control instanceof HTMLButtonElement)) {
      throw new Error('expected Airbnb Continue control')
    }
    expect(isAirbnbLoginModalContinueControl({ form, control })).toBe(true)

    const genericForm = installAirbnbForm({
      ...AIRBNB_DEFAULT_FIXTURE,
      presentation: AirbnbFormPresentationKind.Document,
    })
    const genericControl = genericForm.querySelector('button[type="submit"]')
    if (!(genericControl instanceof HTMLButtonElement)) {
      throw new Error('expected generic Continue control')
    }
    expect(
      isAirbnbLoginModalContinueControl({
        form: genericForm,
        control: genericControl,
      }),
    ).toBe(false)
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

  test('rejects a modal nested below a hidden ancestor', () => {
    const fixture: AirbnbFormFixture = {
      ...AIRBNB_DEFAULT_FIXTURE,
      dialogAncestorAttributes: 'aria-hidden="true"',
    }

    expect(observeInstalledForm(fixture)).toEqual({
      kind: AirbnbLoginModalRouteKind.Absent,
    })
  })
})
