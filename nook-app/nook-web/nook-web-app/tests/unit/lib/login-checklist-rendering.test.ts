/// <reference types="chrome" />
import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  AuthenticationOutcomeVerdict,
  project_authentication_login_checklist,
  type AuthenticationLoginChecklistProjection,
  type AuthenticationLoginChecklistObservation,
  type AuthenticationLoginChecklistState,
  type AuthenticationOutcomeObservation,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  LoginChecklistRendering,
  type LoginChecklistSurface,
} from '../../../../nook-web-extension/src/content/autofill/login-checklist-rendering'

class ChecklistDomFixture {
  readonly surface: LoginChecklistSurface
  readonly rendering: LoginChecklistRendering

  constructor() {
    const body = document.createElement('div')
    const title = document.createElement('h1')
    const description = document.createElement('p')
    const action = document.createElement('button')
    body.append(title, description, action)
    this.surface = { body, title, description }
    this.rendering = new LoginChecklistRendering(this.surface)
  }

  rowSteps() {
    return [...this.surface.body.querySelectorAll('li')].map(
      ChecklistDomFixture.rowStep,
    )
  }
  rowStates() {
    return [...this.surface.body.querySelectorAll('li')].map(
      ChecklistDomFixture.rowState,
    )
  }
  private static rowStep(row: HTMLLIElement) {
    return row.dataset.step
  }
  private static rowState(row: HTMLLIElement) {
    return row.dataset.state
  }

  project(observation: AuthenticationLoginChecklistObservation) {
    const state: AuthenticationLoginChecklistState = {
      kind: 'Activity',
      activity: 'Ready',
    }
    const request: AuthenticationLoginChecklistProjection = {
      state,
      observation,
    }
    return project_authentication_login_checklist(request)
  }
}

class ChecklistBrowserCopy {
  message(key: string): string {
    return key
  }
  install(): void {
    const browser: { i18n: Pick<typeof chrome.i18n, 'getMessage'> } = {
      i18n: { getMessage: this.message.bind(this) },
    }
    vi.stubGlobal('chrome', browser)
  }
}
const browserCopy = new ChecklistBrowserCopy()
beforeEach(browserCopy.install.bind(browserCopy))

describe('real Rust checklist DOM projection', () => {
  test('renders ordered pending rows between status and actions without a live list', () => {
    const fixture = new ChecklistDomFixture()
    const ready: AuthenticationLoginChecklistObservation = {
      kind: 'Activity',
      activity: 'Ready',
    }
    fixture.rendering.render(fixture.project(ready))
    const list = fixture.surface.body.querySelector('ol')
    expect(list?.children).toHaveLength(3)
    expect(fixture.rowSteps()).toEqual([
      'FillLogin',
      'SubmitForm',
      'CheckResult',
    ])
    expect(list?.previousElementSibling).toBe(fixture.surface.description)
    expect(list?.nextElementSibling?.tagName).toBe('BUTTON')
    expect(fixture.surface.description.getAttribute('aria-live')).toBe('polite')
    expect(fixture.surface.description.getAttribute('aria-atomic')).toBe('true')
    expect(list?.hasAttribute('aria-live')).toBe(false)
    expect(list?.querySelectorAll('[aria-current]')).toHaveLength(0)
  })

  test('updates the current row and clears readiness only for real projected actions', () => {
    const fixture = new ChecklistDomFixture()
    const filling: AuthenticationLoginChecklistObservation = {
      kind: 'Activity',
      activity: 'Filling',
    }
    fixture.rendering.renderStatus(fixture.project(filling))
    expect(fixture.surface.title.textContent).toBe('widgetChecklistLabel')
    expect(fixture.surface.description.textContent).toBe(
      'widgetChecklistWorking',
    )
    expect(fixture.surface.title.textContent).not.toBe(
      fixture.surface.description.textContent,
    )
    expect(
      fixture.surface.body
        .querySelector('[aria-current="step"]')
        ?.getAttribute('data-step'),
    ).toBe('FillLogin')
    const manual: AuthenticationLoginChecklistObservation = {
      kind: 'Activity',
      activity: 'SubmissionUnobserved',
    }
    fixture.rendering.renderStatus(fixture.project(manual))
    expect(fixture.surface.description.textContent).toBe(
      'widgetChecklistWaiting',
    )
    expect(fixture.rowStates()).toEqual(['Done', 'Current', 'Pending'])
    expect(
      fixture.surface.body.querySelectorAll(
        '.pilot-checklist-mark[aria-hidden="true"]',
      ),
    ).toHaveLength(3)
  })

  test('reads the actual generated outcome ABI and renders attention without completing result', () => {
    const fixture = new ChecklistDomFixture()
    const observation: AuthenticationOutcomeObservation = {
      navigatedAwayFromAuthPath: false,
      authFieldsPresent: true,
      successMarkerPresent: false,
      errorMarkerPresent: true,
      sameDocumentMutation: true,
      inIframe: false,
      elapsedMs: 50,
    }
    const request: AuthenticationLoginChecklistProjection = {
      state: { kind: 'Activity', activity: 'Submitted' },
      observation: {
        kind: 'Outcome',
        verdict: AuthenticationOutcomeVerdict.Insufficient,
        observation,
      },
    }
    const presentation = project_authentication_login_checklist(request)
    fixture.rendering.renderStatus(presentation)
    expect(presentation.outcome_polling).toBe('Stop')
    expect(
      fixture.surface.body
        .querySelector('[data-step="CheckResult"]')
        ?.getAttribute('data-state'),
    ).toBe('Attention')
    expect(
      fixture.surface.body.querySelectorAll('[aria-current]'),
    ).toHaveLength(0)
  })
  test('renders confirmed result then clears completion on explicit takeover', () => {
    const fixture = new ChecklistDomFixture()
    const observation: AuthenticationOutcomeObservation = {
      navigatedAwayFromAuthPath: false,
      authFieldsPresent: false,
      successMarkerPresent: true,
      errorMarkerPresent: false,
      sameDocumentMutation: true,
      inIframe: false,
      elapsedMs: 20,
    }
    const submitted: AuthenticationLoginChecklistProjection = {
      state: { kind: 'Activity', activity: 'Submitted' },
      observation: {
        kind: 'Outcome',
        verdict: AuthenticationOutcomeVerdict.Sufficient,
        observation,
      },
    }
    const confirmed = project_authentication_login_checklist(submitted)
    fixture.rendering.renderStatus(confirmed)
    expect(
      fixture.surface.body.querySelectorAll('[data-state="Done"]'),
    ).toHaveLength(3)
    expect(fixture.surface.description.textContent).toBe(
      'widgetChecklistComplete',
    )
    const takeover: AuthenticationLoginChecklistProjection = {
      state: confirmed.state,
      observation: { kind: 'Activity', activity: 'TakenOver' },
    }
    fixture.rendering.renderStatus(
      project_authentication_login_checklist(takeover),
    )
    expect(
      fixture.surface.body.querySelectorAll('[data-state="Done"]'),
    ).toHaveLength(0)
    expect(
      fixture.surface.body.querySelectorAll('[data-state="Pending"]'),
    ).toHaveLength(3)
    expect(fixture.surface.description.textContent).toBe(
      'widgetChecklistInactive',
    )
  })
})
