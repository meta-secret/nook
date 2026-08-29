import { describe, expect, test, vi } from 'vitest'
import { requestFreshEnrollmentActions } from '../../../../nook-web-extension/src/content/enrollment-flow'

describe('enrollment action refresh', () => {
  test('clears stale actions before requesting a remounted classification', () => {
    const panel = document.createElement('section')
    panel.append(document.createElement('button'))
    const requestWorkflowReclassification = vi.fn()
    const host = {
      panel,
      requestWorkflowReclassification,
    } as unknown as Parameters<typeof requestFreshEnrollmentActions>[0]

    requestFreshEnrollmentActions(host)

    expect(panel.childElementCount).toBe(0)
    expect(requestWorkflowReclassification).toHaveBeenCalledOnce()
  })
})
