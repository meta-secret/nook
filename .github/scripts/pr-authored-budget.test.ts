import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  addUntracked,
  countTextLines,
  evaluateBudget,
  summarizeNumstat,
} from './pr-authored-budget.ts'

test('keeps delivery at or below 2,000 authored additions', () => {
  assert.deepEqual(
    evaluateBudget({ authoredLines: 2_000 }),
    { ok: true, mode: 'additions-only' },
  )
})

test('blocks above 2,000 authored additions', () => {
  assert.match(
    evaluateBudget({ authoredLines: 2_001 }).message,
    /authored additions exceed the 2,000-line limit/,
  )
})

test('counts only authored additions and reports excluded rows separately', () => {
  const summary = summarizeNumstat(
    '12\t300\tsrc/domain.ts\0' +
    '4\t5\tgenerated/schema.ts\0' +
    '2\t1\tbun.lock\0',
  )
  assert.equal(summary.authoredLines, 12)
  assert.equal(summary.generatedLines, 9)
  assert.equal(summary.lockfileLines, 3)
})

test('does not count deletion-only authored rows', () => {
  const summary = summarizeNumstat('0\t5000\tsrc/obsolete.ts\0')
  assert.equal(summary.authoredLines, 0)
})

test('counts newline-terminated untracked text like Git numstat', () => {
  assert.equal(countTextLines('x\n'), 1)
  assert.equal(countTextLines('x'), 1)
  assert.equal(countTextLines('x\r\ny\r\n'), 2)
  assert.equal(countTextLines('x\ry\r'), 1)
})

test('counts an untracked symlink blob without following its target', () => {
  const root = mkdtempSync(join(tmpdir(), 'nook-budget-'))
  const link = join(root, 'fixture.ts')
  try {
    symlinkSync('../missing-large-file', link)
    const summary = summarizeNumstat('')
    addUntracked(summary, [link])
    assert.equal(summary.authoredLines, 1)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
