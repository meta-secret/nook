// @vitest-environment-options { "url": "https://www.airbnb.com/" }

import { afterEach, describe, expect, test } from 'vitest'

import {
  AirbnbLoginModalRouteKind,
  observeAirbnbLoginModalRoute,
} from '../../../../nook-web-shared/src/extension/airbnb-login-modal-route'

type FixtureOptions = {
  readonly action?: string
  readonly dialog?: boolean
  readonly dialogAttributes?: string
  readonly formAttributes?: string
  readonly fieldMarkup?: string
  readonly submitMarkup?: string
}

const AIRBNB_IDENTITY_FIELD =
  '<label for="phone-or-email">Phone number or email</label><input id="phone-or-email" type="text" inputmode="email" autocomplete="tel-national">'
const AIRBNB_CONTINUE_CONTROL = '<button type="submit">Continue</button>'

function installAirbnbForm(options: FixtureOptions = {}): HTMLFormElement {
  const action =
    options.action === undefined ? '' : ` action="${options.action}"`
  const formAttributes = options.formAttributes
    ? ` ${options.formAttributes}`
    : ''
  const dialogAttributes = options.dialogAttributes
    ? ` ${options.dialogAttributes}`
    : ''
  const fieldMarkup = options.fieldMarkup ?? AIRBNB_IDENTITY_FIELD
  const submitMarkup = options.submitMarkup ?? AIRBNB_CONTINUE_CONTROL
  const form = `<form${action}${formAttributes}>${fieldMarkup}${submitMarkup}</form>`
  document.body.innerHTML =
    options.dialog === false
      ? form
      : `<div role="dialog"${dialogAttributes}>${form}</div>`
  const installed = document.querySelector('form')
  if (!(installed instanceof HTMLFormElement)) {
    throw new Error('expected Airbnb form fixture')
  }
  return installed
}

function observeInstalledForm(options?: FixtureOptions) {
  return observeAirbnbLoginModalRoute({ form: installAirbnbForm(options) })
}

afterEach(() => {
  document.body.replaceChildren()
  window.history.replaceState({}, '', '/')
})

describe('Airbnb homepage login modal route detector', () => {
  test('accepts an omitted action only with the strict rendered modal shape', () => {
    const form = installAirbnbForm()

    expect(form.hasAttribute('action')).toBe(false)
    expect(form.action).toBe('https://www.airbnb.com/')
    expect(observeAirbnbLoginModalRoute({ form })).toEqual({
      kind: AirbnbLoginModalRouteKind.Present,
      destinationIdentity: 'https://www.airbnb.com/login',
    })
  })

  test('preserves the explicit homepage action contract', () => {
    expect(observeInstalledForm({ action: '/' })).toEqual({
      kind: AirbnbLoginModalRouteKind.Present,
      destinationIdentity: 'https://www.airbnb.com/login',
    })
  })

  test.each([
    ['generic homepage form without a modal', { dialog: false }],
    [
      'form with an identity-bearing class',
      { formAttributes: 'class="login-form"' },
    ],
    ['form with an identity-bearing id', { formAttributes: 'id="login-form"' }],
    [
      'form with a non-empty aria label',
      { formAttributes: 'aria-label="Log in"' },
    ],
    [
      'modal with an unsafe identity field shape',
      {
        fieldMarkup:
          '<label for="phone-or-email">Phone number or email</label><input id="phone-or-email" type="email" autocomplete="tel-national">',
      },
    ],
    [
      'modal with an ambiguous submit surface',
      {
        submitMarkup: `${AIRBNB_CONTINUE_CONTROL}<button type="submit">Primary action</button>`,
      },
    ],
  ])('rejects omitted-action %s', (_, options) => {
    expect(observeInstalledForm(options)).toEqual({
      kind: AirbnbLoginModalRouteKind.Absent,
    })
  })

  test.each(['/?next=1', 'https://attacker.example/login'])(
    'rejects an explicit unsafe action %s',
    (action) => {
      expect(observeInstalledForm({ action })).toEqual({
        kind: AirbnbLoginModalRouteKind.Absent,
      })
    },
  )

  test('rejects an omitted action when the current homepage has a query', () => {
    window.history.replaceState({}, '', '/?next=1')
    expect(observeInstalledForm()).toEqual({
      kind: AirbnbLoginModalRouteKind.Absent,
    })
  })

  test('rejects a hidden or inert modal despite the matching fields', () => {
    expect(
      observeInstalledForm({ dialogAttributes: 'aria-hidden="true"' }),
    ).toEqual({ kind: AirbnbLoginModalRouteKind.Absent })
    expect(observeInstalledForm({ dialogAttributes: 'inert' })).toEqual({
      kind: AirbnbLoginModalRouteKind.Absent,
    })
  })
})
