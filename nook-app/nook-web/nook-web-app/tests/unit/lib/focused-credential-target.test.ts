import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  FocusedCredentialTargetKind,
  FocusedCredentialTargetSensor,
  FocusedCredentialTargetValidity,
} from '../../../../nook-web-extension/src/content/autofill/focused-credential-target'

class FocusedTargetFixture {
  readonly schedule = vi.fn<() => void>()
  readonly input = document.createElement('input')
  readonly sensor: FocusedCredentialTargetSensor

  constructor() {
    const request: ConstructorParameters<
      typeof FocusedCredentialTargetSensor
    >[0] = {
      document,
      schedule: this.schedule,
    }
    this.sensor = new FocusedCredentialTargetSensor(request)
    this.input.autocomplete = 'username'
    document.body.append(this.input)
    this.input.addEventListener('click', this.sensor.observe.bind(this.sensor))
    this.input.addEventListener(
      'focusin',
      this.sensor.observe.bind(this.sensor),
    )
  }

  get target() {
    const target = this.sensor.target
    switch (target.kind) {
      case FocusedCredentialTargetKind.Empty:
        throw new Error('Expected an interacted field')
      case FocusedCredentialTargetKind.Retained:
        return target
    }
  }
}

afterEach(() => document.body.replaceChildren())

describe('focused credential DOM lifecycle', () => {
  test.each(['click', 'focusin'])(
    'captures the exact %s target and schedules the existing scan',
    (event) => {
      const fixture = new FocusedTargetFixture()
      fixture.input.dispatchEvent(new Event(event))
      expect(fixture.target.input).toBe(fixture.input)
      expect(fixture.target.origin).toBe(location.origin)
      expect(fixture.schedule).toHaveBeenCalledOnce()
    },
  )

  test('retains the field when focus moves into the widget', () => {
    const fixture = new FocusedTargetFixture()
    fixture.input.click()
    const button = document.createElement('button')
    document.body.append(button)
    button.addEventListener(
      'focusin',
      fixture.sensor.observe.bind(fixture.sensor),
    )
    button.focus()
    expect(fixture.target.input).toBe(fixture.input)
    expect(fixture.sensor.validity(fixture.target)).toBe(
      FocusedCredentialTargetValidity.Current,
    )
  })

  test.each(['removed', 'disabled', 'readonly'])(
    'rejects a %s retained target',
    (mutation) => {
      const fixture = new FocusedTargetFixture()
      fixture.input.click()
      switch (mutation) {
        case 'removed':
          fixture.input.remove()
          break
        case 'disabled':
          fixture.input.disabled = true
          break
        case 'readonly':
          fixture.input.readOnly = true
          break
      }
      expect(fixture.sensor.validity(fixture.target)).toBe(
        FocusedCredentialTargetValidity.Changed,
      )
    },
  )

  test('rejects origin drift and clears on lifecycle cleanup', () => {
    const fixture = new FocusedTargetFixture()
    fixture.input.click()
    const changed = { ...fixture.target, origin: 'https://other.example' }
    expect(fixture.sensor.validity(changed)).toBe(
      FocusedCredentialTargetValidity.Changed,
    )
    fixture.sensor.clear()
    expect(fixture.sensor.target.kind).toBe(FocusedCredentialTargetKind.Empty)
  })
})
