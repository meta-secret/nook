const assert = require('node:assert/strict')
const { mkdtempSync, rmSync, symlinkSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const test = require('node:test')

const {
  addUntracked,
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

test('binds review growth to the current PR head, thread, and changed path', () => {
  const input = {
    pr: { headRefOid: 'a'.repeat(40) },
    threads: [{ isResolved: false, isOutdated: false, path: 'src/fix.ts' }],
    reviews: [],
    comments: [],
    changedPaths: ['src/fix.ts', 'src/fix.test.ts'],
    publishedAt: '2026-01-01T00:00:00Z',
    hasNextPage: false,
  }
  assert.equal(reviewBatchMatches(input), true)
  assert.equal(reviewBatchMatches({ ...input, changedPaths: ['src/other.ts'] }), false)
  assert.equal(reviewBatchMatches({ ...input, threads: [{ ...input.threads[0], isOutdated: true }] }), true)
  assert.equal(reviewBatchMatches({ ...input, threads: [{ ...input.threads[0], isResolved: true }] }), false)
  assert.equal(reviewBatchMatches({ ...input, changedPaths: ['src/renamed.ts', 'src/fix.ts'] }), true)
})

test('accepts reviewed-head bodies, committed fixes, and later PR comments', () => {
  const input = {
    pr: { headRefOid: 'a'.repeat(40) },
    threads: [], reviews: [], comments: [], changedPaths: ['src/fix.ts'],
    publishedAt: '2026-01-01T10:30:00-07:00', hasNextPage: false,
  }
  assert.equal(reviewBatchMatches({ ...input, reviews: [{ body: 'Please fix.', state: 'COMMENTED' }] }), true)
  assert.equal(reviewBatchMatches({ ...input, reviews: [{ body: 'Please fix.', state: 'CHANGES_REQUESTED' }] }), true)
  assert.equal(reviewBatchMatches({ ...input, reviews: [{ body: 'LGTM', state: 'APPROVED' }] }), false)
  assert.equal(reviewBatchMatches({ ...input, reviews: [{ body: 'Old finding', state: 'DISMISSED' }] }), false)
  assert.equal(reviewBatchMatches({
    ...input,
    reviews: [{
      author: { login: 'chatgpt-codex-connector[bot]' },
      body: '### 💡 Codex Review\n\nHere are some automated review suggestions for this pull request.\n\n**Reviewed commit:** `aaaaaaaaaa`',
      state: 'COMMENTED',
    }],
  }), false)
  assert.equal(reviewBatchMatches({
    ...input,
    reviews: [{
      author: { login: 'chatgpt-codex-connector[bot]' },
      body: '### 💡 Codex Review\n\nHere are some automated review suggestions for this pull request.\n\n**Reviewed commit:** `aaaaaaaaaa`\n\nActionable finding',
      state: 'COMMENTED',
    }],
  }), true)
  assert.equal(reviewBatchMatches({
    ...input,
    reviews: [{
      author: { login: 'cursor[bot]' },
      body: '<details><summary>Stale comment</summary></details>',
      state: 'COMMENTED',
    }],
  }), false)
  assert.equal(reviewBatchMatches({ ...input, comments: [{ body: 'Please fix.', createdAt: '2026-01-02T00:00:00Z' }] }), true)
  assert.equal(reviewBatchMatches({ ...input, comments: [{ body: 'Looks good to me.', createdAt: '2026-01-02T00:00:00Z' }] }), false)
  assert.equal(reviewBatchMatches({ ...input, comments: [{ body: 'Please fix.', createdAt: '2026-01-01T16:00:00Z' }] }), false)
  assert.equal(reviewBatchMatches({
    ...input,
    comments: [{
      body: "@gizmo this workflow assigned you PR #1281. Continue only this PR's recorded scope through review, exact-head validation, and squash merge.",
      createdAt: '2026-01-02T00:00:00Z',
    }],
  }), false)
  assert.equal(reviewBatchMatches({
    ...input,
    comments: [{ body: '### Web research preview\nDone.', createdAt: '2026-01-02T00:00:00Z' }],
  }), false)
  for (const body of [
    'You have reached your Codex usage limits for code reviews. Try later.',
    "Codex Review: Didn't find any major issues. Reviewed commit abc123.",
  ]) {
    assert.equal(reviewBatchMatches({
      ...input,
      comments: [{
        author: { login: 'chatgpt-codex-connector[bot]' },
        body,
        createdAt: '2026-01-02T00:00:00Z',
      }],
    }), false)
  }
})
