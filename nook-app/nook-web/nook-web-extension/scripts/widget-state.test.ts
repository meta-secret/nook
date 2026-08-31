import { expect, test } from 'bun:test'
import { ScanState } from '../src/content/autofill/state'

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
  expect(state.requestFollowUpIfRunning()).toBe(true)
  expect(state.requestFollowUpIfRunning()).toBe(true)
  expect(state.finishScan()).toBe(true)

  expect(state.beginScan()).toBe(true)
  expect(state.finishScan()).toBe(false)
  const sequence = state.sequence
  state.invalidateCurrentResult()
  expect(state.sequence).toBe(sequence + 1)
})
