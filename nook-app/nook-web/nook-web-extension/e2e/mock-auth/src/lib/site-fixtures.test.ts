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

    expect(continueWithNookTemplateCount).toBe(27)
    expect(failClosedTemplateIds).toEqual(['enterprise-sso-email'])
  })
})
