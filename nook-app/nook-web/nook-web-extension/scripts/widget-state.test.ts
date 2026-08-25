import { describe, expect, test } from 'bun:test'
import {
  AuthenticationActionState,
  ScanState,
  WidgetState,
  invalidateAuthenticationActionContext,
} from '../src/content/autofill/state'

describe('authentication scan scheduling', () => {
  test('keeps the first pending timer under continuous mutations', () => {
    const state = new ScanState()
    let timerCreations = 0
    const createTimer = () => {
      timerCreations++
      return timerCreations
    }

    expect(state.scheduleTimer(createTimer)).toBe(true)
    expect(state.scheduleTimer(createTimer)).toBe(false)
    expect(timerCreations).toBe(1)

    state.clearPendingTimer()
    expect(state.scheduleTimer(createTimer)).toBe(true)
    expect(timerCreations).toBe(2)
  })

  test('coalesces in-flight mutations into one follow-up scan', () => {
    const state = new ScanState()

    expect(state.beginScan()).toBe(true)
    expect(state.sequence).toBe(0)
    expect(state.requestFollowUpIfRunning()).toBe(true)
    expect(state.requestFollowUpIfRunning()).toBe(true)
    expect(state.sequence).toBe(1)
    expect(state.finishScan()).toBe(true)

    expect(state.beginScan()).toBe(true)
    expect(state.finishScan()).toBe(false)
  })

  test('invalidates a running scan when session-owned UI is cleared', () => {
    const state = new ScanState()
    const sequence = state.sequence

    state.invalidateCurrentResult()

    expect(state.sequence).toBe(sequence + 1)
  })
})

describe('authentication DOM action scheduling', () => {
  test('rejects an action result after authentication context changes', () => {
    const state = new AuthenticationActionState()
    const generation = state.begin()

    expect(state.isCurrent(generation)).toBe(true)
    state.invalidate()
    expect(state.isCurrent(generation)).toBe(false)
  })

  test('allows only the newest direct authentication action', () => {
    const state = new AuthenticationActionState()
    const first = state.begin()
    const second = state.begin()

    expect(state.isCurrent(first)).toBe(false)
    expect(state.isCurrent(second)).toBe(true)
  })

  test('invalidates a pending direct action before enrollment presentation', () => {
    const actionState = new AuthenticationActionState()
    const widget = new WidgetState()
    widget.busy = true
    const generation = actionState.begin()
    const actionContextArgs: Parameters<
      typeof invalidateAuthenticationActionContext
    >[0] = { actionState, widget }

    invalidateAuthenticationActionContext(actionContextArgs)

    expect(actionState.isCurrent(generation)).toBe(false)
    expect(widget.busy).toBe(false)
  })
})

describe('Nook Pilot presentation state', () => {
  test('recomputes automatic collapse as login availability changes', () => {
    const state = new WidgetState()

    state.applyAutomaticCollapse(true)
    expect(state.collapsed).toBe(true)

    state.applyAutomaticCollapse(false)
    expect(state.collapsed).toBe(false)
  })

  test('preserves an explicit user presentation across availability changes', () => {
    const collapsed = new WidgetState()
    collapsed.collapseByUser()
    collapsed.applyAutomaticCollapse(false)
    expect(collapsed.collapsed).toBe(true)

    const expanded = new WidgetState()
    expanded.expandByUser()
    expanded.applyAutomaticCollapse(true)
    expect(expanded.collapsed).toBe(false)
  })

  test('preserves an explicit presentation while remounting one workflow', () => {
    const state = new WidgetState()
    state.assignPresentationScope('login:password')
    state.collapseByUser()
    state.detachRenderedWidget()

    state.applyAutomaticCollapse(false)
    expect(state.collapsed).toBe(true)
    expect(state.presentationScope).toEqual({
      kind: 'assigned',
      key: 'login:password',
    })
  })

  test('clears only automatic collapse when enrollment begins', () => {
    const automatic = new WidgetState()
    automatic.applyAutomaticCollapse(true)
    automatic.beginEnrollmentWorkflow()
    expect(automatic.collapsed).toBe(false)

    const explicit = new WidgetState()
    explicit.collapseByUser()
    explicit.beginEnrollmentWorkflow()
    expect(explicit.collapsed).toBe(true)
  })

  test('scopes explicit presentation choices to the rendered workflow', () => {
    const state = new WidgetState()
    state.collapseByUser()
    state.clearRenderedWidget()

    state.applyAutomaticCollapse(false)
    expect(state.collapsed).toBe(false)

    state.expandByUser()
    state.clearRenderedWidget()
    state.applyAutomaticCollapse(true)
    expect(state.collapsed).toBe(true)
  })
})
