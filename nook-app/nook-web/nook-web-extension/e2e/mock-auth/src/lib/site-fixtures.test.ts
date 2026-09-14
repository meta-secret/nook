import { describe, expect, test } from 'bun:test'

import pilotExpectations from '../../fixtures/pilot-expectations.json'
import {
  getShellTemplate,
  listShellTemplateIds,
  ShellTemplatePilotExpectation,
} from '../../fixtures/resolve-site-fixture.mjs'

describe('mock-auth Pilot expectation catalog', () => {
  test('partitions every template into an explicit positive or fail-closed contract', () => {
    const templateIds = listShellTemplateIds()
    expect(Object.keys(pilotExpectations).sort()).toEqual(templateIds)

    const failClosedTemplateIds: string[] = []
    let continueWithNookTemplateCount = 0
    for (const templateId of templateIds) {
      const template = getShellTemplate(templateId)
      if (!template) {
        throw new Error(`shell template ${templateId} is missing`)
      }
      switch (template.pilotExpectation) {
        case ShellTemplatePilotExpectation.ContinueWithNook:
          continueWithNookTemplateCount += 1
          break
        case ShellTemplatePilotExpectation.FailClosedAlternateAuthentication:
          failClosedTemplateIds.push(templateId)
          break
        default:
          throw new Error(
            `shell template ${templateId} has no typed expectation`,
          )
      }
    }

    expect(continueWithNookTemplateCount).toBe(30)
    expect(failClosedTemplateIds).toEqual(['enterprise-sso-email'])
  })

  test('keeps the Airbnb identity label structural and associated', () => {
    const airbnbTemplate = getShellTemplate('airbnb')
    if (!airbnbTemplate) {
      throw new Error('Airbnb shell template is missing')
    }
    expect(airbnbTemplate.quirks).toContain('visible-associated-label')
    const step = airbnbTemplate.steps[0]
    if (!step) throw new Error('Airbnb shell step is missing')
    const field = step.fields[0]
    if (!field) throw new Error('Airbnb shell identity field is missing')
    expect(field.type).toBe('text')
    expect(field.inputmode).toBe('email')
    expect(field.autocomplete).toBe('tel-national')
    expect(field.label).toBe('Phone number or email')
    expect(step.submit.type).toBe('submit')
    expect(step.submit.label).toBe('Continue')
  })
})
