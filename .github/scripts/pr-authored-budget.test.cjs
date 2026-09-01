const assert = require('node:assert/strict')
const test = require('node:test')

const {
  countTextLines,
  evaluateBudget,
  reviewBatchMatches,
  summarizeNumstat,
} = require('./pr-authored-budget.cjs')

test('keeps initial delivery at or below 2,000 authored lines', () => {
  assert.deepEqual(
    evaluateBudget({ authoredLines: 2_000, prNumber: '', verifiedReviewContext: false }),
    { ok: true, mode: 'initial' },
  )
})

test('blocks non-review growth above 2,000 authored lines', () => {
  assert.match(
    evaluateBudget({ authoredLines: 2_001, prNumber: '', verifiedReviewContext: false }).message,
    /without PR-verified review-fix context/,
  )
})

test('allows verified review fixes below the 3,000-line stop', () => {
  assert.deepEqual(
    evaluateBudget({ authoredLines: 2_999, prNumber: '42', verifiedReviewContext: true }),
    { ok: true, mode: 'review-fix' },
  )
})

test('blocks at the 3,000-line review-growth stop', () => {
  assert.match(
    evaluateBudget({ authoredLines: 3_000, prNumber: '42', verifiedReviewContext: true }).message,
    /3,000-line review-growth stop/,
  )
})

test('counts authored rows and reports generated and lockfile rows separately', () => {
  const summary = summarizeNumstat(
    '12\t3\tsrc/domain.ts\0' +
    '4\t5\tgenerated/schema.ts\0' +
    '2\t1\tbun.lock\0',
  )
  assert.equal(summary.authoredLines, 15)
  assert.equal(summary.generatedLines, 9)
  assert.equal(summary.lockfileLines, 3)
})

test('counts newline-terminated untracked text like Git numstat', () => {
  assert.equal(countTextLines('x\n'), 1)
  assert.equal(countTextLines('x'), 1)
  assert.equal(countTextLines('x\r\ny\r\n'), 2)
})

test('binds review growth to the current PR head, thread, and changed path', () => {
  const input = {
    localHead: 'a'.repeat(40),
    pr: { headRefOid: 'a'.repeat(40) },
    threads: [{ isResolved: false, isOutdated: false, path: 'src/fix.ts' }],
    changedPaths: ['src/fix.ts', 'src/fix.test.ts'],
    hasNextPage: false,
  }
  assert.equal(reviewBatchMatches(input), true)
  assert.equal(reviewBatchMatches({ ...input, changedPaths: ['src/other.ts'] }), false)
  assert.equal(reviewBatchMatches({ ...input, threads: [{ ...input.threads[0], isResolved: true }] }), false)
  assert.equal(reviewBatchMatches({ ...input, localHead: 'b'.repeat(40) }), false)
})
